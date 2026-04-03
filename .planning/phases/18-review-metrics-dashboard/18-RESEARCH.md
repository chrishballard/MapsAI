# Phase 18: Review Metrics Dashboard - Research

**Researched:** 2026-04-03
**Domain:** Recharts data visualization, Prisma date aggregation, Next.js Server Component patterns
**Confidence:** HIGH

## Summary

Phase 18 delivers a read-only analytics page at `/dashboard/reviews/metrics`. All architectural decisions were pre-made in the CONTEXT.md discussion: route, layout, chart types, color scheme, threshold values, and date range logic are all locked. The research task is to verify the implementation approach is correct against the actual codebase and flag any technical traps.

The primary technical concern from STATE.md — "Prisma `groupBy` date aggregation with timezone" — is now resolved: Prisma's `groupBy` only accepts exact scalar field values and cannot group by derived expressions like year-month. The correct approach is fetching all reviews within the 12-month window and grouping in JavaScript. This is safe because even a large client roster produces a bounded result set (12 months × reviews per profile), matches the existing fetch-and-compute server component pattern used throughout this project, and avoids raw SQL entirely.

The Recharts + ChartContainer infrastructure is fully in place. The gauge page confirmed the integration pattern. Recharts 3.8.1 is installed and the `BarChart` with `layout="vertical"` and dual-axis `LineChart` are standard Recharts features that work within the existing `ChartContainer` wrapper. No new npm dependencies are needed.

**Primary recommendation:** Implement all data fetching as pure functions co-located in the server component file (matching the dashboard-upgrades pattern), use JavaScript date grouping instead of Prisma `groupBy` for monthly aggregation, and render charts as client components receiving pre-computed data arrays.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** New route at `/dashboard/reviews/metrics`
- **D-02:** Tab-style toggle or link on reviews page header to navigate between "Reviews" and "Metrics"
- **D-03:** Add "Review Metrics" link in sidebar under/near "Reviews" nav item; use `TrendingUp` or `BarChart3` icon from lucide-react
- **D-04:** Top row: two summary stat cards — (1) Total Review Count with trend badge (RVMT-01), (2) Days Since Last Review with status indicator (RVMT-04)
- **D-05:** Below stat cards: two chart cards side by side in responsive 2-column grid — (1) Star Rating Distribution horizontal bar chart (RVMT-02), (2) Monthly Review Volume + Average Rating Trend dual-line chart (RVMT-03, RVMT-05)
- **D-06:** Use Recharts `BarChart` (horizontal, `layout="vertical"`) for rating distribution; `LineChart` for monthly volume/rating trend. Both wrapped in `ChartContainer` from `src/components/ui/chart.tsx`
- **D-07:** Color scheme: violet (`#7c3aed`) for primary data series, zinc for secondary elements, amber for star rating bars to match existing `StarRating` component
- **D-08:** Period-over-period: rolling 30-day window vs prior 30 days. Display as "X% vs prior 30 days" with up/down arrow and green/red coloring
- **D-09:** Recency thresholds: good (green) = 0–14 days, warning (amber) = 15–30 days, critical (red) = 31+ days
- **D-10:** Days since last review: large number, color-coded badge, brief message ("Profile is active" / "Consider requesting reviews" / "No reviews in over a month")
- **D-11:** Monthly dual-line chart: volume as primary line (left Y-axis, count), avg rating as secondary line (right Y-axis, 1–5 scale). Default to last 12 months. X-axis shows months
- **D-12:** Date range displayed as subtitle text on chart card (e.g., "Apr 2025 - Apr 2026")
- **D-13:** Single page-level "Data through [date]" subtitle using most recent `Review.reviewDate` from DB. Format: "Data through Mar 31, 2026"
- **D-14:** Respect `getSelectedProfileId()` — scoped to profile when selected, aggregate across all profiles when none selected

### Claude's Discretion
- Exact Recharts configuration (margins, tick formatting, tooltip design, legend placement)
- Whether stat cards use Card directly or a new MetricCard variant
- Skeleton shapes and count for Suspense fallbacks
- Whether to use Suspense per chart or one boundary for the whole page
- MotionDiv animation timing and stagger pattern
- How to handle profiles with zero reviews (empty state messaging)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.

