import { prisma } from "@/lib/prisma";
import { getSelectedProfileId } from "@/lib/selected-profile";
import {
  computeTrend,
  computeRatingDistribution,
  computeMonthlyData,
  computeDaysSince,
  getRecencyStatus,
  formatDataThrough,
} from "@/lib/review-metrics";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  ArrowUp,
  ArrowDown,
  Minus,
  Clock,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RatingDistributionChart } from "./rating-distribution-chart";
import { VolumeRatingTrendChart } from "./volume-rating-trend-chart";

export async function ReviewMetricsContent() {
  const selectedProfileId = await getSelectedProfileId();
  const profileFilter = selectedProfileId ? { profileId: selectedProfileId } : {};
  const now = new Date();
  const sixtyTwoDaysAgo = new Date(now.getTime() - 62 * 24 * 60 * 60 * 1000);

  const [recentReviews, allReviews, latestReview, totalCount] = await Promise.all([
    prisma.review.findMany({
      where: { ...profileFilter, reviewDate: { gte: sixtyTwoDaysAgo } },
      select: { rating: true, reviewDate: true },
      orderBy: { reviewDate: "desc" },
    }),
    prisma.review.findMany({
      where: profileFilter,
      select: { rating: true, reviewDate: true },
      orderBy: { reviewDate: "desc" },
    }),
    prisma.review.findFirst({
      where: profileFilter,
      orderBy: { reviewDate: "desc" },
      select: { reviewDate: true },
    }),
    prisma.review.count({ where: profileFilter }),
  ]);

  // Empty state — no review data yet
  if (totalCount === 0) {
    return (
      <Card className="flex flex-col items-center text-center py-16">
        <div className="w-16 h-16 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-400 mb-4">
          <MessageSquare size={32} />
        </div>
        <h2 className="text-lg font-semibold text-zinc-900 mb-2">No review data yet</h2>
        <p className="text-zinc-500 max-w-md">
          Sync reviews from your connected profiles to see metrics.
        </p>
      </Card>
    );
  }

  // Compute all derived data using pure functions
  const trendData = computeTrend(recentReviews, now);
  const ratingDist = computeRatingDistribution(allReviews);
  const monthlyData = computeMonthlyData(allReviews, now);
  const daysSinceLast = computeDaysSince(latestReview?.reviewDate ?? null, now);
  const recencyStatus = getRecencyStatus(daysSinceLast);
  const dataThroughLabel = latestReview?.reviewDate
    ? formatDataThrough(latestReview.reviewDate)
    : null;

  // Date range subtitle for the dual-line chart card (per D-12)
  const dateRangeLabel =
    monthlyData.length >= 2
      ? `${monthlyData[0].month} - ${monthlyData[monthlyData.length - 1].month}`
      : "";

  return (
    <div className="space-y-6">
      {/* Page-level "Data through" subtitle (per D-13) */}
      {dataThroughLabel && (
        <p className="text-sm text-zinc-500">{dataThroughLabel}</p>
      )}

      {/* Top row: two stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Stat Card 1 — Total Reviews (RVMT-01) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-500">Total Reviews</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-zinc-900">{totalCount}</div>
            <div className="flex items-center gap-1.5 mt-2">
              {trendData.pct !== null ? (
                <>
                  {trendData.pct >= 0 ? (
                    <ArrowUp className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <ArrowDown className="w-4 h-4 text-red-600" />
                  )}
                  <span
                    className={cn(
                      "text-sm font-medium",
                      trendData.pct >= 0 ? "text-emerald-600" : "text-red-600"
                    )}
                  >
                    {Math.abs(trendData.pct)}% vs prior 30 days
                  </span>
                </>
              ) : (
                <>
                  <Minus className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm text-zinc-400">
                    {trendData.current} in last 30 days
                  </span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Stat Card 2 — Days Since Last Review (RVMT-04) */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-zinc-500">
                Days Since Last Review
              </CardTitle>
              <Clock className="w-4 h-4 text-zinc-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-zinc-900">
              {daysSinceLast ?? "—"}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                  recencyStatus.status === "good" && "bg-emerald-50 text-emerald-700",
                  recencyStatus.status === "warning" && "bg-amber-50 text-amber-700",
                  recencyStatus.status === "critical" && "bg-red-50 text-red-700"
                )}
              >
                {recencyStatus.message}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom row: two chart cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Chart Card 1 — Rating Distribution (RVMT-02) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-500">
              Rating Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RatingDistributionChart data={ratingDist} />
          </CardContent>
        </Card>

        {/* Chart Card 2 — Monthly Volume & Avg Rating (RVMT-03, RVMT-05) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-500">
              Monthly Volume &amp; Average Rating
            </CardTitle>
            {dateRangeLabel && (
              <p className="text-xs text-zinc-400 mt-0.5">{dateRangeLabel}</p>
            )}
          </CardHeader>
          <CardContent>
            <VolumeRatingTrendChart data={monthlyData} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
