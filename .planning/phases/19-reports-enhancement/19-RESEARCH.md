# Phase 19: Reports Enhancement - Research

**Researched:** 2026-04-03
**Domain:** Interactive metrics dashboard, Recharts sparklines, AI narrative generation, PDF export enhancement
**Confidence:** HIGH

## Summary

Phase 19 transforms the existing `/dashboard/reports` page from a generate-form + download-list into a full interactive metrics dashboard. The foundation is already in place: DailyMetric Prisma model with all required fields, an established Recharts + ChartContainer pattern from Phase 18, and the `anthropic` singleton client already wired throughout the codebase. No new npm dependencies are needed — recharts, @anthropic-ai/sdk, @react-pdf/renderer, chart.js, and chartjs-node-canvas are all already installed.

The primary implementation challenge is the date-range-driven client/server split. Date range selection must be client state (since it drives re-fetches), but data fetching and metric computation are server concerns. The Phase 18 pattern resolves this with a thin "shell" Client Component that holds state and passes search-param-style props into server-fetched content components. The same pattern applies here: a `ReportsShell` Client Component manages the active date range and renders a `ReportsDashboardContent` server component when the range changes (or via URL search params).

The PDF export enhancement requires careful reading of `report-generator.ts` and `report-template.tsx` (already done — see Code Examples below). The existing `generateReport()` function is month-scoped; the new endpoint must accept arbitrary start/end dates. The actions log for PDF is a table built with `@react-pdf/renderer` View/Text rows — the same pattern already used for keywords. The AI narrative goes into a styled View block above Key Metrics.