RVMT-06 (QR code review requests), RVMT-07 (AI tips for more reviews), and RVMT-08 (review keyword analysis) are deferred to v1.3+ in REQUIREMENTS.md.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RVMT-01 | User can see total review count with period-over-period trend badge (% change) | Rolling 30-day window computed in server component; `prisma.review.count` with date range filters; Badge component for trend indicator |
| RVMT-02 | User can see star rating distribution as a horizontal bar chart (5 to 1 stars with counts) | Prisma `groupBy` on exact `rating` scalar field works correctly; Recharts `BarChart` with `layout="vertical"` in ChartContainer |
| RVMT-03 | User can see monthly review volume as a line chart with date range | Fetch 12 months of reviews, group in JS by year-month; Recharts `LineChart` with date range subtitle |
| RVMT-04 | User can see days since last review with status indicator (good/warning/critical) | `prisma.review.findFirst({ orderBy: { reviewDate: 'desc' } })`; Badge component with threshold logic |
| RVMT-05 | User can see average rating trend over time as a second line on the monthly chart | Same dataset as RVMT-03; second `Line` with `yAxisId="right"` and dedicated `YAxis` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| recharts | 3.8.1 (installed) | Bar + Line charts | Locked decision; already used for optimization gauge |
| @prisma/client | 7.4.2 (installed) | Data fetching | Project ORM; all DB queries go through Prisma |
| lucide-react | installed | Icons (TrendingUp, BarChart3, ArrowUp, ArrowDown) | Project icon library; already used in sidebar |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ChartContainer (src/components/ui/chart.tsx) | local | Recharts wrapper with CSS var theming | Wrap all Recharts charts — mandatory per D-06 |
| Card/CardHeader/CardTitle/CardContent | local | Chart + stat containers | All chart and metric card wrappers |
| Badge (src/components/ui/badge.tsx) | local | Trend badge and status indicators | Trend % change and good/warning/critical status |
| Skeleton (src/components/ui/skeleton.tsx) | local | Suspense fallbacks | Loading state for chart areas |
| MotionDiv (src/components/motion-wrapper.tsx) | local | Entrance animations | Page-level stagger animation |
| getSelectedProfileId (src/lib/selected-profile.ts) | local | Business filter cookie | All queries must call this first |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JS date grouping | Prisma `groupBy` + `$queryRaw` | Prisma groupBy cannot express year-month truncation; raw SQL adds DB coupling. JS grouping is simpler, fast enough for bounded 12-month dataset |
| JS date grouping | `$queryRaw` with `DATE_TRUNC` | Raw SQL works but breaks the no-raw-SQL pattern established in this codebase and requires sanitizing profileId param |

**Installation:** No new npm installs required. All dependencies are already installed.

## Architecture Patterns

### Recommended Project Structure

```
src/app/dashboard/reviews/metrics/
├── page.tsx                    # Server Component — data fetch, Suspense shell
├── review-metrics-content.tsx  # Server Component — data computation, layout
├── rating-distribution-chart.tsx  # Client Component — Recharts BarChart
└── volume-rating-trend-chart.tsx  # Client Component — Recharts LineChart
```

Stat cards (RVMT-01, RVMT-04) are inline server-rendered within `review-metrics-content.tsx` — no client component needed since they display static values.

### Pattern 1: Server Component Data Fetch with JS Aggregation

All review data fetched in `review-metrics-content.tsx` (Server Component), computed into plain arrays, then passed as props to client chart components.

**What:** Single Prisma query fetches all reviews for the 12-month window (plus prior 30 days for trend). Aggregations (monthly grouping, rating distribution, trend calc) happen in pure JS functions co-located in the file.

**When to use:** Any time Prisma groupBy cannot express the grouping key (e.g., year-month truncation). Keeps data layer simple, keeps raw SQL out of the codebase.

