---
phase: 17-profile-optimization-page
plan: 01
subsystem: ui
tags: [optimization, navigation, sidebar, utilities, vitest, tailwind]

# Dependency graph
requires:
  - phase: 14-score-library-dependencies
    provides: ScoreCheck, ScoreStatus types from optimization-score.ts
  - phase: 15-business-cards-view
    provides: profiles-grid.tsx with score badge, GRADE_CLASSES from score-utils.ts

provides:
  - sortByStatusPriority utility for sorting audit checks by priority
  - STATUS_COLORS constant with Tailwind classes for audit card UI
  - isPending / getPendingCount helpers for pending item detection
  - GRADE_COLORS hex values for SVG/chart fills
  - Sidebar Optimization nav item with Gauge icon
  - Score badge on business cards as clickable links to optimization page
  - /dashboard/optimization index route with profile redirect logic

affects:
  - 17-02 (optimization detail page — consumes utility functions, enters via navigation)
  - 17-03 (optimization actions — consumes isPending/getPendingCount)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Stable sort via [...arr].sort() to avoid array mutation"
    - "const-as-const for Tailwind class maps — type-safe exhaustive record"
    - "Server component redirect pattern: cookie lookup → DB verify → fallback → empty state"

key-files:
  created:
    - src/lib/optimization-utils.ts
    - tests/lib/optimization-utils.test.ts
    - src/app/dashboard/optimization/page.tsx
  modified:
    - src/components/sidebar.tsx
    - src/app/dashboard/profiles/profiles-grid.tsx

key-decisions:
  - "STATUS_COLORS uses const-as-const — prevents accidental mutation and provides literal type inference"
  - "Index route verifies cookie profile still exists before redirecting — handles stale cookies gracefully"
  - "Score badge wrapped in Link (not entire card) — preserves existing View details link behavior"

patterns-established:
  - "Optimization utilities centralized in src/lib/optimization-utils.ts — single import for Plans 02 and 03"
  - "TDD red→green for utility functions before wiring navigation"

requirements-completed: [OPT-02]

# Metrics
duration: 8min
completed: 2026-04-03
---

# Phase 17 Plan 01: Foundation & Navigation Summary

**Tested utility library (sortByStatusPriority, STATUS_COLORS, isPending/getPendingCount, GRADE_COLORS) plus sidebar Optimization nav item, clickable score badge links, and /dashboard/optimization index route with profile redirect logic**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-03T09:51:00Z
- **Completed:** 2026-04-03T09:54:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created `src/lib/optimization-utils.ts` with 5 exported utilities, all covered by 18 passing unit tests
- Wired sidebar Optimization nav item (Gauge icon, after Businesses, 7 items total)
- Wrapped score badge in profiles-grid.tsx as clickable Link to `/dashboard/optimization/[profileId]`
- Created `/dashboard/optimization/page.tsx` server component with cookie-verified redirect logic and empty state

## Task Commits

Each task was committed atomically:

1. **Task 1: Create optimization utility functions with tests** - `383cb37` (feat)
2. **Task 2: Wire navigation — sidebar item, score badge links, index route** - `84217c3` (feat)

**Plan metadata:** (created below)

_Note: Task 1 followed TDD red→green: tests written first, then implementation._

## Files Created/Modified
- `src/lib/optimization-utils.ts` - Sorting, status colors, pending detection, grade hex colors
- `tests/lib/optimization-utils.test.ts` - 18 unit tests for all exported utilities
- `src/components/sidebar.tsx` - Added Gauge import + Optimization nav item
- `src/app/dashboard/profiles/profiles-grid.tsx` - Score badge wrapped in Link to optimization page
- `src/app/dashboard/optimization/page.tsx` - Index route: redirects to selected/first profile or shows empty state

## Decisions Made
- `STATUS_COLORS` uses `as const` — provides exhaustive literal type inference for Plans 02 and 03.
- Index route verifies cookie profile exists in DB before redirecting — prevents 404 loops on stale cookies.
- Only the score badge is wrapped in Link (not the whole card) — preserves the existing "View details" card link behavior.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- None. One build lock conflict resolved by killing stale process before running `next build`.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 02 can import from `@/lib/optimization-utils` for sorting and STATUS_COLORS
- Navigation is wired — users can reach `/dashboard/optimization/[profileId]` from sidebar or badge
- Plan 03 can use `isPending` and `getPendingCount` for approval workflow indicators
- Build passes cleanly with zero errors

---
*Phase: 17-profile-optimization-page*
*Completed: 2026-04-03*