**Primary recommendation:** Use URL search params (`?from=YYYY-MM-DD&to=YYYY-MM-DD`) for date range state so the page is shareable and server components can read them directly. Default to last-30-days computed server-side when params are absent.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Replace `/dashboard/reports` page with an interactive metrics dashboard. Current generate form + download list preserved as collapsible section at bottom.
- **D-02:** Keep GenerateForm and DownloadButton components, collapsible at bottom.
- **D-03:** Preset buttons: 7 days, 30 days, 90 days, custom range. Default 30 days.
- **D-04:** Period-over-period comparison = preceding equal-length period automatically.
- **D-05:** Date range is client-side state that triggers re-fetch. URL search params or React state — Claude's discretion.
- **D-06:** Dual-line Recharts LineChart for Search vs Maps impressions, daily granularity.
- **D-07:** Two summary cards above chart: Search total and Maps total with % change badges.
- **D-08:** Search line = violet (#7c3aed), Maps line = emerald (#10B981).
- **D-09:** Phone Calls, Website Clicks, Direction Requests as individual stat cards: current total, previous comparison, % change badge, sparkline chart inside card.
- **D-10:** Sparklines: Recharts LineChart or AreaChart, ~120x40px, no axes/labels.
- **D-11:** 3-column responsive grid below Views on Google section.
- **D-12:** Actions log: timeline/feed format consistent with automations-feed.tsx. Type icon, timestamp, business name, details.
- **D-13:** Actions: posts published, reviews responded, descriptions pushed, services updated, attributes updated. Scoped to date range.
- **D-14:** Query from Post (status=PUBLISHED, publishedAt in range), ReviewResponse (status=PUBLISHED, createdAt in range), optimization-related activity if trackable.
- **D-15:** AI summary: 3-sentence callout card at top of dashboard, below date range selector, above charts.
- **D-16:** Claude API (claude-sonnet), generated on-demand on page load or date range change. Pass computed metrics as context.
- **D-17:** Cache narrative per profile + date range combo. Simple in-memory or database cache — Claude's discretion.
- **D-18:** Enhance existing report-generator.ts and report-template.tsx. Sparkline equivalents as chart.js server-rendered PNGs, actions log as table.
- **D-19:** "Download PDF" button passes current date range to API endpoint. PDF = same data user sees.
- **D-20:** Include AI narrative text in PDF as styled text block at top.
- **D-21:** Respect getSelectedProfileId() business filter. Scoped when selected, aggregate when not.

### Claude's Discretion
- Exact Recharts sparkline configuration (area fill, line thickness, color)
- Skeleton shapes for Suspense fallbacks during data loading
- Whether date range uses URL search params or client state
- MotionDiv animation timing
- AI narrative prompt engineering and caching strategy details
- Whether to use Suspense per section or one boundary

### Deferred Ideas (OUT OF SCOPE)
- RPT-09 (scheduled auto-delivery via email) — deferred to v1.3+
- RPT-10 (configure report recipients) — deferred to v1.3+
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RPT-01 | User can view a live interactive reports dashboard with date range selector and period-over-period comparison | Date range Client Component + server data fetching pattern established by Phase 18; DailyMetric table supports arbitrary range queries |
| RPT-02 | User can see Views on Google as dual-line chart (Search vs Maps) with summary cards and % change | Recharts LineChart established in Phase 18; DailyMetric has impressionsSearch(Desktop/Mobile) and impressionsMaps(Desktop/Mobile) — aggregate in query |
| RPT-03 | User can see Phone Calls metric with comparison, % change badge, sparkline | callClicks field in DailyMetric; sparkline via compact Recharts AreaChart with no axes |
| RPT-04 | User can see Website Clicks metric with comparison, % change badge, sparkline | websiteClicks field in DailyMetric; same sparkline pattern as RPT-03 |
| RPT-05 | User can see Direction Requests metric with comparison, % change badge, sparkline | directionRequests field in DailyMetric; same sparkline pattern |
| RPT-06 | User can see completed actions log for selected period | Query Post + ReviewResponse + ProfileDescription; buildAutomationItems pattern extended with date-range filter |
| RPT-07 | User can see AI-generated 3-sentence executive summary | anthropic singleton already in project; server action or API route; cache per profile+range |
| RPT-08 | User can download current report view as PDF | Extend generateReport() to accept dateRange instead of month; new /api/reports/dashboard-pdf route |
</phase_requirements>

---

## Standard Stack

### Core (all already installed — zero new deps)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| recharts | ^3.8.0 | Browser charts (LineChart, AreaChart) | Established in Phase 18; ChartContainer wrapper already in project |
| @anthropic-ai/sdk | ^0.78.0 | AI narrative generation | Already configured as `anthropic` singleton in src/lib/claude.ts |
| @react-pdf/renderer | ^4.3.2 | PDF generation | Already used in report-template.tsx + report-generator.ts |
| chart.js + chartjs-node-canvas | ^4.5.1 / ^5.0.0 | Server-side PNG charts for PDF | Already in renderImpressionsChart; reuse pattern for sparkline PNGs |
| next.js App Router | 14+ | Server components + URL search params | Project framework |
| prisma | existing | DailyMetric range queries, Post/ReviewResponse queries | DailyMetric @@unique([profileId, date]) enables efficient range queries |

### No New Dependencies
The v1.2 roadmap decision (STATE.md): "recharts + qrcode.react are the only new npm deps." Phase 19 requires no new packages — all libraries are already installed.

**Verification:** Run `npm view recharts version` → 3.x; all packages confirmed in package.json.

---

## Architecture Patterns

### Recommended Project Structure
```
src/app/dashboard/reports/
├── page.tsx                          # Server Component — reads searchParams, renders shell
├── reports-shell.tsx                 # Client Component — date range state, URL param sync
├── reports-dashboard-content.tsx     # Server Component — fetches all metrics data
├── views-on-google-section.tsx       # Server Component — impressions data + chart
├── views-on-google-chart.tsx         # Client Component ('use client') — Recharts dual-line
├── metric-spark-card.tsx             # Client Component — stat card + sparkline (shared)
├── actions-log.tsx                   # Server Component — Post/ReviewResponse queries
├── executive-summary.tsx             # Server Component — AI narrative fetch/cache
├── report-actions.tsx                # PRESERVED — GenerateForm + DownloadButton
└── collapsible-reports-section.tsx   # Client Component — wraps legacy form + list

src/lib/
├── report-metrics.ts                 # NEW — pure functions: computeDateRange, computePeriod, aggregateDailyMetrics, computeSparklineData, buildActionsItems
src/lib/pdf/
├── report-generator.ts               # ENHANCED — add generateDashboardReport(profileId, from, to, narrative, actions)
├── report-template.tsx               # ENHANCED — add NarrativeBlock, ActionsTable, SparklineImage sections
├── chart-renderer.ts                 # ENHANCED — add renderSparklineChart(data, color) for PDF sparklines

src/app/api/reports/
├── generate/route.ts                 # PRESERVED unchanged
├── [id]/download/route.ts            # PRESERVED unchanged
└── dashboard-pdf/route.ts            # NEW — POST {profileId, from, to} → PDF response
```

### Pattern 1: URL Search Params for Date Range (Claude's Discretion Recommendation)
**What:** Page reads `searchParams.from` and `searchParams.to` as server component props. ReportsShell Client Component updates URL params via `useRouter().push()` when preset buttons or custom date picker change.
**When to use:** When the selected date range should be shareable/bookmarkable and server components need to read it without additional API round-trips.
**Why over React state:** Server components can directly read searchParams — no useState-triggered fetch waterfall.

```typescript
// page.tsx (Server Component)
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const { from, to } = computeDateRange(params.from, params.to); // defaults to last 30d
  const selectedProfileId = await getSelectedProfileId();

  return (
    <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      <ReportsShell from={from} to={to} />
      <Suspense fallback={<DashboardSkeleton />}>
        <ReportsDashboardContent profileId={selectedProfileId} from={from} to={to} />
      </Suspense>
      <CollapsibleReportsSection />
    </MotionDiv>
  );
}
```

### Pattern 2: Period-over-Period Calculation
**What:** Given a date range [from, to], the prior period is [from - length, from - 1]. Both periods query DailyMetric and sum independently.
**Example:**
```typescript
// src/lib/report-metrics.ts
export function computePriorPeriod(from: Date, to: Date): { priorFrom: Date; priorTo: Date } {
  const lengthMs = to.getTime() - from.getTime();
  return {
    priorFrom: new Date(from.getTime() - lengthMs - 86400000),
    priorTo: new Date(from.getTime() - 86400000),
  };
}

export function aggregateDailyMetrics(metrics: DailyMetric[]) {
  return metrics.reduce(
    (acc, m) => ({
      searchImpressions: acc.searchImpressions + m.impressionsSearchDesktop + m.impressionsSearchMobile,
      mapsImpressions: acc.mapsImpressions + m.impressionsMapsDesktop + m.impressionsMapsMobile,
      websiteClicks: acc.websiteClicks + m.websiteClicks,
      callClicks: acc.callClicks + m.callClicks,
      directionRequests: acc.directionRequests + m.directionRequests,
    }),
    { searchImpressions: 0, mapsImpressions: 0, websiteClicks: 0, callClicks: 0, directionRequests: 0 }
  );
}
```

### Pattern 3: Sparkline in Card (Recharts compact AreaChart)
**What:** Client component renders a ~120x40px AreaChart with no axes, no labels, no grid, no tooltip — just the trend line.
**Key Recharts props for sparkline:**
```typescript
// metric-spark-card.tsx ('use client')
// Source: Recharts docs — ResponsiveContainer + AreaChart with all chrome removed
<ResponsiveContainer width="100%" height={40}>
  <AreaChart data={sparkData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
    <defs>
      <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor={color} stopOpacity={0.15} />
        <stop offset="95%" stopColor={color} stopOpacity={0} />
      </linearGradient>
    </defs>
    <Area
      type="monotone"
      dataKey="value"
      stroke={color}
      strokeWidth={1.5}
      fill={`url(#grad-${id})`}
      dot={false}
      isAnimationActive={false}
    />
  </AreaChart>
</ResponsiveContainer>
```

### Pattern 4: AI Narrative — Server Action with In-Memory Cache
**What:** Server function calls Claude API with metrics as context, returns 3-sentence string. Cache key = `${profileId ?? 'all'}-${from}-${to}`.
**Caching strategy recommendation (Claude's discretion):** In-memory Map on the server module. Acceptable for an internal tool — Railway restarts clear it, which is fine since metrics change daily anyway. Database caching would require a schema change and a new table.

```typescript
// executive-summary.tsx (Server Component)
const narrativeCache = new Map<string, { text: string; cachedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function generateNarrative(
  metrics: AggregatedMetrics,
  profileName: string | null,
  from: string,
  to: string,
  profileId: string | null
): Promise<string> {
  const key = `${profileId ?? 'all'}-${from}-${to}`;
  const cached = narrativeCache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.text;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 256,
    messages: [{
      role: "user",
      content: `Write a 3-sentence executive summary for a Google Business Profile performance report.
Profile: ${profileName ?? 'All Profiles'}
Period: ${from} to ${to}
Search impressions: ${metrics.searchImpressions} (${metrics.searchPct > 0 ? '+' : ''}${metrics.searchPct}% vs prior period)
Maps impressions: ${metrics.mapsImpressions} (${metrics.mapsPct > 0 ? '+' : ''}${metrics.mapsPct}% vs prior period)
Phone calls: ${metrics.callClicks} (${metrics.callsPct > 0 ? '+' : ''}${metrics.callsPct}% vs prior period)
Website clicks: ${metrics.websiteClicks} (${metrics.clicksPct > 0 ? '+' : ''}${metrics.clicksPct}% vs prior period)
Direction requests: ${metrics.directionRequests} (${metrics.directionsPct > 0 ? '+' : ''}${metrics.directionsPct}% vs prior period)

Write 3 professional sentences summarizing performance and key trends. Be specific with numbers.`
    }]
  });

  const text = (message.content[0] as { text: string }).text;
  narrativeCache.set(key, { text, cachedAt: Date.now() });
  return text;
}
```

### Pattern 5: PDF Export with Date Range
**What:** New `/api/reports/dashboard-pdf` POST route accepts `{ profileId, from, to }`. Generates PDF on-demand using enhanced `generateDashboardReport()` function. Returns PDF binary with Content-Disposition.
**Key difference from existing:** The existing `generateReport()` is month-scoped. New function accepts arbitrary dates, passes narrative string and actions log data in.

```typescript
// report-generator.ts — new export (additive, does not break existing)
export async function generateDashboardReport(
  profileId: string,
  from: Date,
  to: Date,
  narrativeText: string | null,
  actions: ActionItem[]
): Promise<Uint8Array>
```

### Pattern 6: PDF Sparklines via chart.js
**What:** Reuse `renderImpressionsChart` pattern with a new `renderSparklineChart(data, color)` that produces a small 300x80px PNG with no axes/labels.
**chart.js config for sparklines:**
```typescript
// chart-renderer.ts — additive export
const sparkConfig: ChartConfiguration = {
  type: "line",
  data: { labels: data.map(d => d.date), datasets: [{ data: data.map(d => d.value), borderColor: color, borderWidth: 2, fill: false, tension: 0.3, pointRadius: 0 }] },
  options: {
    animation: false, responsive: false,
    plugins: { legend: { display: false }, title: { display: false } },
    scales: { x: { display: false }, y: { display: false } },
  },
};
```

### Anti-Patterns to Avoid
- **Fetching DailyMetrics in a Client Component:** All Prisma queries must stay in Server Components or API routes. Client Components receive pre-computed data as props.
- **Using `window.location.reload()` for date range changes:** The existing report-actions.tsx does this on generate; don't replicate for date range. Use router.push() with updated search params instead.
- **Calling Claude API directly from a Client Component:** AI narrative must be generated server-side (Server Component or API route). Never expose ANTHROPIC_API_KEY to client.
- **Passing Date objects across the server/client boundary:** Serialize as ISO string `YYYY-MM-DD`. The Phase 18 decision confirms: "Pure functions accept plain Date objects — safe for server and client contexts," but serialization across boundaries requires strings.
- **Blocking the entire page on AI narrative:** Generate narrative in a separate `<Suspense>` boundary so charts render while AI call is in flight. AI calls can take 2-5 seconds.
- **Month-only granularity in the new PDF generator:** The existing `generateReport()` uses `getMonthRange()`. The new dashboard PDF function must NOT use month boundaries — it uses the exact from/to dates the user sees.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sparkline charts | Custom SVG path | Recharts AreaChart (no axes) | Edge cases: empty data, single data point, negative values |
| Period-over-period % change | Inline arithmetic | Pure function `computePctChange(current, prev)` in report-metrics.ts | Reused in 5 places (4 metric cards + PDF); divide-by-zero must be handled consistently |
| PDF chart images | PNG generation from scratch | Reuse `renderImpressionsChart` pattern via chartjs-node-canvas | Already handles canvas lifecycle, lazy init, background color |
| AI client instantiation | `new Anthropic()` inline | `anthropic` singleton from `src/lib/claude.ts` | Singleton prevents multiple client instances in dev hot-reload |
| Date range defaults | `new Date()` inline math | `computeDateRange(from?, to?)` pure function in report-metrics.ts | Centralize "last 30 days" default logic; tests can pass fixed dates |
| Actions log data building | Inline Promise.all in component | `buildActionsItems()` pure function (mirroring `buildAutomationItems`) | Same testability pattern as Phase 16 and Phase 18 |

**Key insight:** This phase is primarily assembly of existing patterns. The risk is in the edges — empty data states, the server/client serialization boundary, and the PDF enhancement touching existing working code.

---

## Common Pitfalls

### Pitfall 1: searchParams in Next.js 14+ App Router are Promises
**What goes wrong:** Destructuring `searchParams` directly without `await` causes type errors and runtime failures in Next.js 14.2+.
**Why it happens:** Next.js made searchParams async in Next.js 15, but the project may be on 14+ where the type is `Promise<...>` in some configurations.
**How to avoid:** Always `await searchParams` or use `use(searchParams)` in Client Components. Check current Next.js version: `npm list next`.
**Warning signs:** TypeScript error "Property 'from' does not exist on type 'Promise<...>'"

### Pitfall 2: Recharts ResponsiveContainer needs explicit height in a flex/grid container
**What goes wrong:** Sparkline renders at 0px height because the parent flex card doesn't provide a height reference.
**Why it happens:** ResponsiveContainer uses percentage heights relative to its parent. In a flex column, the parent has no intrinsic height.
**How to avoid:** Use `height={40}` as a fixed number (not percentage) on ResponsiveContainer, or set `className="h-10"` on the wrapper div and use `height="100%"`.
**Warning signs:** Chart renders but is invisible; inspect shows 0px height.

### Pitfall 3: chart.js ChartJSNodeCanvas singleton in Next.js — "canvas" module not available during SSR import
**What goes wrong:** `chartjs-node-canvas` uses Node.js `canvas` native module. If it's imported at module level, Next.js bundler may try to include it in edge/client bundles.
**Why it happens:** The existing `chart-renderer.ts` already handles this with `lazy-load chartjs-node-canvas` via dynamic import. Any new chart renderer functions MUST follow the same lazy-init pattern.
**How to avoid:** Add new sparkline renderer as a function in the same `chart-renderer.ts` file — it inherits the existing lazy singleton.
**Warning signs:** Build error "Module not found: canvas" or runtime error at import time.

### Pitfall 4: AI narrative blocks page render if awaited at top level
**What goes wrong:** Page appears stuck loading for 3-8 seconds while Claude API responds.
**Why it happens:** Claude API calls are network-bound and can be slow under load.
**How to avoid:** Wrap `<ExecutiveSummary>` in its own `<Suspense fallback={<NarrativeSkeleton />}>` boundary, separate from the charts boundary. This allows charts to render immediately while narrative is in flight.
**Warning signs:** Entire dashboard waits for AI call before anything renders.

### Pitfall 5: DailyMetric date field is `@db.Date` — stored without time component
**What goes wrong:** Range queries using `DateTime` with time components can miss boundary records.
**Why it happens:** `@db.Date` in PostgreSQL stores only the date. Comparing against `new Date()` (which includes time) may exclude the current day.
**How to avoid:** For range queries, set `from` to start-of-day UTC and `to` to end-of-day UTC: `to = new Date(toDate.getTime() + 86400000 - 1)`. Reference Phase 18 decision: "UTC-based date math throughout computeMonthlyData — matches PostgreSQL UTC storage."
**Warning signs:** Today's data missing from charts; off-by-one at period boundaries.

### Pitfall 6: PDF generation modifies existing `generateReport()` function breaking existing reports
**What goes wrong:** Changing `generateReport()` signature or behavior breaks the `/api/reports/[id]/download` route which calls it.
**Why it happens:** The STATE.md research flag explicitly warns: "Read src/lib/pdf/report-generator.ts fully before writing new chart sections."
**How to avoid:** Add `generateDashboardReport()` as a NEW export alongside the existing `generateReport()`. Do not modify the existing function's signature or behavior.
**Warning signs:** Existing "Generated Reports" download links return errors after phase implementation.

---

## Code Examples

### Existing DailyMetric Query Pattern (from report-generator.ts)
```typescript
// Source: src/lib/pdf/report-generator.ts lines 67-73
const currentDailyMetrics = await prisma.dailyMetric.findMany({
  where: {
    profileId,
    date: { gte: curStart, lte: curEnd },
  },
  orderBy: { date: "asc" },
});
```

### Existing sumMetrics Pattern (extract and reuse)
```typescript
// Source: src/lib/pdf/report-generator.ts lines 29-54
// sumMetrics() already aggregates search/maps desktop/mobile into totals.
// Phase 19: Extract this into src/lib/report-metrics.ts and extend to
// return searchImpressions and mapsImpressions separately (not just totalImpressions).
```

### Existing ChartContainer + Recharts Pattern (from Phase 18)
```typescript
// Source: src/app/dashboard/reviews/metrics/volume-rating-trend-chart.tsx
const chartConfig = {
  search: { label: "Search", color: "#7c3aed" },
  maps:   { label: "Maps",   color: "#10B981" },
} satisfies ChartConfig;

// ChartContainer handles ResponsiveContainer + theme CSS vars
<ChartContainer config={chartConfig} className="h-[300px] w-full">
  <LineChart data={data} ...>
    ...
  </LineChart>
</ChartContainer>
```

### Existing buildAutomationItems Pattern (actions log reference)
```typescript
// Source: src/app/dashboard/automations-feed.tsx lines 37-85
// buildAutomationItems() takes Post[], ReviewResponse[], ProfileDescription[] and
// returns sorted AutomationItem[]. Phase 19 extends this for the actions log:
// - Add date range filter: filter by time >= from && time <= to
// - Add more action types: services_updated, attributes_updated (if trackable)
// - Remove the .slice(0, 20) limit — show all in range
```

### Existing @react-pdf/renderer Table Pattern (from report-template.tsx)
```typescript
// Source: src/lib/pdf/report-template.tsx lines 250-270
// Keywords table pattern — reuse for Actions Log table in PDF:
<View style={styles.table}>
  <View style={styles.tableHeaderRow}>
    <Text style={[styles.tableCellKeyword, styles.tableHeaderText]}>Action</Text>
    <Text style={[styles.tableCellImpressions, styles.tableHeaderText]}>Date</Text>
  </View>
  {actions.map((a, i) => (
    <View style={styles.tableRow} key={i}>
      <Text style={styles.tableCellKeyword}>{a.label} — {a.profileName}</Text>
      <Text style={styles.tableCellImpressions}>{a.date}</Text>
    </View>
  ))}
</View>
```

### Existing claude.ts Singleton (use directly)
```typescript
// Source: src/lib/claude.ts
import { anthropic } from "@/lib/claude";
// anthropic is Anthropic SDK client, use anthropic.messages.create(...)
// Model to use per D-16: "claude-sonnet" — use "claude-sonnet-4-5" (current sonnet)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Month-only report generation | Arbitrary date range dashboard metrics | Phase 19 | New `generateDashboardReport()` alongside existing month-based function |
| Static download page | Interactive metrics dashboard | Phase 19 | page.tsx replaces generate-form-only layout |
| No period comparison in browser | Period-over-period with % change badges | Phase 19 | Consistent with Phase 18 review metrics pattern |
| No AI narrative in reports | AI-generated 3-sentence summary | Phase 19 | New callout card, cached per profile+range |

**Note on existing PDF:** The current PDF uses month-scoped data. The enhanced PDF for D-18/D-19 uses arbitrary date ranges. The old generate-and-download workflow (GenerateForm → /api/reports/generate → Report record → /api/reports/[id]/download) is PRESERVED unchanged per D-02.

---

## Open Questions

1. **Are services_updated and attributes_updated trackable for the actions log?**
   - What we know: ProfileDescription has `pushedAt` field (used in automations feed). Post has `publishedAt`. ReviewResponse has `createdAt`.
   - What's unclear: There is no `ProfileService.pushedAt` or `ProfileAttribute.pushedAt` in the schema. Services/attributes go through the GBP API directly — no timestamp recorded in DB.
   - Recommendation: D-13 says "if trackable." Per schema review, services and attributes are NOT trackable (no timestamp fields). Actions log should cover: posts published, reviews responded, descriptions pushed. Document this limitation explicitly in implementation.

2. **Does the `Report` model need a new field for dashboard PDF downloads?**
   - What we know: The existing Report model has `profileId`, `month`, `filePath`, `createdAt`. The new dashboard PDF is NOT tied to a Report record — it's generated on-demand from date range params.
   - What's unclear: Whether the product wants to persist dashboard PDF records.
   - Recommendation: No schema change needed. The new `/api/reports/dashboard-pdf` route generates and streams the PDF without creating a Report record. This keeps the existing Report model semantically clean (month-scoped PDFs only).

3. **Should `collectiveNarrative` handle "All Profiles" aggregate case?**
   - What we know: D-21 says "when no profile selected, show aggregate." AI narrative receives metrics in context.
   - What's unclear: Whether a profile-aggregate narrative with 200 profiles' data is meaningful.
   - Recommendation: Pass `profileName = "All Profiles"` and the aggregate metrics. The prompt handles it — no special case needed.

---

## Environment Availability

Step 2.6: SKIPPED — no new external dependencies. All tools (Recharts, @react-pdf/renderer, chart.js, chartjs-node-canvas, @anthropic-ai/sdk) already confirmed installed in package.json. ANTHROPIC_API_KEY assumed present (already used by post-generator.ts, review-responder.ts, etc.).

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (vitest.config.mts) |
| Config file | `/Users/christopherballlard/Projects/MapsAI/vitest.config.mts` |
| Quick run command | `npm run test` (runs `vitest run`) |
| Full suite command | `npm run test` |
| Test directory | `tests/` (lib/ and app/ subdirs) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RPT-01 | `computeDateRange()` defaults to last 30 days; `computePriorPeriod()` returns preceding equal-length period | unit | `npm run test -- tests/lib/report-metrics.test.ts` | ❌ Wave 0 |
| RPT-02 | `aggregateDailyMetrics()` correctly sums search/maps desktop+mobile; `computePctChange()` handles zero-prior case | unit | `npm run test -- tests/lib/report-metrics.test.ts` | ❌ Wave 0 |
| RPT-03 | `computeSparklineData()` returns correct daily values for callClicks | unit | `npm run test -- tests/lib/report-metrics.test.ts` | ❌ Wave 0 |
| RPT-04 | `computeSparklineData()` returns correct daily values for websiteClicks | unit | same as RPT-03 | ❌ Wave 0 |
| RPT-05 | `computeSparklineData()` returns correct daily values for directionRequests | unit | same as RPT-03 | ❌ Wave 0 |
| RPT-06 | `buildActionsLog()` filters by date range; excludes actions outside range | unit | `npm run test -- tests/lib/report-metrics.test.ts` | ❌ Wave 0 |
| RPT-07 | AI narrative (integration with external API) | manual-only | N/A — external Claude API | — |
| RPT-08 | PDF generation (renders without error) | manual-only | N/A — requires @react-pdf/renderer render pipeline | — |

### Sampling Rate
- **Per task commit:** `npm run test`
- **Per wave merge:** `npm run test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/lib/report-metrics.test.ts` — covers RPT-01 through RPT-06 pure functions
- [ ] `src/lib/report-metrics.ts` — pure functions file (computeDateRange, computePriorPeriod, aggregateDailyMetrics, computePctChange, computeSparklineData, buildActionsLog) must exist before tests can run

*(Existing tests: tests/lib/review-metrics.test.ts — provides model for report-metrics tests. No changes needed to existing test files.)*

---

## Project Constraints (from CLAUDE.md)

No directives in CLAUDE.md directly constrain this phase. CLAUDE.md is focused on VineyardGrowth agency work (Google Docs MCP, SOP generation) which is unrelated to the MapsAI software project.

The following directives from the GSD workflow apply:
- `gsd-tools.cjs` must be called via absolute path: `/Users/christopherballlard/.claude/get-shit-done/bin/gsd-tools.cjs`
- Brand: violet `#7c3aed`, zinc neutrals, Inter font — already applied via Tailwind config

---

## Sources

### Primary (HIGH confidence)
- Direct codebase reads — `src/lib/pdf/report-generator.ts`, `report-template.tsx`, `chart-renderer.ts`, `report-actions.tsx`, `reports/page.tsx` — full understanding of existing PDF pipeline
- Direct codebase reads — `src/app/dashboard/automations-feed.tsx` — actions log reference pattern
- Direct codebase reads — `src/app/dashboard/reviews/metrics/*.tsx` + `src/lib/review-metrics.ts` — Phase 18 Recharts patterns
- Direct codebase reads — `prisma/schema.prisma` lines 162-178 — DailyMetric model confirmed
- Direct codebase reads — `src/lib/claude.ts` — Anthropic singleton confirmed
- Direct codebase reads — `package.json` — all required packages confirmed at stated versions
- Direct codebase reads — `vitest.config.mts`, `tests/` directory — test framework confirmed

### Secondary (MEDIUM confidence)
- Recharts AreaChart sparkline pattern — consistent with recharts ^3.8.0 API (AreaChart, ResponsiveContainer, Area component props verified by Phase 18 implementation)
- chart.js sparkline config — consistent with existing chart-renderer.ts approach (ChartConfiguration type, renderToBuffer pattern)

### Tertiary (LOW confidence)
- None — all claims grounded in direct code reads or established project patterns

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — all packages confirmed in package.json, zero new deps
- Architecture: HIGH — patterns directly lifted from Phase 16, Phase 17, Phase 18 codebase
- Pitfalls: HIGH — grounded in actual code review (existing lazy-load pattern, Date field type, existing singleton)
- Test patterns: HIGH — vitest.config.mts and existing test files directly read

**Research date:** 2026-04-03
**Valid until:** 2026-05-03 (stable stack, no fast-moving dependencies)