**Example:**
```typescript
// Source: established pattern from src/app/dashboard/stats-grid.tsx and Phase 16 decisions
// In review-metrics-content.tsx (Server Component)
import { prisma } from "@/lib/prisma";
import { getSelectedProfileId } from "@/lib/selected-profile";

export async function ReviewMetricsContent() {
  const selectedProfileId = await getSelectedProfileId();
  const profileFilter = selectedProfileId ? { profileId: selectedProfileId } : {};

  const now = new Date();
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  // Extend to cover prior 30-day window for trend badge
  const thirtyTwoDaysAgo = new Date(now.getTime() - 62 * 24 * 60 * 60 * 1000);

  const [reviews, latestReview] = await Promise.all([
    prisma.review.findMany({
      where: {
        ...profileFilter,
        reviewDate: { gte: thirtyTwoDaysAgo },
      },
      select: { rating: true, reviewDate: true },
      orderBy: { reviewDate: "desc" },
    }),
    prisma.review.findFirst({
      where: profileFilter,
      orderBy: { reviewDate: "desc" },
      select: { reviewDate: true },
    }),
  ]);

  // Total count (separate query for all-time total)
  const totalCount = await prisma.review.count({ where: profileFilter });

  // Pure function aggregations (testable, co-located)
  const trendData = computeTrend(reviews, now);
  const ratingDist = computeRatingDistribution(reviews);
  const monthlyData = computeMonthlyData(reviews, now);
  const daysSinceLast = computeDaysSince(latestReview?.reviewDate ?? null, now);
  const dataThroughLabel = latestReview?.reviewDate
    ? formatDataThrough(latestReview.reviewDate)
    : null;

  return (/* JSX */);
}
```

### Pattern 2: Recharts Dual-Axis LineChart in ChartContainer

**What:** Two `Line` components on the same `LineChart`, each referencing a different `YAxis` via `yAxisId`.

**When to use:** RVMT-03 + RVMT-05 — monthly volume (count, left axis) and avg rating (1–5 scale, right axis).

**Example:**
```typescript
// Source: Recharts 3.x docs; verified against installed recharts 3.8.1 API
// In volume-rating-trend-chart.tsx ('use client')
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { ChartContainer } from "@/components/ui/chart";

const chartConfig = {
  volume: { label: "Reviews", color: "#7c3aed" },
  avgRating: { label: "Avg Rating", color: "#f59e0b" },
};

export function VolumeRatingTrendChart({ data }: { data: MonthlyDataPoint[] }) {
  return (
    <ChartContainer config={chartConfig} className="h-[300px] w-full">
      <LineChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-100" />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="left" allowDecimals={false} />
        <YAxis yAxisId="right" orientation="right" domain={[1, 5]} tickCount={5} />
        <Tooltip content={<ChartTooltipContent />} />
        <Legend />
        <Line yAxisId="left" type="monotone" dataKey="volume" stroke="#7c3aed" dot={false} />
        <Line yAxisId="right" type="monotone" dataKey="avgRating" stroke="#f59e0b" dot={false} />
      </LineChart>
    </ChartContainer>
  );
}
```

### Pattern 3: Recharts Horizontal BarChart in ChartContainer

**What:** `BarChart` with `layout="vertical"` puts rating labels on the Y-axis and count values on the X-axis — the standard horizontal bar chart orientation.

**When to use:** RVMT-02 — star rating distribution (5 bars, one per star rating).

**Example:**
```typescript
// Source: Recharts docs; verified pattern from ChartContainer wrapper
// In rating-distribution-chart.tsx ('use client')
import { BarChart, Bar, XAxis, YAxis, Cell } from "recharts";
import { ChartContainer } from "@/components/ui/chart";

const chartConfig = { count: { label: "Reviews", color: "#f59e0b" } };

export function RatingDistributionChart({ data }: { data: RatingPoint[] }) {
  // data: [{ star: 5, count: 42 }, { star: 4, count: 28 }, ...]
  return (
    <ChartContainer config={chartConfig} className="h-[220px] w-full">
      <BarChart layout="vertical" data={data} margin={{ left: 8 }}>
        <XAxis type="number" allowDecimals={false} />
        <YAxis type="category" dataKey="star" tickFormatter={(v) => `${v} ★`} width={40} />
        <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
```

