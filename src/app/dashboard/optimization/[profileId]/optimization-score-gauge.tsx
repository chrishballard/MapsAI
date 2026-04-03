'use client';

import { RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts';
import { ChartContainer } from '@/components/ui/chart';
import type { ScoreGrade } from '@/lib/optimization-score';

const GRADE_COLORS: Record<ScoreGrade, string> = {
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
};

const GRADE_LABELS: Record<ScoreGrade, string> = {
  green: 'Green',
  amber: 'Amber',
  red: 'Red',
};

interface OptimizationScoreGaugeProps {
  total: number;
  grade: ScoreGrade;
}

export function OptimizationScoreGauge({ total, grade }: OptimizationScoreGaugeProps) {
  const color = GRADE_COLORS[grade];
  const data = [{ value: total, fill: color }];

  return (
    <div className="relative w-48 h-48">
      <ChartContainer
        config={{ score: { color } }}
        className="aspect-square w-full h-full"
      >
        <RadialBarChart
          data={data}
          innerRadius="70%"
          outerRadius="90%"
          startAngle={220}
          endAngle={-40}
          barSize={16}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar
            background={{ fill: '#e4e4e7' }}
            dataKey="value"
            cornerRadius={8}
          />
        </RadialBarChart>
      </ChartContainer>
      {/* Center label overlay — NOT using label prop on RadialBar (renders at bar endpoint) */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-3xl font-bold text-zinc-900">{total}%</span>
        <span className="text-sm font-medium" style={{ color }}>
          {GRADE_LABELS[grade]}
        </span>
      </div>
    </div>
  );
}
