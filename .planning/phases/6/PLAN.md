---
phase: 06-analytics-pdf-reporting
plan: 01
type: execute
wave: 1
depends_on: [05-review-sync-ai-responses]
files_modified:
  - src/lib/google-performance.ts
  - src/lib/google-keywords.ts
  - src/lib/queue/metrics-sync-queue.ts
  - src/lib/pdf/chart-renderer.ts
  - src/lib/pdf/report-template.tsx
  - src/lib/pdf/report-generator.ts
  - src/app/api/metrics/sync/route.ts
  - src/app/api/reports/generate/route.ts
  - src/app/api/reports/[id]/download/route.ts
  - src/app/dashboard/reports/page.tsx
  - workers/metrics-sync-worker.ts
  - package.json
autonomous: true
requirements: [R5.1, R5.2, R5.3, R5.4, R5.5, R5.6]

must_haves:
  truths:
    - "Daily metrics sync from GBP Performance API via BullMQ repeatable job"
    - "Monthly search keywords synced and stored"
    - "PDF reports generated with business info, metrics summary, chart, keywords, reviews, posts"
    - "Reports can be downloaded individually as PDF"
    - "Bulk report generation for all profiles"
  artifacts:
    - path: "src/lib/google-performance.ts"
      provides: "GBP Performance API client"
      exports: ["fetchDailyMetrics", "fetchSearchKeywords"]
    - path: "src/lib/pdf/report-generator.ts"
      provides: "Report orchestration"
      exports: ["generateReport"]
    - path: "src/lib/pdf/report-template.tsx"
      provides: "React PDF document component"
      exports: ["ReportDocument"]
    - path: "src/lib/pdf/chart-renderer.ts"
      provides: "Server-side chart PNG generation"
      exports: ["renderImpressionsChart"]
    - path: "src/app/api/reports/[id]/download/route.ts"
      provides: "PDF download endpoint"
      exports: ["GET"]
    - path: "src/app/dashboard/reports/page.tsx"
      provides: "Reports dashboard with generate and download"
  key_links:
    - from: "src/lib/pdf/report-generator.ts"
      to: "src/lib/pdf/chart-renderer.ts"
      via: "renders chart image for PDF embedding"
      pattern: "renderImpressionsChart"
    - from: "src/lib/pdf/report-generator.ts"
      to: "src/lib/pdf/report-template.tsx"
      via: "passes data to React PDF component"
      pattern: "ReportDocument"
    - from: "workers/metrics-sync-worker.ts"
      to: "src/lib/google-performance.ts"
      via: "fetches metrics and keywords"
      pattern: "fetchDailyMetrics"
---

<objective>
Implement GBP performance metric syncing, search keyword tracking, and PDF report generation.

Purpose: Analytics and reporting are key deliverables for the agency workflow. This phase adds automated daily metric syncing, search keyword collection, and a professional PDF report generator that summarizes each profile's monthly performance with charts and comparisons.

Output: Working metrics pipeline with daily sync, a reports page where users can generate and download PDF performance reports per profile (or in bulk), including impressions charts, keyword rankings, review summaries, and post activity.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/6/06-RESEARCH.md
@prisma/schema.prisma
@src/lib/prisma.ts
@src/lib/google.ts
@src/lib/queue/connection.ts
@workers/publish-worker.ts
@src/app/dashboard/reports/page.tsx
@src/app/dashboard/page.tsx

<interfaces>
From src/lib/google.ts:
```typescript
export async function createGoogleClient(googleAccountId: string): Promise<OAuth2Client>;
```

From src/lib/queue/connection.ts:
```typescript
export const redisConnection: ConnectionOptions;
```

GBP Performance API v1:
- Metrics: locations.fetchMultiDailyMetricsTimeSeries
- Keywords: locations.searchkeywords.impressions.monthly.list
- Both use `locations/{numericId}` format — extract from Profile.locationName

DailyMetric enum mapping to Prisma fields:
- BUSINESS_IMPRESSIONS_DESKTOP_SEARCH -> impressionsSearchDesktop
- BUSINESS_IMPRESSIONS_MOBILE_SEARCH -> impressionsSearchMobile
- BUSINESS_IMPRESSIONS_DESKTOP_MAPS -> impressionsMapsDesktop
- BUSINESS_IMPRESSIONS_MOBILE_MAPS -> impressionsMapsMobile
- WEBSITE_CLICKS -> websiteClicks
- CALL_CLICKS -> callClicks
- BUSINESS_DIRECTION_REQUESTS -> directionRequests
- BUSINESS_CONVERSATIONS -> conversations

