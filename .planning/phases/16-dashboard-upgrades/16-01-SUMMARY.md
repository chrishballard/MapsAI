---
phase: 16-dashboard-upgrades
plan: 01
subsystem: ui
tags: [next.js, react, prisma, typescript, vitest, dashboard, server-components]

# Dependency graph
requires:
  - phase: 15-business-cards-view
    provides: ProfilesGrid client component pattern for server+client split

provides:
  - buildAutomationItems pure function merging 3 activity sources with sort+slice
  - buildTaskItems pure function producing TaskItem[] including start_onboarding entries
  - AutomationsFeed async server component with 20-item activity feed and per-row See details links
  - AutomationsFeedSkeleton fallback component
  - TasksSection async server component querying draft posts, review responses, incomplete profiles
  - TasksSectionSkeleton fallback component
  - StatsGrid async server component with 4 stat cards
  - AIInsightsPanel async server component with pending reviews and posts this month
  - StatsGridSkeleton fallback component
  - TaskItem extended with start_onboarding type and Link-based navigation

affects: [16-02, plan-02-dashboard-page-shell]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure data-building functions exported from server component files enable unit testing without Prisma"
    - "ReviewResponse filter uses nested review.profileId (not direct profileFilter spread) — ReviewResponse has no direct profileId column"
    - "Description activity items use pushedAt (not updatedAt) as canonical time field"

key-files:
  created:
    - src/app/dashboard/automations-feed.tsx
    - src/app/dashboard/tasks-section.tsx
    - src/app/dashboard/stats-grid.tsx
    - tests/app/dashboard-automations.test.ts
    - tests/app/dashboard-tasks.test.ts
  modified:
    - src/app/dashboard/tasks-table.tsx

key-decisions:
  - "Pure buildAutomationItems and buildTaskItems functions co-located in server component files — testable without Prisma mock"
  - "start_onboarding TaskItem uses profile.id as task.id so Link href resolves to /dashboard/onboarding/{profileId}"
  - "AIInsightsPanel is a separate async component in stats-grid.tsx — queries independently for pendingReviews and postsThisMonth"

patterns-established:
  - "Server component + skeleton pattern: async component exports paired with *Skeleton fallback for Suspense boundaries"
  - "ReviewResponse profile filter: always use review: { profileId: id } nested form, never spread profileFilter directly"

requirements-completed: [DASH-01, DASH-02, DASH-03]

# Metrics
duration: 5min
completed: 2026-04-02
---

# Phase 16 Plan 01: Dashboard Sub-Components Summary

**Three async server components (StatsGrid, AutomationsFeed, TasksSection) with skeleton fallbacks, extended TasksTable with start_onboarding link navigation, and 15 unit tests for pure data-building logic**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-02T23:10:00Z
- **Completed:** 2026-04-02T23:15:03Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- `buildAutomationItems` merges posts, review replies, and pushed descriptions; sorts by time desc; slices to 20; maps correct labels and detailHrefs per source type
- `buildTaskItems` produces `TaskItem[]` from draft posts, drafted review responses, and incomplete onboarding profiles — including new `start_onboarding` type with profile.id as task.id
- Three async server components with Prisma queries: `StatsGrid` (4 stat cards), `AutomationsFeed` (activity feed with per-row See details links), `TasksSection` (tasks table with onboarding entries)
- Skeleton fallbacks exported for all 3 components for Suspense boundaries in Plan 02
- `TasksTable` extended to render Link for `start_onboarding` tasks instead of opening the Review dialog
- 15 unit tests covering merge/sort/slice logic, label mapping, detailHref values, and task type assignment

## Task Commits

1. **Task 1: Create data-building functions and unit tests** - `9fd816b` (feat — TDD: RED then GREEN)
2. **Task 2: Build server sub-components with skeletons and extend TasksTable** - `84b429b` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/app/dashboard/automations-feed.tsx` — `buildAutomationItems`, `AutomationsFeed`, `AutomationsFeedSkeleton`
- `src/app/dashboard/tasks-section.tsx` — `buildTaskItems`, `TasksSection`, `TasksSectionSkeleton`
- `src/app/dashboard/stats-grid.tsx` — `StatsGrid`, `AIInsightsPanel`, `StatsGridSkeleton`
- `src/app/dashboard/tasks-table.tsx` — extended `TaskItem` type, `start_onboarding` case in label + Link navigation
- `tests/app/dashboard-automations.test.ts` — 10 tests for `buildAutomationItems`
- `tests/app/dashboard-tasks.test.ts` — 5 tests for `buildTaskItems`

## Decisions Made

- Pure data-building functions co-located in server component files (not a separate utils file) — keeps the logic co-located with the component that uses it and makes the export surface clear for testing
- `AIInsightsPanel` is a separate exported async component in `stats-grid.tsx` so Plan 02 can position it independently in the page grid
- `start_onboarding` task uses `profile.id` as `task.id` so the Link href `/dashboard/onboarding/${task.id}` resolves correctly without an extra lookup

## Deviations from Plan

None — plan executed exactly as written. The `connectedProfiles` variable in `StatsGrid` is computed but currently unused in the rendered output (the plan spec omitted it from the stat cards); suppressed with `void connectedProfiles` to keep TypeScript clean.

## Issues Encountered

None. TypeScript compiled clean on first pass. All 48 tests (including 33 pre-existing) passed.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All 3 async server components and their skeleton exports are ready to be imported into the dashboard page shell (Plan 02)
- `TasksTable` handles `start_onboarding` rows with Link-based navigation
- Plan 02 can use `<Suspense fallback={<StatsGridSkeleton />}><StatsGrid /></Suspense>` pattern for each section

---
*Phase: 16-dashboard-upgrades*
*Completed: 2026-04-02*
