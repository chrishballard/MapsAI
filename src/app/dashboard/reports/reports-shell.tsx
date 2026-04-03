'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

interface ReportsShellProps {
  from: string;
  to: string;
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function computePresetDates(days: number): { from: string; to: string } {
  const today = new Date();
  const todayStr = toYMD(today);
  const fromDate = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: toYMD(fromDate), to: todayStr };
}

const PRESETS = [
  { label: '7 Days', days: 7 },
  { label: '30 Days', days: 30 },
  { label: '90 Days', days: 90 },
] as const;

export function ReportsShell({ from, to }: ReportsShellProps) {
  const router = useRouter();

  const pushRange = useCallback(
    (newFrom: string, newTo: string) => {
      router.push(`/dashboard/reports?from=${newFrom}&to=${newTo}`);
    },
    [router]
  );

  // Detect active preset: compute each preset's from/to and compare to current props
  const activePreset = PRESETS.find(({ days }) => {
    const preset = computePresetDates(days);
    return preset.from === from && preset.to === to;
  });

  // Custom is active when none of the presets match
  const isCustom = !activePreset;

  return (
    <div className="space-y-3">
      {/* Preset buttons row */}
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map(({ label, days }) => {
          const isActive = activePreset?.label === label;
          return (
            <button
              key={label}
              type="button"
              onClick={() => {
                const preset = computePresetDates(days);
                pushRange(preset.from, preset.to);
              }}
              className={cn(
                'px-4 py-1.5 rounded-lg border text-sm font-medium transition-colors',
                isActive
                  ? 'bg-violet-100 text-violet-700 border-violet-300'
                  : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
              )}
            >
              {label}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => {
            if (!isCustom) {
              // Open custom with current range
              pushRange(from, to);
            }
          }}
          className={cn(
            'px-4 py-1.5 rounded-lg border text-sm font-medium transition-colors',
            isCustom
              ? 'bg-violet-100 text-violet-700 border-violet-300'
              : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
          )}
        >
          Custom
        </button>
      </div>

      {/* Custom date inputs — visible only when custom is active */}
      {isCustom && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-zinc-500 whitespace-nowrap">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => pushRange(e.target.value, to)}
              className="border border-zinc-200 rounded-lg px-3 py-1.5 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-300"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-zinc-500 whitespace-nowrap">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => pushRange(from, e.target.value)}
              className="border border-zinc-200 rounded-lg px-3 py-1.5 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-300"
            />
          </div>
        </div>
      )}
    </div>
  );
}