### Pattern 4: Status Indicator with Threshold Logic

**What:** A constant map from threshold ranges to color/message, matching the green/amber/red pattern established in the optimization score library.

**Example:**
```typescript
// Source: established threshold pattern from src/lib/optimization-score.ts (Phase 14)
function getRecencyStatus(daysSince: number | null): {
  status: "good" | "warning" | "critical";
  color: string;
  message: string;
} {
  if (daysSince === null) return { status: "critical", color: "red", message: "No reviews yet" };
  if (daysSince <= 14) return { status: "good", color: "green", message: "Profile is active" };
  if (daysSince <= 30) return { status: "warning", color: "amber", message: "Consider requesting reviews" };
  return { status: "critical", color: "red", message: "No reviews in over a month" };
}
```

### Pattern 5: Sidebar Nav Item Addition

**What:** Add a new entry to the `navItems` array in `src/components/sidebar.tsx`. The `isActive` check uses `pathname.startsWith(item.href)`, so `/dashboard/reviews/metrics` will be active when `item.href = "/dashboard/reviews/metrics"`.

**Caution:** The existing `/dashboard/reviews` nav item uses `pathname.startsWith("/dashboard/reviews")`, which means it will also match `/dashboard/reviews/metrics`. Use an exact match override or render both items side by side — the Reviews item should match only `/dashboard/reviews` exactly when the user is on the metrics page.

**Fix:** Change the isActive check logic for the Reviews item to also exclude the metrics subroute, OR accept both highlighting as-is (tab header provides primary navigation cue per D-02).

### Anti-Patterns to Avoid

- **Prisma `groupBy` for monthly aggregation:** `groupBy` only supports exact scalar fields. Grouping by year-month requires either raw SQL or JS post-processing. Use JS.
- **`$queryRaw` with string interpolation:** Never interpolate `profileId` into raw SQL. This codebase has zero raw queries — keep it that way.
- **Passing `Date` objects across server/client boundary:** Serialize dates to ISO strings before passing to client chart components. (Established pattern: Phase 17 decision about `computeOptimizationScore` called server-side to avoid Date serialization.)
- **Fetching all reviews all-time for the trend chart:** Scope the fetch to the 12-month window + prior 30-day buffer. Fetching unbounded history is wasteful for profiles with 500+ reviews.
- **ChartContainer without explicit height class:** ChartContainer uses `aspect-video` by default. Charts inside a card need an explicit height class (`h-[300px]`) to avoid runaway layout.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Chart rendering | Custom SVG drawing | Recharts BarChart/LineChart | Recharts handles responsive sizing, animation, tooltips, accessibility |
| Chart theming | Inline styles everywhere | ChartContainer + ChartConfig CSS vars | Established pattern; ensures consistent theming |
| Status badge coloring | Raw className strings | Badge component variants | Consistent with optimization score and review response badges |
| Loading states | Custom spinner | Skeleton component | Matches existing Suspense fallback pattern across all dashboard pages |
| Business filter scoping | Manual cookie read | `getSelectedProfileId()` | Server helper already handles cookie parsing and null safety |

**Key insight:** This phase is almost entirely composition of existing primitives. The only "new" logic is the pure data-transformation functions (trend calc, monthly grouping, rating grouping) which should be co-located and unit-tested.

## Common Pitfalls

### Pitfall 1: Sidebar Active State Double-Highlight
**What goes wrong:** Both "Reviews" (`/dashboard/reviews`) and "Review Metrics" (`/dashboard/reviews/metrics`) highlight simultaneously when on the metrics page because `pathname.startsWith("/dashboard/reviews")` matches both.
**Why it happens:** The sidebar uses `startsWith` for all non-root items. Subroutes inherit parent highlight.
**How to avoid:** Add a "Review Metrics" sidebar item with its own href. Accept both items highlighting simultaneously (minor visual issue), OR restrict the Reviews item match to `pathname === "/dashboard/reviews" || pathname.startsWith("/dashboard/reviews/") && !pathname.startsWith("/dashboard/reviews/metrics")`. The simpler choice is to accept dual-highlight since the tab header (D-02) is the primary navigation cue.
**Warning signs:** Both sidebar items show the active (violet) state simultaneously.