Existing Prisma models: DailyMetric (@@unique profileId+date), MonthlyKeyword (@@unique profileId+month+keyword), Report (profileId, month, filePath)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: GBP Performance API, metrics sync worker, and keyword sync</name>
  <files>
    src/lib/google-performance.ts,
    src/lib/google-keywords.ts,
    src/lib/queue/metrics-sync-queue.ts,
    workers/metrics-sync-worker.ts,
    package.json
  </files>
  <action>
    **Install dependencies:**
    ```bash
    npm install @react-pdf/renderer chart.js chartjs-node-canvas canvas
    npm install -D @types/canvas
    ```

    **1. Create src/lib/google-performance.ts:**
    - `fetchDailyMetrics(googleAccountId, locationId, startDate, endDate)`:
      Uses `google.businessprofileperformance("v1").locations.fetchMultiDailyMetricsTimeSeries()`.
      Requests all 8 daily metrics. Date params are `{ year, month, day }` objects.
      Returns raw API response.
    - `parseMetricsResponse(response, profileId)`:
      Parses the nested multiDailyMetricTimeSeries structure into flat objects matching the DailyMetric Prisma model fields. Groups by date, maps metric enum names to Prisma field names.
      Returns array of objects ready for prisma.dailyMetric.upsert.

    **2. Create src/lib/google-keywords.ts:**
    - `fetchSearchKeywords(googleAccountId, locationId, startMonth, endMonth)`:
      Uses `google.businessprofileperformance("v1").locations.searchkeywords.impressions.monthly.list()`.
      Paginates with pageSize=100, handles nextPageToken.
      Maps `insightsValue.value` or `insightsValue.threshold` to impressions count.
      Returns `Array<{ keyword: string; impressions: number }>`.

    **3. Create src/lib/queue/metrics-sync-queue.ts:**
    - Queue name: `"metrics-sync"`
    - 3 attempts, exponential backoff 60s
    - `initMetricsSyncScheduler()`: calls upsertJobScheduler with `every: 24 * 60 * 60 * 1000` (daily)
    - Export queue and init function

    **4. Create workers/metrics-sync-worker.ts:**
    BullMQ Worker for "metrics-sync":
    - Fetch all connected profiles with googleAccount
    - For each profile:
      - Extract numeric location ID: `profile.locationName.split("/").pop()`
      - Fetch last 7 days of daily metrics (rolling window to handle data lag)
      - Parse response and upsert each day into DailyMetric (uses @@unique constraint)
      - Fetch current month's search keywords
      - Upsert into MonthlyKeyword (uses @@unique constraint)
    - Concurrency: 1, wrap each profile in try/catch
    - Use relative imports from workers/ dir
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>
    - GBP Performance API client fetches daily metrics and keywords
    - Metrics sync worker runs daily via BullMQ scheduler
    - Rolling 7-day window handles API data lag
    - Keywords paginated and stored with threshold handling
    - TypeScript compiles without errors
  </done>
</task>

<task type="auto">
  <name>Task 2: PDF report generation with charts</name>
  <files>
    src/lib/pdf/chart-renderer.ts,
    src/lib/pdf/report-template.tsx,
    src/lib/pdf/report-generator.ts
  </files>
  <action>
    **1. Create src/lib/pdf/chart-renderer.ts:**
    - Uses `ChartJSNodeCanvas` from `chartjs-node-canvas` (width: 600, height: 300)
    - `renderImpressionsChart(dailyData: Array<{ date: string; search: number; maps: number }>)`:
      Line chart with two datasets (Search Impressions in blue, Maps Impressions in green).
      Animation disabled. Returns PNG Buffer.

    **2. Create src/lib/pdf/report-template.tsx:**
    React PDF document component using @react-pdf/renderer:
    - Page with A4 size, 40px padding
    - **Header section:** Profile name (large), address, category, "Performance Report - Month Year"
    - **Key Metrics section:** 4 metric boxes in a row showing:
      - Total Impressions (search + maps combined, current vs previous month with % change)
      - Website Clicks (current vs previous)
      - Phone Calls (current vs previous)
      - Direction Requests (current vs previous)
      - Color-code change: green for positive, red for negative
    - **Impressions Trend Chart:** Embedded as Image from base64 PNG
    - **Top Search Keywords:** Table with rank, keyword, impressions (top 10)
    - **Review Summary:** Count, average rating, response rate percentage
    - **Posts Published:** Count of posts published this month
    - Use StyleSheet.create for all styles

    **3. Create src/lib/pdf/report-generator.ts:**
    Orchestration function:
    - `generateReport(profileId: string, month: Date)`:
      1. Fetch profile info
      2. Fetch current month's DailyMetric records and previous month's for comparison
      3. Sum metrics for each month (total impressions, clicks, calls, directions)
      4. Calculate % change for each metric
      5. Fetch top 10 MonthlyKeyword records for the month (order by impressions desc)
      6. Fetch review count + avg rating for the month
      7. Fetch published post count for the month
      8. Generate impressions chart PNG via renderImpressionsChart
      9. Convert chart buffer to data URI: `data:image/png;base64,${buffer.toString("base64")}`
      10. Render PDF via `renderToBuffer(<ReportDocument ...props />)`
      11. Return PDF buffer (Uint8Array)
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>
    - Chart renderer generates impressions trend PNG
    - PDF template renders full report with all sections
    - Report generator orchestrates data fetch, chart, and PDF rendering
    - TypeScript compiles without errors
  </done>
