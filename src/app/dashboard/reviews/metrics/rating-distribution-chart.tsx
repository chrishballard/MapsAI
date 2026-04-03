'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import type { RatingPoint } from "@/lib/review-metrics";

const chartConfig = {
  count: { label: "Reviews", color: "#f59e0b" },
} satisfies ChartConfig;

export function RatingDistributionChart({ data }: { data: RatingPoint[] }) {
  return (
    <ChartContainer config={chartConfig} className="h-[220px] w-full">
      <BarChart layout="vertical" data={data} margin={{ left: 8, right: 16 }}>
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
        <YAxis
          type="category"
          dataKey="star"
          tickFormatter={(v: number) => `${v} ★`}
          width={45}
          tick={{ fontSize: 12 }}
        />
        <Tooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
