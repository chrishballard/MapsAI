import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { prisma } from "../prisma";
import { renderImpressionsChart, renderSparklineChart } from "./chart-renderer";
import { formatDateISO } from "@/lib/dates";
import {
  ReportDocument,
  type ReportData,
  DashboardReportDocument,
  type DashboardReportData,
} from "./report-template";
import {
  aggregateDailyMetrics,
  computePriorPeriod,
  computeSparklineData,
  buildActionsLog,
  replyPublishedBetween,
  sumDailyMetricsByDate,
  onDays,
  reportScope,
  reportedPart,
  lastReportedDay,
  REPORTED_DAY,
  REPORTING_LAG_DAYS,
} from "@/lib/report-metrics";
import {
  getMonthStart,
  getMonthEnd,
  formatMonthYear,
  formatMediumDateUTC,
} from "@/lib/dates";

function getMonthRange(month: Date): { start: Date; end: Date } {
  return { start: getMonthStart(month), end: getMonthEnd(month) };
}

function getPreviousMonthRange(month: Date): { start: Date; end: Date } {
  return getMonthRange(getMonthStart(month, -1));
}

const formatMonthLabel = formatMonthYear;

interface SummedMetrics {
  totalImpressions: number;
  websiteClicks: number;
  callClicks: number;
  directionRequests: number;
}

function sumMetrics(
  metrics: Array<{
    impressionsSearchDesktop: number;
    impressionsSearchMobile: number;
    impressionsMapsDesktop: number;
    impressionsMapsMobile: number;
    websiteClicks: number;
    callClicks: number;
    directionRequests: number;
  }>
): SummedMetrics {
  return metrics.reduce(
    (acc, m) => ({
      totalImpressions:
        acc.totalImpressions +
        m.impressionsSearchDesktop +
        m.impressionsSearchMobile +
        m.impressionsMapsDesktop +
        m.impressionsMapsMobile,
      websiteClicks: acc.websiteClicks + m.websiteClicks,
      callClicks: acc.callClicks + m.callClicks,
      directionRequests: acc.directionRequests + m.directionRequests,
    }),
    { totalImpressions: 0, websiteClicks: 0, callClicks: 0, directionRequests: 0 }
  );
}

