---
phase: 15-business-cards-view
plan: 01
subsystem: profiles-ui
tags: [ui, profiles, search, optimization-score, prisma-select]
dependency_graph:
  requires:
    - "14-score-library-dependencies/14-01 (computeOptimizationScore, ScoreGrade, ProfileInput)"
    - "14-score-library-dependencies/14-02 (Phase 14 UI-SPEC score color contract)"
  provides:
    - "Business card grid with optimization score badges and search filtering"
    - "score-utils: filterProfiles (case-insensitive search), GRADE_CLASSES (score color map)"
  affects:
    - "src/app/dashboard/profiles/page.tsx (server component, Prisma query)"
    - "src/app/dashboard/profiles/profiles-grid.tsx (client component)"
tech_stack:
  added: []
  patterns:
    - "Server/client split: page.tsx (data) + profiles-grid.tsx (interactivity)"
    - "Prisma select on nested relations — only fields needed by ProfileInput"
    - "Date reconstruction in client component: new Date(isoString) before score computation"
    - "Score badge with className override (bg-emerald/yellow/red-100) per Phase 14 contract"
key_files:
  created:
    - src/app/dashboard/profiles/score-utils.ts
    - src/app/dashboard/profiles/profiles-grid.tsx
    - tests/app/profiles-grid.test.ts
  modified:
    - src/app/dashboard/profiles/page.tsx
decisions:
  - "Computed optimization score in client component (not server) — pure function, negligible overhead, simpler data flow"
  - "Used Prisma select instead of _avg/_count aggregations — D-07 intent (no full arrays) satisfied, D-08 data requirements for score function met"
  - "Date type in ProfileData interface is Date | string — accepts both server Date objects and client ISO strings"
metrics:
  duration: "~15min"
  completed: "2026-04-02T22:46:11Z"
  tasks_completed: 3
  files_created: 3
  files_modified: 1
---

# Phase 15 Plan 01: Business Cards View Summary

**One-liner:** Profiles page upgraded with server/client split — score badges (Phase 14 color contract), review counts, and case-insensitive search filtering with optimized Prisma select query.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Create score-utils and unit tests (TDD) | d352869 | score-utils.ts, tests/app/profiles-grid.test.ts |
| 2 | Create ProfilesGrid client component and refactor page.tsx | 8e683f0 | profiles-grid.tsx, page.tsx |
| 3 | Visual verification checkpoint | auto-approved | — |

## What Was Built

**score-utils.ts** — Pure utility module with two exports:
- `GRADE_CLASSES`: Record mapping `ScoreGrade` to Phase 14 color contract Tailwind classes (emerald/yellow/red -100 backgrounds)
- `filterProfiles`: Generic case-insensitive substring filter on business name (D-05)

**profiles-grid.tsx** — `'use client'` component that owns:
- Search input state with `Search` icon prefix
- Client-side filtering via `filterProfiles`
- Card grid (1→2→3→4 columns at breakpoints per D-10)
- Per-card optimization score computation with ISO string → Date reconstruction (Pitfall 2 fix)
- Score badge with `absolute top-3 right-3` positioning, `GRADE_CLASSES` color override
- Review count display: "(N reviews)" next to star rating (D-12)
- Two distinct empty states: "No businesses onboarded" (profiles.length === 0) and "No businesses match your search" (search returns empty)

**page.tsx refactored** — Slim server component:
- Prisma query replaced `include: { googleAccount, reviews }` with `select` on only required fields
- `googleAccount` removed (not used in card display)
- Card grid JSX replaced with `<ProfilesGrid profiles={profiles} availableCount={availableCount} />`

## Requirements Addressed

| ID | Description | Status |
|----|-------------|--------|
| CARD-01 | 4-column card grid with icon, star rating, review count, name, address | Done |
| CARD-02 | Search bar filters by business name, case-insensitive | Done |
| CARD-03 | "Add a Business" button navigates to onboarding flow | Done (preserved) |
| CARD-04 | Optimization score badge on each card, color-coded | Done |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Type mismatch: Date vs string in ProfileData interface**
- **Found during:** Task 2 build verification
- **Issue:** Prisma returns `Date` objects; `ProfileData` interface declared `reviewDate: string`. TypeScript error blocked build.
- **Fix:** Changed `ProfileData.reviews[].reviewDate` and `posts[].publishedAt` to `Date | string` — accepts both server `Date` objects and serialized ISO strings from client context
- **Files modified:** `src/app/dashboard/profiles/profiles-grid.tsx`
- **Commit:** 8e683f0 (included in same commit)

## Known Stubs

None — all data is wired from the Prisma query through to the card display.

## Self-Check: PASSED

Files verified:
- `src/app/dashboard/profiles/score-utils.ts` — EXISTS
- `src/app/dashboard/profiles/profiles-grid.tsx` — EXISTS
- `src/app/dashboard/profiles/page.tsx` — MODIFIED
- `tests/app/profiles-grid.test.ts` — EXISTS

Commits verified:
- d352869 — EXISTS
- 8e683f0 — EXISTS

Build: PASSED (npm run build exits 0)
Tests: PASSED (33/33 passing)
