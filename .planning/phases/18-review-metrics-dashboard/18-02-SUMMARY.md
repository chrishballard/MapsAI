---
phase: 18-review-metrics-dashboard
plan: 02
subsystem: ui
tags: [recharts, next.js, prisma, suspense, react-server-components]

# Dependency graph
requires:
  - phase: 18-01
    provides: review-metrics pure functions (computeTrend, computeRatingDistribution, computeMonthlyData, computeDaysSince, getRecencyStatus, formatDataThrough) and sidebar/tab navigation

provides:
  - /dashboard/reviews/metrics route with Suspense shell and MotionDiv entrance
  - ReviewMetricsContent server component — 4-query Prisma data fetching + computed stat cards + chart wrappers
  - RatingDistributionChart client component — horizontal BarChart with amber bars
  - VolumeRatingTrendChart client component — dual-axis LineChart with violet volume + amber avg rating

affects: [19-reports-enhancement, future review analytics phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server component fetches all data, passes plain serializable arrays (no Date objects) to client chart components"
    - "Suspense boundary wraps entire metrics content for streaming skeleton"
    - "ChartContainer wraps all Recharts charts with CSS var theming"
    - "Dual-axis LineChart with locked domain=[1,5] on right Y-axis for honest avg rating visualization"

key-files:
  created:
    - src/app/dashboard/reviews/metrics/page.tsx
    - src/app/dashboard/reviews/metrics/review-metrics-content.tsx
    - src/app/dashboard/reviews/metrics/rating-distribution-chart.tsx
    - src/app/dashboard/reviews/metrics/volume-rating-trend-chart.tsx
  modified: []

key-decisions:
  - "Both chart components receive pre-computed plain arrays (RatingPoint[], MonthlyDataPoint[]) — no Date objects cross server/client boundary"
  - "allReviews fetched all-time for rating distribution (RVMT-02), recentReviews (62-day window) for trend only"
  - "Right Y-axis domain locked to [1,5] per D-11 — prevents misleading auto-scaling of avg rating"

patterns-established:
  - "Pattern: Server Component queries + JS aggregation + pass plain arrays to Client Component charts"

requirements-completed: [RVMT-01, RVMT-02, RVMT-03, RVMT-04, RVMT-05]

# Metrics
duration: 2min
completed: 2026-04-03
---

# Phase 18 Plan 02: Review Metrics Dashboard Summary

**Suspense-streamed metrics page at /dashboard/reviews/metrics with Recharts horizontal bar chart (rating distribution) and dual-axis line chart (monthly volume + avg rating), scoped by business filter**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-03T16:50:03Z
- **Completed:** 2026-04-03T16:52:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- ReviewMetricsPage with MotionDiv entrance, tab toggle (Reviews / Metrics), Suspense skeleton fallback
- ReviewMetricsContent: 4 parallel Prisma queries + all 6 pure function computations, two stat cards (total reviews with 30-day trend, days since last review with status), two chart card wrappers
- RatingDistributionChart: horizontal BarChart with amber bars, ChartTooltipContent, correct tickFormatter for star labels
- VolumeRatingTrendChart: dual-axis LineChart, violet volume line (left), amber avg rating line (right, locked domain=[1,5])

## Task Commits

Each task was committed atomically:

1. **Task 1: Create metrics page shell and server data-fetching content component** - `96e299d` (feat)
2. **Task 2: Create Recharts client chart components** - `0d4de2d` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `src/app/dashboard/reviews/metrics/page.tsx` - Suspense shell, MotionDiv entrance, tab toggle, ReviewMetricsSkeleton
- `src/app/dashboard/reviews/metrics/review-metrics-content.tsx` - Server component: Prisma queries, pure function derivations, stat cards, chart card wrappers, empty state
- `src/app/dashboard/reviews/metrics/rating-distribution-chart.tsx` - Client component: horizontal BarChart with amber bars
- `src/app/dashboard/reviews/metrics/volume-rating-trend-chart.tsx` - Client component: dual-axis LineChart with locked Y-axis

## Decisions Made
- allReviews fetched all-time (not windowed) for rating distribution — reflects overall profile reputation; recentReviews (62-day) used only for trend calculation
- No Date objects passed to client chart components — all data serialized as strings/numbers (MonthlyDataPoint.month is string, RatingPoint.count is number)
- Right Y-axis locked to domain=[1,5] rather than auto-scale — prevents misleading visualization of small avg rating fluctuations

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 18 complete: review metrics dashboard fully functional at /dashboard/reviews/metrics
- All 5 RVMT requirements (RVMT-01 through RVMT-05) delivered
- Build passes, 91 tests pass, route appears in Next.js build output
- Phase 19 (reports enhancement) is unblocked

---
*Phase: 18-review-metrics-dashboard*
*Completed: 2026-04-03*
