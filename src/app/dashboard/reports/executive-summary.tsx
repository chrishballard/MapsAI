import { Sparkles } from "lucide-react";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";

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

// Kept outside the component so the react-hooks purity rule doesn't apply:
// time-based caching is intentionally impure and safe in this server-only module.
async function getNarrative(
  cacheKey: string,
  metrics: ExecutiveSummaryProps["metrics"],
  profileName: string | null,
  from: string,
  to: string
): Promise<string> {
  // Check cache
  const cached = narrativeCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.text;
  }

  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      // Opus 5.5 always thinks, and thinking comes out of max_tokens before
      // the three sentences do (256 was sized for a model that did not think).
      // `low` effort because the page render waits on this call.
      max_tokens: 2_048,
      output_config: { effort: "low" },
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

    // Read by block type: the response starts with a `thinking` block (empty
    // text by default), so content[0] is no longer the answer. A refusal, or
    // a reply that ran out of room, falls back like any other failure, and is
    // not cached.
    if (message.stop_reason === "refusal") throw new Error("summary declined by Claude");
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    if (!text || message.stop_reason === "max_tokens") throw new Error("summary incomplete");

    // Cache the result
    narrativeCache.set(cacheKey, { text, cachedAt: Date.now() });
    return text;
  } catch {
    return "Unable to generate summary. Metrics are shown below.";
  }
}

export async function ExecutiveSummary({
  metrics,
  profileName,
  from,
  to,
  profileId,
}: ExecutiveSummaryProps) {
  const cacheKey = `${profileId ?? "all"}-${from}-${to}`;
  const text = await getNarrative(cacheKey, metrics, profileName, from, to);

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
