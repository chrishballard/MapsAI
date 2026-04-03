---
phase: 19-reports-enhancement
plan: 03
subsystem: api
tags: [pdf, react-pdf, chartjs-node-canvas, reports, sparkline]

# Dependency graph
requires:
  - phase: 19-reports-enhancement
    plan: 01
    provides: report-metrics.ts with aggregateDailyMetrics, computePriorPeriod, computeSparklineData, buildActionsLog
  - phase: 19-reports-enhancement
    plan: 02
    provides: reports-dashboard-content.tsx with live metrics dashboard, executive-summary.tsx with AI narrative
provides:
  - renderSparklineChart() in chart-renderer.ts for 300x80 sparkline PNG images
  - DashboardReportData interface and DashboardReportDocument component in report-template.tsx
  - generateDashboardReport() in report-generator.ts (alongside untouched generateReport())
  - POST /api/reports/dashboard-pdf returning PDF binary with Content-Disposition header
  - DashboardDownloadBtn client component following existing DownloadButton pattern
  - Download PDF button in ReportsDashboardContent (top-right, passes current date range)
affects: [future-pdf-work, reporting-enhancements]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive PDF extension: new exports alongside existing ones, never modify existing"
    - "Separate ChartJSNodeCanvas instance for sparklines (different size than impressions chart)"
    - "narrativeText=null passed from server component to client button — PDF skips narrative block gracefully"
    - "Date range from/to passed as ISO strings, parsed as UTC midnight in API route"

key-files:
  created:
    - src/app/api/reports/dashboard-pdf/route.ts
    - src/app/dashboard/reports/dashboard-download-btn.tsx
  modified:
    - src/lib/pdf/chart-renderer.ts
    - src/lib/pdf/report-template.tsx
    - src/lib/pdf/report-generator.ts
    - src/app/dashboard/reports/reports-dashboard-content.tsx

key-decisions:
  - "Used separate ChartJSNodeCanvas (300x80) for sparklines instead of resizing the singleton — avoids singleton state contamination"
  - "narrativeText passed as null from server component button props — PDF gracefully skips narrative block rather than blocking on AI generation"
  - "DashboardReportDocument added as new export, leaving ReportDocument and ReportData completely untouched (pitfall #6 from research)"
  - "Actions log in PDF uses the same buildActionsLog() and same query pattern as the UI, keeping data consistent"

patterns-established:
  - "Sparkline renderer pattern: separate canvas, pointRadius: 0, axis display: false, tension: 0.3"
  - "Dashboard PDF download: POST with {profileId, from, to, narrativeText}, receive blob, trigger anchor download"

requirements-completed: [RPT-08]

# Metrics
duration: 25min
completed: 2026-04-03
---

# Phase 19 Plan 03: PDF Export Pipeline Summary

**Dashboard-style PDF export with sparkline chart images, AI narrative block, actions log table, and new `/api/reports/dashboard-pdf` POST endpoint — all additive to existing monthly report pipeline**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-03T17:20:00Z
- **Completed:** 2026-04-03T17:46:55Z
- **Tasks:** 2
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- Added `renderSparklineChart()` export to chart-renderer.ts using a dedicated 300x80 ChartJSNodeCanvas instance
- Added `DashboardReportData` interface and `DashboardReportDocument` component to report-template.tsx (all existing exports untouched)
- Added `generateDashboardReport()` to report-generator.ts importing from report-metrics.ts for aggregation, sparklines, and actions log
- Created `/api/reports/dashboard-pdf` POST route with auth check, date parsing, and PDF binary response
- Created `DashboardDownloadBtn` client component following existing `DownloadButton` pattern
- Wired Download PDF button into `ReportsDashboardContent` (top-right, passes current `from`/`to`/`profileId`)

## Task Commits

Each task was committed atomically:

1. **Task 1: PDF sparkline renderer and dashboard report template** - `ada991e` (feat)
2. **Task 2: Dashboard PDF API route and Download PDF button** - `2121f26` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/lib/pdf/chart-renderer.ts` - Added `renderSparklineChart()` (300x80, pointRadius 0, axis hidden)
- `src/lib/pdf/report-template.tsx` - Added `DashboardReportData`, `DashboardReportDocument`, narrative/sparkline styles
- `src/lib/pdf/report-generator.ts` - Added `generateDashboardReport()` alongside untouched `generateReport()`
- `src/app/api/reports/dashboard-pdf/route.ts` - New POST endpoint returning PDF binary
- `src/app/dashboard/reports/dashboard-download-btn.tsx` - New client component, POST + blob download
- `src/app/dashboard/reports/reports-dashboard-content.tsx` - Added DashboardDownloadBtn at top-right

## Decisions Made
- Used separate `ChartJSNodeCanvas` instance (300x80) for sparklines instead of sharing the 600x300 singleton — avoids size conflicts and state contamination
- `narrativeText` passed as `null` from server component to download button props; PDF gracefully skips the narrative block rather than waiting on AI generation
- `DashboardReportDocument` placed before `ReportDocument` in the file so both exports are cleanly separated
- Actions log PDF query mirrors the dashboard query exactly (same Post/ReviewResponse/ProfileDescription shape) for data consistency

## Deviations from Plan

None - plan executed exactly as written. Worktree was missing phase 19-01/19-02 commits and required a `git merge main` before starting — this is expected worktree initialization behavior, not a deviation.

## Issues Encountered
- Worktree branch was behind main (missing phase 19-01/19-02 commits). Resolved by running `git merge main --no-edit` at start of execution. No conflicts.
- `npx next build` cannot run from the worktree directory (Turbopack workspace detection error). Build verification ran from main project directory `/Users/christopherballlard/Projects/MapsAI` — passes cleanly. TypeScript check (`npx tsc --noEmit`) also passes with zero errors.

## Known Stubs
None — all data paths are wired. `narrativeText=null` is intentional (documented design decision D-20: PDF skips narrative block if null).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- RPT-08 complete: users can click Download PDF on the reports dashboard and receive a PDF reflecting current date range
- PDF includes: header, optional narrative block (null currently), metrics cards (5 metrics across 2 rows), impressions trend chart, sparkline charts, actions log table, footer
- Existing `/api/reports/generate` and `/api/reports/[id]/download` routes unchanged and functional

---
*Phase: 19-reports-enhancement*
*Completed: 2026-04-03*