### Pitfall 2: Date Serialization Across Server/Client Boundary
**What goes wrong:** `Date` objects passed from a Server Component to a Client Component throw a Next.js serialization error ("Only plain objects can be serialized").
**Why it happens:** React Server Components serialize props to JSON — `Date` is not JSON-serializable.
**How to avoid:** Convert `Date` values to ISO strings (`date.toISOString()`) before passing to client chart components. Chart data arrays should use `string` for date fields, not `Date`.
**Warning signs:** `Error: Only plain objects, and a few built-ins, can be passed to Client Components from Server Components.`

### Pitfall 3: Month Grouping UTC vs Local Time
**What goes wrong:** A review posted at "11:30 PM local time" is stored as a UTC datetime. When grouping by year-month using UTC methods (`getUTCMonth()`), a review made on Jan 31 at 11 PM PST shows up in February.
**Why it happens:** PostgreSQL stores `DateTime` as UTC. `reviewDate.getMonth()` uses local time; `reviewDate.getUTCMonth()` uses UTC. Neither is correct for all users.
**How to avoid:** The STATE.md research flag explicitly calls this out. For consistency, use UTC-based grouping (`getUTCFullYear()`, `getUTCMonth()`) throughout — this matches how Postgres stores the data and avoids double-conversion. Document in code comments that all date math is UTC.
**Warning signs:** Month counts are off by one for reviews near month boundaries.

### Pitfall 4: Empty State — Zero Reviews
**What goes wrong:** Charts render with empty datasets and show blank/broken SVG areas. The "days since last review" card has `null` for `latestReview`.
**Why it happens:** New profiles or profiles not yet synced will have zero reviews.
**How to avoid:** Guard every metric computation for the null/empty case. For charts, render a placeholder card with a message ("No review data yet — sync reviews to see metrics") instead of an empty Recharts chart. For the recency card, treat `null` as "critical" with message "No reviews yet".
**Warning signs:** Blank white chart areas, `NaN` in trend badge, crash on `latestReview.reviewDate` access.

### Pitfall 5: Recharts ResponsiveContainer in SSR Context
**What goes wrong:** Recharts `ResponsiveContainer` uses DOM APIs and cannot render on the server. Any chart file that imports Recharts directly must be a Client Component (`'use client'`).
**Why it happens:** `ChartContainer` wraps `ResponsiveContainer` — this propagates the client-only constraint to any file using `ChartContainer`.
**How to avoid:** The gauge file already sets this pattern — all Recharts chart files are Client Components. The `RatingDistributionChart` and `VolumeRatingTrendChart` files MUST have `'use client'` at the top.
**Warning signs:** `window is not defined` error during server-side render.

