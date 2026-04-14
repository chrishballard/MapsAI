import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createGoogleClient } from "@/lib/google";
import { google } from "googleapis";
import {
  fetchDailyMetrics,
  parseMetricsResponse,
} from "@/lib/google-performance";
import { fetchSearchKeywords } from "@/lib/google-keywords";

/**
 * GET /api/metrics/debug?backfill=30
 *
 * Diagnostic endpoint for the Business Profile Performance API.
 * Optional ?backfill=N param runs an inline N-day sync before returning diagnostics.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown>[] = [];

  try {
    // 1. Find a profile we can use
    const profile = await prisma.profile.findFirst({
      where: { isConnected: true, isOnboarded: true },
      select: {
        id: true,
        name: true,
        locationName: true,
        googleAccountId: true,
      },
    });

    if (!profile) {
      return NextResponse.json({
        status: "no_onboarded_profile",
        results: [{ step: "find_profile", success: false, reason: "no onboarded+connected profile in DB" }],
      });
    }

    results.push({ step: "find_profile", success: true, profile });

    const locationId = profile.locationName.split("/").pop()!;
    results.push({ step: "parse_location_id", locationId, raw: profile.locationName });

    // 2. Optional backfill — ?backfill=N triggers an inline N-day sync
    const url = new URL(request.url);
    const backfillDays = parseInt(url.searchParams.get("backfill") ?? "0", 10);

    if (backfillDays > 0) {
      try {
        const backfillEnd = new Date();
        const backfillStart = new Date();
        backfillStart.setDate(backfillStart.getDate() - backfillDays);

        const metricsResponse = await fetchDailyMetrics(
          profile.googleAccountId,
          locationId,
          backfillStart,
          backfillEnd
        );

        const parsedMetrics = parseMetricsResponse(metricsResponse, profile.id);

        for (const metric of parsedMetrics) {
          await prisma.dailyMetric.upsert({
            where: {
              profileId_date: {
                profileId: metric.profileId,
                date: metric.date,
              },
            },
            create: metric,
            update: {
              impressionsSearchDesktop: metric.impressionsSearchDesktop,
              impressionsSearchMobile: metric.impressionsSearchMobile,
              impressionsMapsDesktop: metric.impressionsMapsDesktop,
              impressionsMapsMobile: metric.impressionsMapsMobile,
              websiteClicks: metric.websiteClicks,
              callClicks: metric.callClicks,
              directionRequests: metric.directionRequests,
              conversations: metric.conversations,
            },
          });
        }

        // Also backfill keywords for current month
        const now = new Date();
        const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const keywords = await fetchSearchKeywords(
          profile.googleAccountId,
          locationId,
          currentMonth,
          currentMonth
        );
        for (const kw of keywords) {
          await prisma.monthlyKeyword.upsert({
            where: {
              profileId_month_keyword: {
                profileId: profile.id,
                month: currentMonth,
                keyword: kw.keyword,
              },
            },
            create: {
              profileId: profile.id,
              month: currentMonth,
              keyword: kw.keyword,
              impressions: kw.impressions,
            },
            update: { impressions: kw.impressions },
          });
        }

        results.push({
          step: "backfill",
          success: true,
          days: backfillDays,
          metricsInserted: parsedMetrics.length,
          keywordsInserted: keywords.length,
        });
      } catch (err: unknown) {
        const e = err as { message?: string };
        results.push({ step: "backfill", success: false, error: e.message });
      }
    }

    // 3. Build auth client
    const auth = await createGoogleClient(profile.googleAccountId);

    // 4. Hit Performance API v1 — fetchMultiDailyMetricsTimeSeries
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    const dateRange = {
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
    };
    results.push({ step: "date_range", ...dateRange });

    try {
      const bpp = google.businessprofileperformance({ version: "v1", auth });
      const response = await bpp.locations.fetchMultiDailyMetricsTimeSeries({
        location: `locations/${locationId}`,
        dailyMetrics: [
          "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
          "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
          "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
          "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
          "WEBSITE_CLICKS",
          "CALL_CLICKS",
          "BUSINESS_DIRECTION_REQUESTS",
          "BUSINESS_CONVERSATIONS",
        ],
        "dailyRange.startDate.year": startDate.getFullYear(),
        "dailyRange.startDate.month": startDate.getMonth() + 1,
        "dailyRange.startDate.day": startDate.getDate(),
        "dailyRange.endDate.year": endDate.getFullYear(),
        "dailyRange.endDate.month": endDate.getMonth() + 1,
        "dailyRange.endDate.day": endDate.getDate(),
      });

      const groups = response.data?.multiDailyMetricTimeSeries ?? [];
      const seriesSummary: Array<{
        groupIndex: number;
        metricIndex: number;
        metric: string | null | undefined;
        pointCount: number;
        firstPoint: unknown;
        lastPoint: unknown;
      }> = [];
      groups.forEach((group, groupIdx) => {
        // dailyMetricTimeSeries is an ARRAY in v1 schema
        const inner = group.dailyMetricTimeSeries ?? [];
        inner.forEach((metric, metricIdx) => {
          const pts = metric.timeSeries?.datedValues ?? [];
          seriesSummary.push({
            groupIndex: groupIdx,
            metricIndex: metricIdx,
            metric: metric.dailyMetric,
            pointCount: pts.length,
            firstPoint: pts[0] ?? null,
            lastPoint: pts[pts.length - 1] ?? null,
          });
        });
      });

      results.push({
        step: "performance_api_v1",
        success: true,
        httpStatus: response.status,
        groupCount: groups.length,
        totalMetricSeries: seriesSummary.length,
        seriesSummary,
        rawResponseBody: response.data,
      });
    } catch (err: unknown) {
      const e = err as {
        response?: { status?: number; data?: unknown };
        message?: string;
        errors?: unknown;
      };
      results.push({
        step: "performance_api_v1",
        success: false,
        httpStatus: e.response?.status,
        error: String(e.response?.data || e.message || "unknown").slice(0, 1000),
      });
    }

    // 4. Also try the keywords endpoint via raw fetch, since it uses same API
    try {
      const bpp = google.businessprofileperformance({ version: "v1", auth });
      const now = new Date();
      const searchKeywordsResponse = await bpp.locations.searchkeywords.impressions.monthly.list({
        parent: `locations/${locationId}`,
        "monthlyRange.startMonth.year": now.getFullYear(),
        "monthlyRange.startMonth.month": now.getMonth() + 1,
        "monthlyRange.endMonth.year": now.getFullYear(),
        "monthlyRange.endMonth.month": now.getMonth() + 1,
      });
      results.push({
        step: "search_keywords_api",
        success: true,
        httpStatus: searchKeywordsResponse.status,
        keywordCount: searchKeywordsResponse.data?.searchKeywordsCounts?.length ?? 0,
        rawResponseBody: searchKeywordsResponse.data,
      });
    } catch (err: unknown) {
      const e = err as {
        response?: { status?: number; data?: unknown };
        message?: string;
      };
      results.push({
        step: "search_keywords_api",
        success: false,
        httpStatus: e.response?.status,
        error: String(e.response?.data || e.message || "unknown").slice(0, 1000),
      });
    }

    // 5. DB state — how much DailyMetric data exists for this profile
    const metricCount = await prisma.dailyMetric.count({
      where: { profileId: profile.id },
    });
    const allMetrics = await prisma.dailyMetric.findMany({
      where: { profileId: profile.id },
      orderBy: { date: "desc" },
      take: 20,
    });

    // Sum all numeric fields across all records — if any are > 0, the parser
    // successfully extracted values from the API response.
    const totalSums = allMetrics.reduce(
      (acc, m) => ({
        impressionsSearchDesktop: acc.impressionsSearchDesktop + m.impressionsSearchDesktop,
        impressionsSearchMobile: acc.impressionsSearchMobile + m.impressionsSearchMobile,
        impressionsMapsDesktop: acc.impressionsMapsDesktop + m.impressionsMapsDesktop,
        impressionsMapsMobile: acc.impressionsMapsMobile + m.impressionsMapsMobile,
        websiteClicks: acc.websiteClicks + m.websiteClicks,
        callClicks: acc.callClicks + m.callClicks,
        directionRequests: acc.directionRequests + m.directionRequests,
        conversations: acc.conversations + m.conversations,
      }),
      {
        impressionsSearchDesktop: 0,
        impressionsSearchMobile: 0,
        impressionsMapsDesktop: 0,
        impressionsMapsMobile: 0,
        websiteClicks: 0,
        callClicks: 0,
        directionRequests: 0,
        conversations: 0,
      }
    );
    const grandTotal = Object.values(totalSums).reduce((a, b) => a + b, 0);

    results.push({
      step: "db_daily_metric",
      count: metricCount,
      parserExtractedValues: grandTotal > 0,
      grandTotal,
      totalSums,
      records: allMetrics.map((m) => ({
        date: m.date.toISOString().slice(0, 10),
        iSd: m.impressionsSearchDesktop,
        iSm: m.impressionsSearchMobile,
        iMd: m.impressionsMapsDesktop,
        iMm: m.impressionsMapsMobile,
        wc: m.websiteClicks,
        cc: m.callClicks,
        dr: m.directionRequests,
        cv: m.conversations,
      })),
    });

    return NextResponse.json({ status: "debug_complete", results });
  } catch (err: unknown) {
    const e = err as { message?: string; stack?: string };
    return NextResponse.json(
      { status: "error", message: e.message, stack: e.stack, results },
      { status: 500 }
    );
  }
}
