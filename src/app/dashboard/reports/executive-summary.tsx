import { Sparkles } from "lucide-react";
import { anthropic } from "@/lib/claude";

// Module-level in-memory cache — shared across requests within one server process
const narrativeCache = new Map<string, { text: string; cachedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface ExecutiveSummaryProps {
  metrics: {
    searchImpressions: number;
    mapsImpressions: number;
    websiteClicks: number;
    callClicks: number;
    directionRequests: number;
    searchPct: number | null;
    mapsPct: number | null;
    clicksPct: number | null;
    callsPct: number | null;
    directionsPct: number | null;
  };
  profileName: string | null;
  from: string;
  to: string;
  profileId: string | null;
}

function formatPct(pct: number | null): string {
  if (pct === null) return "N/A";
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

export async function ExecutiveSummary({
  metrics,
  profileName,
  from,
  to,
  profileId,
}: ExecutiveSummaryProps) {
  const cacheKey = `${profileId ?? "all"}-${from}-${to}`;

  let text: string;

  // Check cache
  const cached = narrativeCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    text = cached.text;
  } else {
    try {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 256,
        messages: [
          {
            role: "user",
            content: `Write a 3-sentence executive summary for a Google Business Profile performance report.
Profile: ${profileName ?? "All Profiles"}
Period: ${from} to ${to}
Search impressions: ${metrics.searchImpressions} (${formatPct(metrics.searchPct)} vs prior period)
Maps impressions: ${metrics.mapsImpressions} (${formatPct(metrics.mapsPct)} vs prior period)
Phone calls: ${metrics.callClicks} (${formatPct(metrics.callsPct)} vs prior period)
Website clicks: ${metrics.websiteClicks} (${formatPct(metrics.clicksPct)} vs prior period)
Direction requests: ${metrics.directionRequests} (${formatPct(metrics.directionsPct)} vs prior period)

Write 3 professional sentences summarizing performance and key trends. Be specific with numbers.`,
          },
        ],
      });

      text = (message.content[0] as { type: string; text: string }).text;

      // Cache the result
      narrativeCache.set(cacheKey, { text, cachedAt: Date.now() });
    } catch {
      text = "Unable to generate summary. Metrics are shown below.";
    }
  }

  return (
    <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-6">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-violet-600" />
        <span className="text-sm font-medium text-violet-700">AI Executive Summary</span>
      </div>
      <p className="text-sm text-zinc-700 leading-relaxed">{text}</p>
    </div>
  );
}
