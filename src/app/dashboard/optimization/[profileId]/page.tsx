import { Suspense } from 'react';
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { MotionDiv } from '@/components/motion-wrapper';
import { Skeleton } from '@/components/ui/skeleton';
import { OptimizationContent } from './optimization-content';

export default async function OptimizationPage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;

  // Fast PK lookup — does NOT block sub-component streaming
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { name: true },
  });

  if (!profile) {
    notFound();
  }

  return (
    <MotionDiv
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      {/* Header — renders immediately */}
      <div>
        <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">
          {profile.name}
        </h1>
        <p className="text-zinc-500 mt-1">Optimization breakdown and suggestions</p>
      </div>

      {/* Optimization content — streams progressively */}
      <Suspense fallback={<OptimizationContentSkeleton />}>
        <OptimizationContent profileId={profileId} />
      </Suspense>
    </MotionDiv>
  );
}

function OptimizationContentSkeleton() {
  return (
    <div className="space-y-8">
      {/* Score section skeleton */}
      <div className="flex items-center gap-8">
        <Skeleton className="w-48 h-48 rounded-full" />
        <div className="space-y-3">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>

      {/* Audit cards skeleton */}
      <div>
        <Skeleton className="h-7 w-40 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    </div>
  );
}