export async function generateReport(
  profileId: string,
  month: Date
): Promise<Uint8Array> {
  // 1. Fetch profile info
  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
  });

  // 2. Fetch current month's DailyMetric records
  const { start: curStart, end: curEnd } = getMonthRange(month);
  const currentDailyMetrics = await prisma.dailyMetric.findMany({
    where: {
      profileId,
      date: { gte: curStart, lte: curEnd },
    },
    orderBy: { date: "asc" },
  });

  // 3. Fetch previous month's for comparison
  const { start: prevStart, end: prevEnd } = getPreviousMonthRange(month);
  const previousDailyMetrics = await prisma.dailyMetric.findMany({
    where: {
      profileId,
      date: { gte: prevStart, lte: prevEnd },
    },
  });

  // 4. Sum metrics
  const currentMetrics = sumMetrics(currentDailyMetrics);
  const previousMetrics = sumMetrics(previousDailyMetrics);

  // 5. Fetch top 10 keywords
  const keywords = await prisma.monthlyKeyword.findMany({
    where: {
      profileId,
      month: curStart,
    },
    orderBy: { impressions: "desc" },
    take: 10,
  });

  // 6. Fetch review stats for the month
  const reviews = await prisma.review.findMany({
    where: {
      profileId,
      removedAt: null,
      reviewDate: onDays(curStart, curEnd),
    },
    include: { response: true },
  });

  const reviewCount = reviews.length;
  const averageRating =
    reviewCount > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
      : 0;
  // A review the owner answered in GBP is responded to, even though
  // RankMaps never wrote the reply.
  const respondedCount = reviews.filter(
    (r) => r.repliedExternally || r.response?.status === "PUBLISHED"
  ).length;
  const responseRate = reviewCount > 0 ? (respondedCount / reviewCount) * 100 : 0;

  // 7. Fetch post count for the month
  const postsCount = await prisma.post.count({
    where: {
      profileId,
      status: "PUBLISHED",
      publishedAt: onDays(curStart, curEnd),
    },
  });

  // 8. Is the month complete? A month that hasn't ended is month-to-date,
  // and against a whole previous month every comparison reads as a drop. So
  // is a finished month whose last days Google hasn't reported: the generate
  // route defaults to last month, usually run in the first days of the next
  // one. A finished month is complete once its last day has data, or once
  // Google has reported any later day (it reports days in order, so the
  // empty days before that really were empty). Not on a calendar rule: Google
  // running late, or a profile whose sync stopped, would otherwise show the
  // missing days as a drop. "As of" is the last day Google has reported, not
  // the day the report was generated.
  const now = new Date();
  const lastDayWithData = lastReportedDay(currentDailyMetrics);
  const inProgress = curStart.getTime() >= getMonthStart(now).getTime();
  let unfinished = false;
  if (!inProgress && (lastDayWithData === null || lastDayWithData < curEnd)) {
    const reportedLater = await prisma.dailyMetric.findFirst({
      where: { profileId, date: { gt: curEnd }, ...REPORTED_DAY },
      select: { id: true },
    });
    unfinished = reportedLater === null;
  }
  // Within two lag periods the rest is probably on its way; after that the
  // sync has likely stopped for this profile, so the PDF makes no promise.
  const finalSoon =
    unfinished &&
    now.getTime() - curEnd.getTime() < 2 * REPORTING_LAG_DAYS * 86_400_000;
  const partial = inProgress || unfinished;

  // 9. Generate chart PNG, without the zero rows of days Google hasn't
  // reported (they draw a cliff at the end of a partial month)
  const chartRows =
    partial && lastDayWithData
      ? currentDailyMetrics.filter((m) => m.date <= lastDayWithData)
      : currentDailyMetrics;
  const chartData = chartRows.map((m) => ({
    date: formatDateISO(m.date),
    search: m.impressionsSearchDesktop + m.impressionsSearchMobile,
    maps: m.impressionsMapsDesktop + m.impressionsMapsMobile,
  }));

  let chartImageUri: string | null = null;
  if (chartData.length > 0) {
    try {
      const chartBuffer = await renderImpressionsChart(chartData);
      chartImageUri = `data:image/png;base64,${chartBuffer.toString("base64")}`;
    } catch (err) {
      console.error("Failed to render chart:", err);
    }
  }

  // 10. Build report data
  const reportData: ReportData = {
    businessName: profile.name,
    address: profile.address,
    category: profile.category,
    month: formatMonthLabel(month),
    partialMonth: partial
      ? {
          asOf: lastDayWithData ? formatMediumDateUTC(lastDayWithData) : null,
          ended: unfinished,
          finalSoon,
        }
      : null,
    currentMetrics,
    previousMetrics,
    chartImageUri,
    keywords: keywords.map((k) => ({
      keyword: k.keyword,
      impressions: k.impressions,
    })),
    reviewCount,
    averageRating,
    responseRate,
    postsCount,
  };

  // 11. Render PDF
  // ReportDocument renders a react-pdf <Document> at its root, but its own props
  // ({ data }) share nothing with DocumentProps, so the element type needs forcing.
  const pdfBuffer = await renderToBuffer(
    React.createElement(ReportDocument, {
      data: reportData,
    }) as unknown as React.ReactElement<DocumentProps>
  );

  return new Uint8Array(pdfBuffer);
}

