'use client';

import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ScoreCheck, ScoreStatus } from '@/lib/optimization-score';

const STATUS_COLORS: Record<ScoreStatus, { border: string; badge: string }> = {
  good: { border: 'border-l-emerald-500', badge: 'bg-emerald-100 text-emerald-700' },
  warning: { border: 'border-l-amber-500', badge: 'bg-yellow-100 text-yellow-700' },
  critical: { border: 'border-l-red-500', badge: 'bg-red-100 text-red-700' },
};

interface AuditCardsGridProps {
  checks: ScoreCheck[];
}

export function AuditCardsGrid({ checks }: AuditCardsGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {checks.map((check) => (
        <Card
          key={check.signal}
          className={cn('border-l-4', STATUS_COLORS[check.status].border)}
        >
          <CardContent className="p-4 space-y-2">
            <h3 className="font-semibold text-zinc-900">{check.signal}</h3>
            <div className="flex items-center gap-2">
              <Badge className={STATUS_COLORS[check.status].badge}>
                {check.status}
              </Badge>
              <span className="text-sm text-zinc-500">
                {check.score}/{check.max}
              </span>
            </div>
            <p className="text-sm text-zinc-600">{check.value}</p>
            <p className="text-xs text-zinc-400">Benchmark: {check.benchmark}</p>
            <p className="text-sm text-zinc-500 italic">{check.recommendation}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
