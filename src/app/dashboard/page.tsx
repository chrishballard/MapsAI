import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { getSelectedProfileId } from "@/lib/selected-profile";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button-variants";
import { MotionDiv } from "@/components/motion-wrapper";
import { StatsGrid, StatsGridSkeleton, AIInsightsPanel } from "./stats-grid";
import { AutomationsFeed, AutomationsFeedSkeleton } from "./automations-feed";
import { TasksSection, TasksSectionSkeleton } from "./tasks-section";
import { Skeleton } from "@/components/ui/skeleton";

export default async function DashboardPage() {
  const selectedProfileId = await getSelectedProfileId();

  // Fast PK lookup for header — does NOT block sub-component streaming
  const selectedProfile = selectedProfileId
    ? await prisma.profile.findUnique({
        where: { id: selectedProfileId },
        select: { name: true },
      })
    : null;

  // For Get Started CTA — fast count, only when no filter
  const totalProfiles = selectedProfileId ? 1 : await prisma.profile.count();
  const connectedProfiles = selectedProfileId
    ? 0
    : await prisma.profile.count({ where: { isConnected: true } });
  const hasProfiles = totalProfiles > 0;

  return (
    <MotionDiv initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      {/* Header — renders immediately */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">
            {selectedProfile ? selectedProfile.name : "Dashboard"}
          </h1>
          <p className="text-zinc-500 mt-1">Welcome back, here&apos;s what&apos;s happening today.</p>
        </div>
        <div className="flex gap-3">
          <Link href="/dashboard/profiles" className={buttonVariants({ variant: "outline" })}>Export Data</Link>
          <Link href="/dashboard/profiles" className={buttonVariants({ className: "gap-2" })}>
            <Plus className="w-4 h-4" />New Profile
          </Link>
        </div>
      </div>

      {/* Stats Grid — streams independently per D-07 */}
      <Suspense fallback={<StatsGridSkeleton />}>
        <StatsGrid />
      </Suspense>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Automations Feed — streams independently per D-07 */}
          <Suspense fallback={<AutomationsFeedSkeleton />}>
            <AutomationsFeed />
          </Suspense>

          {/* Tasks Section — streams independently per D-07 */}
          <Suspense fallback={<TasksSectionSkeleton />}>
            <TasksSection />
          </Suspense>
        </div>

        {/* AI Insights — inline per D-08, own async component for data */}
        <Suspense fallback={<Skeleton className="h-80 w-full rounded-xl" />}>
          <AIInsightsPanel />
        </Suspense>
      </div>

      {/* Get Started / Connect More — inline per D-08 */}
      {!selectedProfileId && (
        <Card className="hover:border-brand-300 transition-colors">
          <CardContent className="flex flex-col items-center text-center py-10">
            <div className="rounded-full bg-brand-50 p-4 mb-4">
              <Building2 size={32} className="text-brand-600" />
            </div>
            <h2 className="text-lg font-semibold mb-2">
              {hasProfiles ? "Connect More Profiles" : "Get Started with Rankmaps"}
            </h2>
            <p className="text-zinc-500 mb-6 max-w-md">
              {hasProfiles
                ? `You have ${connectedProfiles} connected profile${connectedProfiles !== 1 ? "s" : ""}. Add more Google accounts to manage additional business profiles.`
                : "Connect your Google Business Profiles to start managing posts, reviews, and analytics."}
            </p>
            <a href={hasProfiles ? "/api/auth/google" : "/dashboard/profiles"} className={buttonVariants()}>
              {hasProfiles ? "Connect Another Account" : "Connect Your First Profile"}
            </a>
          </CardContent>
        </Card>
      )}
    </MotionDiv>
  );
}
