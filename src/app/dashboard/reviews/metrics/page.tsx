import { Suspense } from "react";
import Link from "next/link";
import { MotionDiv } from "@/components/motion-wrapper";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ReviewMetricsContent } from "./review-metrics-content";

function ReviewMetricsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-36 w-full rounded-xl" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Skeleton className="h-80 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    </div>
  );
}

export default async function ReviewMetricsPage() {
  return (
    <MotionDiv initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-4 mb-1">
            <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">
              Reviews
            </h1>
            <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
              <Link
                href="/dashboard/reviews"
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  "text-zinc-500 hover:text-zinc-700"
                )}
              >
                All
              </Link>
              <span className="px-3 py-1.5 rounded-md text-sm font-medium bg-white text-zinc-900 shadow-sm">
                Metrics
              </span>
            </div>
          </div>
          <p className="text-zinc-500 mt-1">
            Review trends, rating breakdown, and recency at a glance.
          </p>
        </div>
      </div>

      <Suspense fallback={<ReviewMetricsSkeleton />}>
        <ReviewMetricsContent />
      </Suspense>
    </MotionDiv>
  );
}
