import { prisma } from "../prisma";
import {
  fetchDailyMetrics,
  parseMetricsResponse,
} from "../google-performance";
import { fetchSearchKeywords } from "../google-keywords";
import { getMonthStart, formatMonthISO } from "../dates";

interface MetricsSyncProfile {
  id: string;
  name: string;
  googleAccountId: string;
  locationName: string;
}

export interface SyncProfileMetricsOptions {
  /** How many days of daily metrics to backfill. Default 90. */
  days?: number;
  /** How many completed months of search keywords to sync. Default 3. */
  keywordMonths?: number;
  logPrefix?: string;
}

export interface SyncProfileMetricsResult {
  metricDays: number;
  keywords: number;
}

/**
 * Fetch daily metrics + monthly search keywords from the GBP API for one
 * profile and upsert them into DailyMetric / MonthlyKeyword.
 */
export async function syncProfileMetrics(
  profile: MetricsSyncProfile,
  options: SyncProfileMetricsOptions = {}
): Promise<SyncProfileMetricsResult> {
  const { days = 90, keywordMonths = 3, logPrefix = "[metrics-sync]" } = options;

  // Extract numeric location ID from locationName (e.g., "locations/12345" -> "12345")
  const locationId = profile.locationName.split("/").pop()!;

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const metricsResponse = await fetchDailyMetrics(
    profile.googleAccountId,
    locationId,
    startDate,
    endDate
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

  console.log(
    `${logPrefix} Synced ${parsedMetrics.length} daily metric records for ${profile.name}`
  );

  // Sync search keywords for recent COMPLETED months. The GBP API returns no
  // data for the current in-progress month, so requesting it always yields
  // 0 keywords. Recent months can still receive late updates from Google.
  const now = new Date();
  let keywordCount = 0;

  for (let back = 1; back <= keywordMonths; back++) {
    const month = getMonthStart(now, -back);

    const keywords = await fetchSearchKeywords(
      profile.googleAccountId,
      locationId,
      month,
      month
    );

    for (const kw of keywords) {
      await prisma.monthlyKeyword.upsert({
        where: {
          profileId_month_keyword: {
            profileId: profile.id,
            month,
            keyword: kw.keyword,
          },
        },
        create: {
          profileId: profile.id,
          month,
          keyword: kw.keyword,
          impressions: kw.impressions,
        },
        update: {
          impressions: kw.impressions,
        },
      });
    }

    keywordCount += keywords.length;

    console.log(
      `${logPrefix} Synced ${keywords.length} keywords for ${profile.name} (${formatMonthISO(month)})`
    );
  }

  return { metricDays: parsedMetrics.length, keywords: keywordCount };
}
