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
import { BarChart3 } from "lucide-react";

// D-08: violet for Search, emerald for Maps
const chartConfig = {
  search: { label: "Search", color: "#7c3aed" },
  maps: { label: "Maps", color: "#10B981" },
} satisfies ChartConfig;

interface ViewsOnGoogleChartProps {
  data: Array<{ date: string; search: number; maps: number }>;
}

export function ViewsOnGoogleChart({ data }: ViewsOnGoogleChartProps) {
  if (data.length === 0) {
    return (
      <div className="h-[300px] w-full flex flex-col items-center justify-center text-zinc-400 gap-2">
        <BarChart3 size={32} />
        <p className="text-sm">No impression data for this period</p>
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full">
      <LineChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip content={<ChartTooltipContent />} />
        <Legend />
        <Line
          type="monotone"
          dataKey="search"
          stroke="#7c3aed"
          strokeWidth={2}
          dot={false}
          name="Search"
        />
        <Line
          type="monotone"
          dataKey="maps"
          stroke="#10B981"
          strokeWidth={2}
          dot={false}
          name="Maps"
        />
      </LineChart>
    </ChartContainer>
  );
}
