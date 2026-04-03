'use client';

import {
  AreaChart,
  Area,
  ResponsiveContainer,
} from "recharts";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { SparklinePoint } from "@/lib/report-metrics";

interface MetricSparkCardProps {
  title: string;
  value: number;
  previousValue: number;
  pctChange: number | null;
  sparkData: SparklinePoint[];
  color: string;
  id: string;
}

export function MetricSparkCard({
  title,
  value,
  pctChange,
  sparkData,
  color,
  id,
}: MetricSparkCardProps) {
  const gradientId = `spark-gradient-${id}`;
  const gradientUrl = `url(#${gradientId})`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-zinc-500">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold text-zinc-900">{value.toLocaleString()}</div>
        <div className="flex items-center gap-1.5 mt-2">
          {pctChange === null ? (
            <>
              <Minus className="w-4 h-4 text-zinc-400" />
              <span className="text-sm text-zinc-400">No prior data</span>
            </>
          ) : pctChange >= 0 ? (
            <>
              <ArrowUp className="w-4 h-4 text-emerald-600" />
              <span className="text-sm font-medium text-emerald-600">
                {Math.abs(pctChange)}% vs prior period
              </span>
            </>
          ) : (
            <>
              <ArrowDown className="w-4 h-4 text-red-600" />
              <span className="text-sm font-medium text-red-600">
                {Math.abs(pctChange)}% vs prior period
              </span>
            </>
          )}
        </div>
        <div className="mt-3">
          <ResponsiveContainer width="100%" height={40}>
            <AreaChart data={sparkData}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                fill={gradientUrl}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