### Pitfall 6: Y-Axis Domain Clamping for Avg Rating
**What goes wrong:** The average rating Y-axis auto-scales to the data range (e.g., 3.8–4.7), making small changes look dramatic. Users may misread a 0.2-point change as a major shift.
**Why it happens:** Recharts `YAxis` defaults to `domain={['auto', 'auto']}`.
**How to avoid:** Lock the right Y-axis to `domain={[1, 5]}` as specified in D-11. This gives honest visual representation of the 1–5 star scale.
**Warning signs:** A flat line at 4.5 stars appears as wildly fluctuating because Y-axis spans 4.4–4.6.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x (from devDependencies) |
| Config file | `vitest.config.mts` (project root) |
| Quick run command | `npx vitest run tests/lib/review-metrics.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RVMT-01 | Rolling 30-day trend % calculation | unit | `npx vitest run tests/lib/review-metrics.test.ts` | ❌ Wave 0 |
| RVMT-02 | Rating distribution grouping (1–5 buckets) | unit | `npx vitest run tests/lib/review-metrics.test.ts` | ❌ Wave 0 |
| RVMT-03 | Monthly volume grouping (year-month buckets, UTC) | unit | `npx vitest run tests/lib/review-metrics.test.ts` | ❌ Wave 0 |
| RVMT-04 | Days-since-last threshold classification (0–14/15–30/31+) | unit | `npx vitest run tests/lib/review-metrics.test.ts` | ❌ Wave 0 |
| RVMT-05 | Monthly avg rating calculation per bucket | unit | `npx vitest run tests/lib/review-metrics.test.ts` | ❌ Wave 0 |

**Note:** All five requirements reduce to pure function logic (date math, grouping, thresholding). All are unit-testable without Prisma or Next.js. This mirrors the optimization-score.test.ts pattern exactly — extract pure functions, test them directly.

### Sampling Rate
- **Per task commit:** `npx vitest run tests/lib/review-metrics.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/lib/review-metrics.test.ts` — covers all 5 pure function behaviors (RVMT-01 through RVMT-05)
- [ ] No framework install needed — Vitest already configured

## Code Examples

### Pure Function: Rolling 30-Day Trend (RVMT-01)
```typescript
// Source: pattern derived from stats-grid.tsx startOfMonth pattern + D-08 spec
// Returns positive = growth, negative = decline, null = no prior data
function computeTrend(
  reviews: Array<{ reviewDate: Date }>,
  now: Date
): { current: number; prior: number; pct: number | null } {
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() - thirtyDaysMs);
  const priorCutoff = new Date(now.getTime() - 2 * thirtyDaysMs);

  const current = reviews.filter(r => r.reviewDate >= cutoff).length;
  const prior = reviews.filter(
    r => r.reviewDate >= priorCutoff && r.reviewDate < cutoff
  ).length;

  const pct = prior === 0 ? null : Math.round(((current - prior) / prior) * 100);
  return { current, prior, pct };
}
```

### Pure Function: Monthly Grouping (RVMT-03, RVMT-05)
```typescript
// Source: established pattern — UTC-based to match PostgreSQL storage
interface MonthlyDataPoint {
  month: string;        // "Jan 2026" for X-axis display
  sortKey: string;      // "2026-01" for sorting
  volume: number;
  avgRating: number;
}

