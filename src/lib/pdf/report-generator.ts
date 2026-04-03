import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { prisma } from "../prisma";
import { renderImpressionsChart, renderSparklineChart } from "./chart-renderer";
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
} from "@/lib/report-metrics";

function getMonthRange(month: Date): { start: Date; end: Date } {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  return { start, end };
}

function getPreviousMonthRange(month: Date): { start: Date; end: Date } {
  const prevMonth = new Date(month.getFullYear(), month.getMonth() - 1, 1);
  return getMonthRange(prevMonth);
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

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
      reviewDate: { gte: curStart, lte: curEnd },
    },
    include: { response: true },
  });

  const reviewCount = reviews.length;
  const averageRating =
    reviewCount > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
      : 0;
  const respondedCount = reviews.filter(
    (r) => r.response && r.response.status === "PUBLISHED"
  ).length;
  const responseRate = reviewCount > 0 ? (respondedCount / reviewCount) * 100 : 0;

  // 7. Fetch post count for the month
  const postsCount = await prisma.post.count({
    where: {
      profileId,
      status: "PUBLISHED",
      publishedAt: { gte: curStart, lte: curEnd },
    },
  });

  // 8. Generate chart PNG
  const chartData = currentDailyMetrics.map((m) => ({
    date: m.date.toISOString().split("T")[0],
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

  // 9. Build report data
  const reportData: ReportData = {
    businessName: profile.name,
    address: profile.address,
    category: profile.category,
    month: formatMonthLabel(month),
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

  // 10. Render PDF
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfBuffer = await renderToBuffer(
    React.createElement(ReportDocument, { data: reportData }) as any
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
  const profileFilter = profileId ? { profileId } : {};

  // 2. Fetch current period DailyMetrics
  const currentDailyMetrics = await prisma.dailyMetric.findMany({
    where: { ...profileFilter, date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
  });

  // 3. Fetch prior period
  const { priorFrom, priorTo } = computePriorPeriod(from, to);
  const priorDailyMetrics = await prisma.dailyMetric.findMany({
    where: { ...profileFilter, date: { gte: priorFrom, lte: priorTo } },
  });

  // 4. Aggregate metrics
  const current = aggregateDailyMetrics(currentDailyMetrics);
  const prior = aggregateDailyMetrics(priorDailyMetrics);

  // 5. Build chart data for impressions chart
  const chartData = currentDailyMetrics.map((m) => ({
    date: m.date.toISOString().split("T")[0],
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
    const sparkData = computeSparklineData(currentDailyMetrics, field);
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
        publishedAt: { gte: from, lte: to },
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
        createdAt: { gte: from, lte: to },
        ...(profileId ? { review: { profileId } } : {}),
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        review: { select: { profile: { select: { name: true } } } },
      },
    }),
    prisma.profileDescription.findMany({
      where: { ...profileFilter, pushedAt: { gte: from, lte: to } },
      select: {
        id: true,
        pushedAt: true,
        profile: { select: { name: true } },
      },
    }),
  ]);
  const actionItems = buildActionsLog(posts, responses, descriptions, from, to);
  const actionsForPdf = actionItems.map((a) => ({
    label: a.label,
    profileName: a.profileName,
    date: a.time.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  }));

  // 8. Format period label
  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  const periodLabel = `${fmtDate(from)} - ${fmtDate(to)}`;

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfBuffer = await renderToBuffer(
    React.createElement(DashboardReportDocument, { data: reportData }) as any
  );

  return new Uint8Array(pdfBuffer);
}
