import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  aggregateDailyMetrics,
  computePctChange,
  computePriorPeriod,
  computeSparklineData,
  buildActionsLog,
} from "@/lib/report-metrics";
import { ViewsOnGoogleChart } from "./views-on-google-chart";
import { MetricSparkCard } from "./metric-spark-card";
import { ActionsLog } from "./actions-log";
import { ExecutiveSummary } from "./executive-summary";
import { cn } from "@/lib/utils";

interface ReportsDashboardContentProps {
  profileId: string | null;
  from: string;
  to: string;
}

function NarrativeSkeleton() {
  return (
    <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-6 animate-pulse">
      <div className="h-4 w-3/4 bg-violet-100 rounded mb-2" />
      <div className="h-4 w-full bg-violet-100 rounded mb-2" />
      <div className="h-4 w-2/3 bg-violet-100 rounded" />
    </div>
  );
}

export async function ReportsDashboardContent({
  profileId,
  from,
  to,
}: ReportsDashboardContentProps) {
  // Date parsing — UTC per Phase 18 convention
  const fromDate = new Date(from + "T00:00:00Z");
  const toDate = new Date(to + "T00:00:00Z");
  const { priorFrom, priorTo } = computePriorPeriod(fromDate, toDate);

  const profileFilter = profileId ? { profileId } : {};

  // Fetch all data in parallel
  const [currentMetrics, priorMetrics, posts, responses, descriptions, profile] =
    await Promise.all([
      prisma.dailyMetric.findMany({
        where: { ...profileFilter, date: { gte: fromDate, lte: toDate } },
        orderBy: { date: "asc" },
      }),
      prisma.dailyMetric.findMany({
        where: { ...profileFilter, date: { gte: priorFrom, lte: priorTo } },
        orderBy: { date: "asc" },
      }),
      prisma.post.findMany({
        where: {
          ...profileFilter,
          status: "PUBLISHED",
          publishedAt: { gte: fromDate, lte: toDate },
        },
        include: { profile: { select: { name: true } } },
      }),
      prisma.reviewResponse.findMany({
        where: {
          status: "PUBLISHED",
          createdAt: { gte: fromDate, lte: toDate },
          ...(profileId ? { review: { profileId } } : {}),
        },
        include: { review: { include: { profile: { select: { name: true } } } } },
      }),
      prisma.profileDescription.findMany({
        where: {
          ...profileFilter,
          pushedAt: { gte: fromDate, lte: toDate },
        },
        include: { profile: { select: { name: true } } },
      }),
      profileId
        ? prisma.profile.findUnique({
            where: { id: profileId },
            select: { name: true },
          })
        : null,
    ]);

  // Compute aggregated metrics
  const current = aggregateDailyMetrics(currentMetrics);
  const prior = aggregateDailyMetrics(priorMetrics);

  const searchPct = computePctChange(current.searchImpressions, prior.searchImpressions);
  const mapsPct = computePctChange(current.mapsImpressions, prior.mapsImpressions);
  const callsPct = computePctChange(current.callClicks, prior.callClicks);
  const clicksPct = computePctChange(current.websiteClicks, prior.websiteClicks);
  const directionsPct = computePctChange(current.directionRequests, prior.directionRequests);

  // Sparkline data
  const callsSparkData = computeSparklineData(currentMetrics, "callClicks");
  const clicksSparkData = computeSparklineData(currentMetrics, "websiteClicks");
  const directionsSparkData = computeSparklineData(currentMetrics, "directionRequests");

  // Chart data — daily search + maps impressions
  const chartData = currentMetrics.map((m) => ({
    date: m.date.toISOString().split("T")[0],
    search: m.impressionsSearchDesktop + m.impressionsSearchMobile,
    maps: m.impressionsMapsDesktop + m.impressionsMapsMobile,
  }));

  // Actions log
  const actionItems = buildActionsLog(posts, responses, descriptions, fromDate, toDate);

  return (
    <div className="space-y-6">
      {/* D-15: AI executive summary at top, non-blocking via Suspense */}
      <Suspense fallback={<NarrativeSkeleton />}>
        <ExecutiveSummary
          metrics={{
            searchImpressions: current.searchImpressions,
            mapsImpressions: current.mapsImpressions,
            websiteClicks: current.websiteClicks,
            callClicks: current.callClicks,
            directionRequests: current.directionRequests,
            searchPct,
            mapsPct,
            clicksPct,
            callsPct,
            directionsPct,
          }}
          profileName={profile?.name ?? null}
          from={from}
          to={to}
          profileId={profileId}
        />
      </Suspense>

      {/* D-07: Two summary cards — Search and Maps impression totals */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-500">
              Search Impressions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-zinc-900">
              {current.searchImpressions.toLocaleString()}
            </div>
            <div className="flex items-center gap-1.5 mt-2">
              {searchPct === null ? (
                <>
                  <Minus className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm text-zinc-400">No prior data</span>
                </>
              ) : searchPct >= 0 ? (
                <>
                  <ArrowUp className="w-4 h-4 text-emerald-600" />
                  <span className={cn("text-sm font-medium text-emerald-600")}>
                    {Math.abs(searchPct)}% vs prior period
                  </span>
                </>
              ) : (
                <>
                  <ArrowDown className="w-4 h-4 text-red-600" />
                  <span className={cn("text-sm font-medium text-red-600")}>
                    {Math.abs(searchPct)}% vs prior period
                  </span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-500">
              Maps Impressions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-zinc-900">
              {current.mapsImpressions.toLocaleString()}
            </div>
            <div className="flex items-center gap-1.5 mt-2">
              {mapsPct === null ? (
                <>
                  <Minus className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm text-zinc-400">No prior data</span>
                </>
              ) : mapsPct >= 0 ? (
                <>
                  <ArrowUp className="w-4 h-4 text-emerald-600" />
                  <span className={cn("text-sm font-medium text-emerald-600")}>
                    {Math.abs(mapsPct)}% vs prior period
                  </span>
                </>
              ) : (
                <>
                  <ArrowDown className="w-4 h-4 text-red-600" />
                  <span className={cn("text-sm font-medium text-red-600")}>
                    {Math.abs(mapsPct)}% vs prior period
                  </span>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* D-06: Views on Google dual-line chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-zinc-500">
            Views on Google
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ViewsOnGoogleChart data={chartData} />
        </CardContent>
      </Card>

      {/* D-11: Three metric sparkline cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricSparkCard
          id="calls"
          title="Phone Calls"
          value={current.callClicks}
          previousValue={prior.callClicks}
          pctChange={callsPct}
          sparkData={callsSparkData}
          color="#7c3aed"
        />
        <MetricSparkCard
          id="clicks"
          title="Website Clicks"
          value={current.websiteClicks}
          previousValue={prior.websiteClicks}
          pctChange={clicksPct}
          sparkData={clicksSparkData}
          color="#3B82F6"
        />
        <MetricSparkCard
          id="directions"
          title="Direction Requests"
          value={current.directionRequests}
          previousValue={prior.directionRequests}
          pctChange={directionsPct}
          sparkData={directionsSparkData}
          color="#10B981"
        />
      </div>

      {/* D-12: Actions log */}
      <ActionsLog items={actionItems} />
    </div>
  );
}
