'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import type { MonthlyDataPoint } from "@/lib/review-metrics";

const chartConfig = {
  volume: { label: "Reviews", color: "#7c3aed" },
  avgRating: { label: "Avg Rating", color: "#f59e0b" },
} satisfies ChartConfig;

export function VolumeRatingTrendChart({ data }: { data: MonthlyDataPoint[] }) {
  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full">
      <LineChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 12 }} />
        <YAxis
          yAxisId="right"
          orientation="right"
          domain={[1, 5]}
          tickCount={5}
          tick={{ fontSize: 12 }}
        />
        <Tooltip content={<ChartTooltipContent />} />
        <Legend />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="volume"
          stroke="#7c3aed"
          strokeWidth={2}
          dot={false}
          name="Reviews"
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="avgRating"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={false}
          name="Avg Rating"
        />
      </LineChart>
    </ChartContainer>
  );
}
