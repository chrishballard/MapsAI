---
phase: 14-score-library-dependencies
plan: 01
subsystem: testing
tags: [vitest, typescript, pure-function, optimization-score, tdd]

# Dependency graph
requires: []
provides:
  - Pure computeOptimizationScore function with 5 equal-weight signals (0-100 total)
  - ScoreCheck, OptimizationScore, ProfileInput, ScoreGrade, ScoreStatus TypeScript exports
  - Vitest test infrastructure with tsconfig path alias support
  - 24 unit tests covering all 5 signals, 3 grade bands, boundary conditions, 30-day window
affects:
  - phase-15-optimization-score-ui
  - phase-16-dashboard-upgrades
  - phase-17-business-cards

# Tech tracking
tech-stack:
  added:
    - vitest 4.1.2 (unit test runner)
    - "@vitejs/plugin-react 6.0.1 (React transform for vitest)"
    - vite-tsconfig-paths 6.1.1 (tsconfig @/ path alias resolution in tests)
  patterns:
    - "TDD (Red/Green/Refactor) for pure TypeScript library functions"
    - "Pure function pattern: no framework imports, plain TS interfaces, named exports"
    - "vitest.config.mts with tsconfigPaths() plugin for @/ aliases"

key-files:
  created:
    - src/lib/optimization-score.ts
    - tests/lib/optimization-score.test.ts
    - vitest.config.mts
  modified:
    - package.json

key-decisions:
  - "Score thresholds locked: green >= 70, amber 40-69, red < 40 (D-05 from CONTEXT.md)"
  - "5 equal-weight signals at 20pts each: Review Frequency, Post Frequency, Rating, Description Completeness, Services Completeness"
  - "ProfileInput uses plain interface (not Prisma types) — safe for server and client contexts"
  - "30-day rolling window enforced internally — callers pass full data"
  - "Signal benchmarks set per industry-standard GBP guidance (Open Question 1 resolved)"

patterns-established:
  - "Pure score function: accepts ProfileInput plain interface, returns OptimizationScore — no Prisma or React imports"
  - "Test location: tests/lib/*.test.ts — mirrors src/lib/ structure"
  - "vitest config: environment=node, include=tests/**/*.{test,spec}.{ts,tsx}, globals=true"

requirements-completed: [SCORE-LIB]

# Metrics
duration: 3min
completed: 2026-04-02
---

# Phase 14 Plan 01: Score Library Summary

**Pure computeOptimizationScore function with 5 equal-weight GBP signals, grade thresholds, exact UI-SPEC copy strings, and 24 passing vitest unit tests**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-02T22:13:26Z
- **Completed:** 2026-04-02T22:16:02Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Vitest 4.1.2 installed and configured with tsconfig @/ path alias support — test infrastructure ready for all future phases
- Pure optimization score function (`computeOptimizationScore`) built with TDD, covering all 5 signals at 20pts each with correct thresholds and exact copy strings from UI-SPEC
- 24 unit tests covering perfect profile, empty profile, all 5 signals, 3 grade bands, boundary conditions, and 30-day rolling window enforcement — all passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Install vitest and configure test infrastructure** - `41f037d` (chore)
2. **Task 2 RED: Failing tests for optimization score function** - `f5ae286` (test)
3. **Task 2 GREEN: Implement pure optimization score function** - `5489790` (feat)

_Note: TDD task had three commits (chore infra + test RED + feat GREEN)_

## Files Created/Modified

- `src/lib/optimization-score.ts` — Pure score function: computeOptimizationScore, 5 signal scorers, all exports, no Prisma/React imports
- `tests/lib/optimization-score.test.ts` — 24 unit tests covering all signals, grades, boundaries, 30-day window
- `vitest.config.mts` — Vitest config with node environment, tsconfig paths, tests/** include pattern
- `package.json` — Added vitest/plugin-react/tsconfig-paths devDeps, test/test:watch scripts

## Decisions Made

- Signal benchmarks chosen per industry-standard GBP guidance: review frequency good=4+ in 30d, post frequency good=4+ in 30d, rating good>=4.0, description good=isPushed, services good=3+ pushed
- Proportional scoring within warning range (e.g., reviews: 1=5pts, 2=10pts, 3=15pts) provides granular scoring without arbitrary cutoffs
- Services warning range uses fixed points (1 pushed=7pts, 2 pushed=13pts) per plan spec
- ProfileInput uses plain interface — not Prisma types — ensuring the file is importable in both server and client contexts without bundling Prisma Node.js modules

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `computeOptimizationScore` is exported and callable from downstream phases
- Import path: `import { computeOptimizationScore, OptimizationScore, ScoreCheck, ProfileInput, ScoreGrade, ScoreStatus } from '@/lib/optimization-score'`
- Score color contract established in UI-SPEC: green=emerald-100/700, amber=yellow-100/700, red=red-100/700
- vitest infrastructure ready — future phases can add tests to `tests/` directory and run `npm test`
- No blockers for Phase 14 Plan 02 (recharts/QR deps + Prisma index)

---
*Phase: 14-score-library-dependencies*
*Completed: 2026-04-02*