</task>

<task type="auto">
  <name>Task 3: Report API endpoints and reports dashboard UI</name>
  <files>
    src/app/api/metrics/sync/route.ts,
    src/app/api/reports/generate/route.ts,
    src/app/api/reports/[id]/download/route.ts,
    src/app/dashboard/reports/page.tsx
  </files>
  <action>
    **1. Create src/app/api/metrics/sync/route.ts:**
    - POST endpoint, auth check
    - Add immediate job to metrics-sync queue
    - Call initMetricsSyncScheduler() to ensure daily schedule active
    - Return success message

    **2. Create src/app/api/reports/generate/route.ts:**
    - POST accepting `{ profileId?: string, month?: string }` (month as "YYYY-MM")
    - Auth check
    - If profileId: generate single report, save PDF buffer to Report record (store filePath or generate on-demand)
    - If no profileId: bulk generate for all connected profiles
    - For bulk: process sequentially, create Report records
    - Return `{ reports: [{ profileId, profileName, reportId, status }] }`

    **3. Create src/app/api/reports/[id]/download/route.ts:**
    - GET endpoint, auth check (await params for Next.js 16)
    - Fetch Report with profile info
    - Call generateReport(profileId, month) to generate on-demand
    - Return PDF as response with Content-Type: application/pdf and Content-Disposition: attachment
    - Filename format: "{ProfileName}-{YYYY-MM}.pdf"

    **4. Replace src/app/dashboard/reports/page.tsx:**
    Server component:
    - Fetch all Report records with profile info, order by createdAt desc
    - Fetch all connected profiles for the generate form
    - **Header:** "Reports" title with count
    - **Generate section:** Profile dropdown (or "All Profiles"), month picker, "Generate Report" button. Use a client component for the form interactivity.
    - **Reports list:** Table or card grid showing:
      - Profile name
      - Month
      - Generated date
      - "Download PDF" button (links to /api/reports/:id/download)
    - **Empty state:** BarChart3 icon with "No reports generated" and "Generate Report" button
    - Create a client component `report-actions.tsx` for the generate form and download buttons

    Style notes:
    - Match existing dashboard patterns
    - Download button: blue outline with Download icon from lucide-react
    - Generate button: blue solid
  </action>
  <verify>
    <automated>npm run build 2>&1 | tail -10</automated>
  </verify>
  <done>
    - POST /api/metrics/sync triggers metric sync
    - POST /api/reports/generate creates reports (single or bulk)
    - GET /api/reports/:id/download returns PDF file
    - Reports dashboard shows all generated reports with download links
    - Generate form with profile selector and month picker
    - Build succeeds without errors
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Analytics and reporting pipeline: GBP Performance API integration for daily metrics and search keywords, BullMQ worker for automated daily sync, PDF report generation with impressions chart and metrics comparison, report download API, and reports dashboard UI.
  </what-built>
  <how-to-verify>
    1. Start dev server: `npm run dev`
    2. Navigate to /dashboard/reports -- should show empty state with generate form
    3. Select a profile and current month, click "Generate Report"
    4. Click "Download PDF" on the generated report
    5. Open the PDF -- should show business info header, metrics summary (will show zeros without real data), impressions chart, keyword table, review summary
    6. Try "Sync Metrics" to trigger manual metrics sync (needs real Google data to populate)

    Note: Without real GBP data, the report will show zeros for all metrics. The structure, layout, and download flow can still be verified.
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<verification>
- TypeScript compiles: `npx tsc --noEmit`
- App builds: `npm run build`
- API endpoints:
  - POST /api/metrics/sync triggers sync
  - POST /api/reports/generate creates report records
  - GET /api/reports/:id/download returns PDF
- Reports page renders with generate form and report list
- PDF contains all required sections
</verification>

<success_criteria>
- Metrics sync worker fetches daily metrics from GBP Performance API
- Search keywords synced monthly with pagination and threshold handling
- PDF report includes: business header, metrics summary with month-over-month comparison, impressions trend chart, top keywords table, review summary, posts count
- Reports page allows generating and downloading PDFs
- Bulk generation works for all profiles
- Build and TypeScript compilation succeed
</success_criteria>

<output>
After completion, create `.planning/phases/6/06-01-SUMMARY.md`
</output>
