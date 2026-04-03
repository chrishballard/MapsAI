import { prisma } from '@/lib/prisma';
import { computeOptimizationScore } from '@/lib/optimization-score';
import { OptimizationScoreGauge } from './optimization-score-gauge';
import { AuditCardsGrid } from './audit-cards-grid';
import type { ScoreStatus } from '@/lib/optimization-score';

const STATUS_ORDER: Record<ScoreStatus, number> = {
  critical: 0,
  warning: 1,
  good: 2,
};

const GRADE_DESCRIPTIONS: Record<string, { label: string; description: string }> = {
  green: {
    label: 'Well Optimized',
    description: 'This profile is performing well. Keep maintaining high post frequency and responding to reviews.',
  },
  amber: {
    label: 'Needs Improvement',
    description: 'There are a few areas to address. Focus on the critical signals below to boost your score.',
  },
  red: {
    label: 'Needs Attention',
    description: 'This profile has significant gaps. Address the critical signals below to improve visibility.',
  },
};

interface OptimizationContentProps {
  profileId: string;
}

export async function OptimizationContent({ profileId }: OptimizationContentProps) {
  // Heavy Prisma query — runs in streaming sub-component, not in the shell
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      name: true,
      reviews: { select: { rating: true, reviewDate: true } },
      posts: { select: { publishedAt: true, status: true } },
      descriptions: {
        select: {
          id: true,
          content: true,
          isApproved: true,
          isPushed: true,
          pushedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 1,
      },
      services: {
        select: {
          id: true,
          serviceName: true,
          description: true,
          isApproved: true,
          isPushed: true,
          pushedAt: true,
        },
      },
    },
  });

  // Shell already handles notFound — this is a safety guard
  if (!profile) return null;

  // Compute score server-side — avoids Date serialization across server/client boundary
  const score = computeOptimizationScore(profile);

  // Sort checks: critical first, warning second, good last
  const sortedChecks = [...score.checks].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  );

  const gradeInfo = GRADE_DESCRIPTIONS[score.grade];

  return (
    <div className="space-y-8">
      {/* Score section */}
      <div className="flex items-center gap-8">
        <OptimizationScoreGauge total={score.total} grade={score.grade} />
        <div className="space-y-1">
          <p className="text-xl font-semibold text-zinc-900">{gradeInfo.label}</p>
          <p className="text-zinc-500 max-w-sm">{gradeInfo.description}</p>
          <p className="text-sm text-zinc-400 mt-2">
            Score: {score.total}/100 across {score.checks.length} signals
          </p>
        </div>
      </div>

      {/* Signal breakdown */}
      <div>
        <h2 className="text-xl font-semibold text-zinc-900 mb-4">Signal Breakdown</h2>
        <AuditCardsGrid checks={sortedChecks} />
      </div>

      {/* Placeholder for Plan 03 suggestions panel */}
      <div id="suggestions-section" />
    </div>
  );
}
