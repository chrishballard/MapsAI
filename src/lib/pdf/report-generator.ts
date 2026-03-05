import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { prisma } from "../prisma";
import { renderImpressionsChart } from "./chart-renderer";
import { ReportDocument, type ReportData } from "./report-template";

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