export async function generateDashboardReport(
  profileId: string | null,
  from: Date,
  to: Date,
  narrativeText: string | null
): Promise<Uint8Array> {
  // 1. Fetch profile info if profileId provided
  const profile = profileId
    ? await prisma.profile.findUnique({
        where: { id: profileId },
        select: { name: true, address: true, category: true },
      })
    : null;
  const profileFilter = reportScope(profileId);

  // 2. Fetch current period DailyMetrics
  const currentDailyMetrics = await prisma.dailyMetric.findMany({
    where: { ...profileFilter, date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
  });

  // 3. One point per day: without a profile filter there is a row per
  // profile per day, and the charts want the day's total. Only the days
  // Google has reported are charted and compared (see reportedPart), so the
  // prior period is as many days before `from`.
  const { days: dailyTotals, compareTo, reportedThrough } = reportedPart(
    sumDailyMetricsByDate(currentDailyMetrics),
    to
  );
  const { priorFrom, priorTo } = computePriorPeriod(from, compareTo);
  const priorDailyMetrics = await prisma.dailyMetric.findMany({
    where: { ...profileFilter, date: { gte: priorFrom, lte: priorTo } },
  });

  // 4. Aggregate metrics
  const current = aggregateDailyMetrics(currentDailyMetrics);
  const prior = aggregateDailyMetrics(priorDailyMetrics);

  // 5. Build chart data for impressions chart
  const chartData = dailyTotals.map((m) => ({
    date: formatDateISO(m.date),
    search: m.impressionsSearchDesktop + m.impressionsSearchMobile,
    maps: m.impressionsMapsDesktop + m.impressionsMapsMobile,
  }));

  let impressionsChartUri: string | null = null;
  if (chartData.length > 0) {
    try {
      const buf = await renderImpressionsChart(chartData);
      impressionsChartUri = `data:image/png;base64,${buf.toString("base64")}`;
    } catch (err) {
      console.error("Failed to render impressions chart:", err);
    }
  }

  // 6. Render sparkline PNGs
  const sparklineFields = [
    { field: "callClicks" as const, color: "#7c3aed" },
    { field: "websiteClicks" as const, color: "#3B82F6" },
    { field: "directionRequests" as const, color: "#10B981" },
  ];
  const sparkUris: Record<string, string | null> = {};
  for (const { field, color } of sparklineFields) {
    const sparkData = computeSparklineData(dailyTotals, field);
    if (sparkData.length > 1) {
      try {
        const buf = await renderSparklineChart(sparkData, color);
        sparkUris[field] = `data:image/png;base64,${buf.toString("base64")}`;
      } catch (err) {
        console.error(`Failed to render sparkline for ${field}:`, err);
        sparkUris[field] = null;
      }
    } else {
      sparkUris[field] = null;
    }
  }

  // 7. Build actions log
  const [posts, responses, descriptions] = await Promise.all([
    prisma.post.findMany({
      where: {
        ...profileFilter,
        status: "PUBLISHED",
        publishedAt: onDays(from, to),
      },
      select: {
        id: true,
        status: true,
        publishedAt: true,
        profile: { select: { name: true } },
      },
    }),
    prisma.reviewResponse.findMany({
      where: {
        status: "PUBLISHED",
        ...replyPublishedBetween(from, to),
        review: reportScope(profileId),
      },
      select: {
        id: true,
        status: true,
        publishedAt: true,
        createdAt: true,
        review: { select: { profile: { select: { name: true } } } },
      },
    }),
    prisma.profileDescription.findMany({
      where: { ...profileFilter, pushedAt: onDays(from, to) },
      select: {
        id: true,
        pushedAt: true,
        profile: { select: { name: true } },
      },
    }),
  ]);
  const actionItems = buildActionsLog(posts, responses, descriptions, from, to);
  // Dates print in UTC: from/to are UTC midnights and actions were filtered
  // against them, so a local-time formatter put both a day early in US zones.
  const actionsForPdf = actionItems.map((a) => ({
    label: a.label,
    profileName: a.profileName,
    date: formatMediumDateUTC(a.time),
  }));

  // 8. Format period label
  const periodLabel =
    `${formatMediumDateUTC(from)} - ${formatMediumDateUTC(to)}` +
    (reportedThrough ? ` (Google data through ${formatMediumDateUTC(reportedThrough)})` : "");

  // 9. Build report data
  const reportData: DashboardReportData = {
    businessName: profile?.name ?? "All Profiles",
    address: profile?.address ?? null,
    category: profile?.category ?? null,
    periodLabel,
    narrativeText,
    currentMetrics: current,
    previousMetrics: prior,
    impressionsChartUri,
    callsSparkUri: sparkUris["callClicks"] ?? null,
    clicksSparkUri: sparkUris["websiteClicks"] ?? null,
    directionsSparkUri: sparkUris["directionRequests"] ?? null,
    actions: actionsForPdf,
  };

  // 10. Render PDF
  // Same forced element type as generateReport above.
  const pdfBuffer = await renderToBuffer(
    React.createElement(DashboardReportDocument, {
      data: reportData,
    }) as unknown as React.ReactElement<DocumentProps>
  );

  return new Uint8Array(pdfBuffer);
}
