---
phase: 06-analytics-pdf-reporting
plan: 01
subsystem: analytics-reporting
tags: [gbp-performance, metrics-sync, pdf-reports, chartjs, react-pdf]
dependency_graph:
  requires: [google-oauth, prisma-models, bullmq-queue, profile-sync]
  provides: [daily-metrics-sync, keyword-sync, pdf-report-generation, reports-dashboard]
  affects: [dashboard, api-routes, workers]
tech_stack:
  added: ["@react-pdf/renderer", "chart.js", "chartjs-node-canvas", "canvas"]
  patterns: [lazy-dynamic-import, on-demand-pdf-generation, rolling-sync-window]
key_files:
  created:
    - src/lib/google-performance.ts
    - src/lib/google-keywords.ts
    - src/lib/queue/metrics-sync-queue.ts
    - workers/metrics-sync-worker.ts
    - src/lib/pdf/chart-renderer.ts
    - src/lib/pdf/report-template.tsx
    - src/lib/pdf/report-generator.ts
    - src/app/api/metrics/sync/route.ts
    - src/app/api/reports/generate/route.ts
    - src/app/api/reports/[id]/download/route.ts
    - src/app/dashboard/reports/report-actions.tsx
  modified:
    - src/app/dashboard/reports/page.tsx
    - package.json
decisions:
  - Lazy dynamic import for chartjs-node-canvas to avoid Turbopack bundling issues
  - On-demand PDF generation at download time instead of pre-generating and storing files
  - Rolling 7-day window for metrics sync to handle GBP API data lag
metrics:
  duration: 7m 12s
  completed: 2026-03-05
  tasks_completed: 3
  tasks_total: 3
---

# Phase 6 Plan 1: Analytics & PDF Reporting Summary

GBP Performance API integration with daily metrics sync, monthly keyword tracking, and professional PDF report generation with impressions charts and month-over-month comparisons.

## Tasks Completed

### Task 1: GBP Performance API, metrics sync worker, and keyword sync
**Commit:** fce3a16

- Created `google-performance.ts` with `fetchDailyMetrics` (8 metric types) and `parseMetricsResponse` (groups by date, maps API enums to Prisma fields)
- Created `google-keywords.ts` with `fetchSearchKeywords` (paginated, handles `insightsValue.value` and `insightsValue.threshold`)
- Created `metrics-sync-queue.ts` with 24-hour repeatable BullMQ scheduler (3 attempts, exponential backoff 60s)
- Created `metrics-sync-worker.ts` with rolling 7-day window, upserts daily metrics and monthly keywords per profile
- Installed `@react-pdf/renderer`, `chart.js`, `chartjs-node-canvas`, `canvas`

### Task 2: PDF report generation with charts
**Commit:** 5a0645b

- Created `chart-renderer.ts` using ChartJSNodeCanvas (600x300) for line charts with search (blue) and maps (green) impressions
- Created `report-template.tsx` with React PDF components: header, 4 key metrics boxes with % change, impressions chart, top 10 keywords table, reviews & posts summary
- Created `report-generator.ts` orchestrating data fetch, metric summing, chart rendering, and PDF output

### Task 3: Report API endpoints and reports dashboard UI
**Commit:** 860f781

- POST `/api/metrics/sync` triggers immediate sync and ensures daily scheduler
- POST `/api/reports/generate` supports single profile or bulk generation
- GET `/api/reports/:id/download` generates PDF on-demand with proper Content-Disposition
- Reports dashboard with generate form (profile dropdown, month picker) and report list table with download buttons
- Client component `report-actions.tsx` for form interactivity and PDF blob download

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] chartjs-node-canvas Turbopack compatibility**
- **Found during:** Task 3 (build verification)
- **Issue:** `ChartJSNodeCanvas` uses `freshRequire` with dynamic expressions that Turbopack cannot bundle, causing `MODULE_NOT_FOUND` at build time
- **Fix:** Changed chart-renderer to use lazy dynamic `import()` instead of top-level static import and instantiation
- **Files modified:** `src/lib/pdf/chart-renderer.ts`

**2. [Rule 1 - Bug] Uint8Array not assignable to NextResponse body**
- **Found during:** Task 3 (build verification)
- **Issue:** `new NextResponse(pdfBuffer)` fails TypeScript check because `Uint8Array` is not `BodyInit`
- **Fix:** Wrapped with `Buffer.from(pdfBuffer)` for proper Node.js Buffer type
- **Files modified:** `src/app/api/reports/[id]/download/route.ts`

**3. [Rule 1 - Bug] Wrong property name for search keywords API**
- **Found during:** Task 1 (TypeScript verification)
- **Issue:** Used `entry.keyword` but Google API type defines it as `entry.searchKeyword`
- **Fix:** Changed to `entry.searchKeyword`
- **Files modified:** `src/lib/google-keywords.ts`

## Decisions Made

1. **Lazy dynamic import for chartjs-node-canvas** - Turbopack cannot handle the library's `freshRequire` pattern, so we use `await import()` at runtime
2. **On-demand PDF generation** - Reports are generated at download time rather than stored as files, simplifying storage and ensuring fresh data
3. **Rolling 7-day sync window** - GBP Performance API has 1-3 day data lag, so syncing last 7 days ensures we catch delayed data

## Verification

- TypeScript compilation: PASSED (`npx tsc --noEmit`)
- Production build: PASSED (`npm run build`)
- All routes registered: `/api/metrics/sync`, `/api/reports/generate`, `/api/reports/[id]/download`, `/dashboard/reports`

## Self-Check: PASSED

- All 12 files verified present on disk
- All 3 task commits verified in git history (fce3a16, 5a0645b, 860f781)