function computeMonthlyData(
  reviews: Array<{ reviewDate: Date; rating: number }>,
  now: Date
): MonthlyDataPoint[] {
  // Build 12-month bucket map (UTC)
  const buckets = new Map<string, { count: number; ratingSum: number }>();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, { count: 0, ratingSum: 0 });
  }

  for (const r of reviews) {
    const y = r.reviewDate.getUTCFullYear();
    const m = String(r.reviewDate.getUTCMonth() + 1).padStart(2, "0");
    const key = `${y}-${m}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count++;
      bucket.ratingSum += r.rating;
    }
  }

  return Array.from(buckets.entries()).map(([key, b]) => ({
    sortKey: key,
    month: new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }),
    volume: b.count,
    avgRating: b.count > 0 ? Math.round((b.ratingSum / b.count) * 10) / 10 : 0,
  }));
}
```

### Pure Function: Rating Distribution (RVMT-02)
```typescript
// Source: Prisma groupBy alternative — JS grouping on pre-fetched data
function computeRatingDistribution(
  reviews: Array<{ rating: number }>
): Array<{ star: number; count: number }> {
  const dist = new Map<number, number>([[5, 0], [4, 0], [3, 0], [2, 0], [1, 0]]);
  for (const r of reviews) {
    dist.set(r.rating, (dist.get(r.rating) ?? 0) + 1);
  }
  // Return 5 to 1 (top to bottom for horizontal bar chart)
  return [5, 4, 3, 2, 1].map(star => ({ star, count: dist.get(star) ?? 0 }));
}
```

**Important:** For RVMT-02, the distribution should operate on ALL reviews (not just the 12-month window). Use a separate all-time fetch or fetch the full history alongside the windowed data.

### Sidebar Item Addition
```typescript
// Source: src/components/sidebar.tsx — add after the Reviews item
import { TrendingUp } from "lucide-react";

const navItems = [
  // ... existing items ...
  { href: "/dashboard/reviews", label: "Reviews", icon: MessageSquare },
  { href: "/dashboard/reviews/metrics", label: "Review Metrics", icon: TrendingUp },
  // ...
];
```

### Reviews Page Header Tab Links
```typescript
// Source: pattern from existing reviews page header; D-02 spec
// Add to reviews/page.tsx header area
<div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
  <Link
    href="/dashboard/reviews"
    className={cn(
      "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
      "bg-white text-zinc-900 shadow-sm" // active state
    )}
  >
    Reviews
  </Link>
  <Link
    href="/dashboard/reviews/metrics"
    className={cn(
      "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
      "text-zinc-500 hover:text-zinc-700"
    )}
  >
    Metrics
  </Link>
</div>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `groupBy` for date buckets | JS post-processing after bounded fetch | Prisma limitation — has always been the case | Must implement custom grouping functions |
| Chart.js (server PDF) | Recharts (browser UI) | Phase 14 decision | Two chart libs coexist — chart.js for PDF only, recharts for all browser charts |

**Important distinction:** `chart.js` and `chartjs-node-canvas` are preserved for the Phase 19 PDF report generator. Do NOT use them for this phase's browser charts.

## Open Questions

1. **Rating distribution scope: all-time vs 12-month window?**
   - What we know: RVMT-02 says "star rating distribution" with no date qualifier. The success criteria says "counts for 1 through 5 stars."
   - What's unclear: Whether this is all-time or the same 12-month window as the trend chart.
   - Recommendation: Use all-time distribution — it reflects the profile's overall reputation. The trend chart provides the time-windowed view. Fetch total distribution separately from `prisma.review.groupBy({ by: ['rating'], _count: true, where: profileFilter })` — this is a valid use of `groupBy` because `rating` IS an exact scalar field.

2. **"Data through" label: profile-scoped or global max?**
   - What we know: D-13 says use most recent `Review.reviewDate` for selected profile (or all profiles if no filter).
   - What's unclear: If a user selects a profile that was synced 2 weeks ago while others were synced yesterday, the label shows the older date — is this accurate?
   - Recommendation: Yes, this is intentional and correct per D-13. It communicates the data currency for the currently viewed scope. No action needed.

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — all tooling is existing project stack: Node.js, Prisma, Next.js, Recharts. No new services, CLIs, or runtimes required.)

## Sources

### Primary (HIGH confidence)
- `src/generated/prisma/models/Review.ts` — Verified `ReviewGroupByArgs` only accepts scalar fields; confirmed `groupBy` on `rating` works; confirmed `_count`, `_avg` aggregations available
- `src/components/ui/chart.tsx` — ChartContainer API verified: `config: ChartConfig`, `children` is Recharts `ResponsiveContainer` child, CSS var injection via `--color-{key}`
- `src/app/dashboard/optimization/[profileId]/optimization-score-gauge.tsx` — Reference Recharts + ChartContainer integration pattern (confirmed working)
- `src/app/dashboard/stats-grid.tsx` — Reference for profileFilter pattern, Prisma query co-location, Skeleton usage
- `src/app/dashboard/page.tsx` — Reference for Suspense + MotionDiv page shell
- `src/components/sidebar.tsx` — Confirmed `navItems` array structure; verified `startsWith` active logic
- `src/lib/selected-profile.ts` — Confirmed `getSelectedProfileId()` returns `string | null` from cookie
- `prisma/schema.prisma` lines 134–158 — Confirmed `Review` model fields: `rating: Int`, `reviewDate: DateTime`, `profileId: String`
- `vitest.config.mts` — Test framework: Vitest, `tests/**/*.{test,spec}.{ts,tsx}`, `environment: 'node'`

### Secondary (MEDIUM confidence)
- Recharts 3.8.1 installed package — `BarChart layout="vertical"`, `LineChart` with dual `YAxis` are standard Recharts features present in 3.x API

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified from package.json and installed node_modules
- Architecture: HIGH — patterns derived directly from existing codebase files
- Pitfalls: HIGH — Prisma groupBy limitation verified from generated types; Date serialization from Phase 17 decision log; UTC grouping from STATE.md research flag
- Test strategy: HIGH — mirrors optimization-score.test.ts pattern exactly

**Research date:** 2026-04-03
**Valid until:** 2026-05-03 (stable stack — recharts, Prisma, Next.js APIs are stable)
