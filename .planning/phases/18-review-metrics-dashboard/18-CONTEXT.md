# Phase 18: Review Metrics Dashboard - Context

**Gathered:** 2026-04-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a review metrics dashboard at `/dashboard/reviews/metrics` where users can understand the review health of any profile — total review count with trend, star rating distribution chart, monthly volume + average rating trend chart, and days-since-last-review indicator — from a single dedicated page. Respects the business filter and communicates GBP data lag.

</domain>

<decisions>
## Implementation Decisions

### Page Location & Navigation
- **D-01:** New route at `/dashboard/reviews/metrics` — keeps review-related pages grouped under `/dashboard/reviews/`. The existing reviews list page stays at `/dashboard/reviews`.
- **D-02:** Add a tab-style toggle or link on the existing reviews page header to navigate between "Reviews" (list) and "Metrics" (dashboard). Same on the metrics page to go back.
- **D-03:** Add "Review Metrics" link in the sidebar under or near the existing "Reviews" nav item (or as a sub-item). Use a chart icon (e.g., `TrendingUp` or `BarChart3` from lucide-react).

### Chart Layout & Styling
- **D-04:** Top row: two summary stat cards — (1) Total Review Count with period-over-period trend badge (RVMT-01), (2) Days Since Last Review with good/warning/critical status indicator (RVMT-04).
- **D-05:** Below stat cards: two chart cards side by side in a responsive 2-column grid — (1) Star Rating Distribution horizontal bar chart (RVMT-02), (2) Monthly Review Volume + Average Rating Trend dual-line chart (RVMT-03, RVMT-05).
- **D-06:** Use Recharts `BarChart` (horizontal layout via `layout="vertical"`) for rating distribution and `LineChart` for monthly volume/rating trend. Both wrapped in `ChartContainer` from `src/components/ui/chart.tsx`.
- **D-07:** Color scheme follows the existing design system — violet (`#7c3aed`) for primary data series, zinc for secondary elements. Rating distribution bars can use amber for stars to match the existing `StarRating` component color (`amber-400`).

### Trend Badge Calculation (RVMT-01)
- **D-08:** Period-over-period comparison uses a rolling 30-day window: compare review count from last 30 days vs the 30 days before that. Display as "X% vs prior 30 days" with up/down arrow and green/red coloring. This matches ROADMAP success criteria #1 which specifies "rolling 30-day window, not calendar month".

### Recency Thresholds (RVMT-04)
- **D-09:** Days since last review status thresholds: good (green) = 0-14 days, warning (amber) = 15-30 days, critical (red) = 31+ days. Follows the green/amber/red pattern from the optimization score library.
- **D-10:** Display format: large number showing days count, color-coded badge showing status level, and a brief message (e.g., "Profile is active" / "Consider requesting reviews" / "No reviews in over a month").

### Dual-Line Chart (RVMT-03, RVMT-05)
- **D-11:** Monthly review volume as primary line (left Y-axis, count), average rating trend as secondary line (right Y-axis, 1-5 scale). X-axis shows months. Default to last 12 months of data.
- **D-12:** Date range displayed as subtitle text on the chart card (e.g., "Apr 2025 - Apr 2026").

### Data Sync Label
- **D-13:** Single page-level "Data through [date]" subtitle below the page heading, using the most recent `Review.reviewDate` from the database for the selected profile (or across all profiles if no filter). Format: "Data through Mar 31, 2026". Satisfies ROADMAP success criteria #5.

### Business Filter
- **D-14:** Respect the existing `getSelectedProfileId()` business filter. When a profile is selected, all metrics scope to that profile. When no profile is selected, show aggregate metrics across all profiles.

### Claude's Discretion
- Exact Recharts configuration (margins, tick formatting, tooltip design, legend placement)
- Whether stat cards use the existing Card component directly or a new MetricCard variant
- Skeleton shapes and count for Suspense fallbacks
- Whether to use Suspense per chart or one boundary for the whole page
- MotionDiv animation timing and stagger pattern
- How to handle profiles with zero reviews (empty state messaging)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Review Data Model
- `prisma/schema.prisma` (lines 134-158) — `Review` model with `rating`, `reviewDate`, `profileId` fields. `ReviewResponse` model for response tracking.

### Existing Reviews Page
- `src/app/dashboard/reviews/page.tsx` — Current review list page with filters and actions. The metrics page should complement this, not replace it.
- `src/app/dashboard/reviews/review-filters.tsx` — Review filter component (may inform filter patterns).

### Chart Infrastructure
- `src/components/ui/chart.tsx` — shadcn ChartContainer wrapper for Recharts. Used by optimization gauge and stats grid.
- `src/app/dashboard/optimization/[profileId]/optimization-score-gauge.tsx` — Reference for Recharts RadialBarChart + ChartContainer integration pattern.

### Dashboard Patterns
- `src/app/dashboard/stats-grid.tsx` — Reference for stat card layout, Prisma query pattern with business filter, Skeleton usage.
- `src/app/dashboard/page.tsx` — Reference for page structure with Suspense boundaries, MotionDiv.
- `src/components/sidebar.tsx` — Sidebar nav items array where new "Review Metrics" link should be added.

### Business Filter
- `src/lib/selected-profile.ts` — `getSelectedProfileId()` server-side helper for business filter.

### UI Components
- `src/components/ui/card.tsx` — Card component for chart containers.
- `src/components/ui/badge.tsx` — Badge component for trend badges and status indicators.
- `src/components/ui/skeleton.tsx` — Skeleton for Suspense fallbacks.
- `src/components/motion-wrapper.tsx` — MotionDiv for entrance animations.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ChartContainer` (`src/components/ui/chart.tsx`): Wraps Recharts charts with consistent styling
- `Card/CardHeader/CardTitle/CardContent`: Standard card wrapper for dashboard widgets
- `Badge`: For trend badges (% change) and status indicators (good/warning/critical)
- `MotionDiv`: Entrance animation wrapper used on all dashboard pages
- `Skeleton`: Loading fallback for Suspense boundaries
- `getSelectedProfileId()`: Business filter helper — all queries should use this

### Established Patterns
- Server Components for data fetching, Client Components only for interactivity (charts)
- Prisma queries with `profileFilter` spread for business filter scoping
- Recharts + ChartContainer for all chart rendering (no other chart libs)
- Green/amber/red status coloring for health indicators (matches optimization score)

### Integration Points
- Sidebar `navItems` array in `src/components/sidebar.tsx` — add new nav item
- Reviews page header — add tab/link to toggle between list and metrics views
- Review data from Prisma `Review` model — aggregate queries for charts

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Auto-mode selected recommended defaults for all gray areas.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

RVMT-06 (QR code review requests), RVMT-07 (AI tips for more reviews), and RVMT-08 (review keyword analysis) are already deferred to v1.3+ in REQUIREMENTS.md.

</deferred>

---

*Phase: 18-review-metrics-dashboard*
*Context gathered: 2026-04-03*
