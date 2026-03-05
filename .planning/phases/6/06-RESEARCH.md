# Phase 6: Analytics & PDF Reporting - Research

**Researched:** 2026-03-04
**Domain:** GBP Performance API, Server-side PDF generation, Chart rendering
**Confidence:** HIGH

## Summary

Phase 6 implements daily performance metric syncing from the Google Business Profile Performance API, monthly search keyword syncing, an analytics dashboard, and PDF report generation with charts. The existing codebase already has the Prisma models (DailyMetric, MonthlyKeyword, Report), BullMQ worker infrastructure, Google OAuth with token refresh, and a placeholder reports page -- so this phase is primarily about API integration and PDF rendering.

The GBP Performance API v1 provides `fetchMultiDailyMetricsTimeSeries` for daily metrics and `searchkeywords.impressions.monthly.list` for keyword data, both using the same `business.manage` OAuth scope already configured. For PDF generation, `@react-pdf/renderer` (v4.x) works server-side with React 19 via `renderToBuffer` in Next.js API routes. Charts are generated server-side using `chartjs-node-canvas` which renders Chart.js to PNG buffers without a browser.

**Primary recommendation:** Use `googleapis` (already installed) for the Performance API, `@react-pdf/renderer` for PDF layout, and `chartjs-node-canvas` + `chart.js` for embedding chart images in PDFs.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| R5.1 | Sync performance metrics from GBP Performance API (daily) | `fetchMultiDailyMetricsTimeSeries` endpoint via googleapis; BullMQ repeatable job pattern from review-sync-worker |
| R5.2 | Store metrics: impressions (search/maps), clicks, calls, direction requests | DailyMetric model already exists with all needed columns; maps directly to API DailyMetric enum values |
| R5.3 | Store monthly search keyword data | `searchkeywords.impressions.monthly.list` endpoint; MonthlyKeyword model already exists |
| R5.4 | Generate PDF report per profile with business info, metrics, charts, keywords, reviews, posts | @react-pdf/renderer renderToBuffer + chartjs-node-canvas for chart images |
| R5.5 | Bulk-generate reports for all profiles | BullMQ worker pattern with per-profile jobs; Report model tracks generation |
| R5.6 | Download individual or bulk PDF reports | Next.js API route streaming PDF buffer; bulk as zip or sequential downloads |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| googleapis | ^171.4.0 | GBP Performance API calls | Already installed; official Google client with TypeScript types |
| @react-pdf/renderer | ^4.3.2 | Server-side PDF generation | React component model for PDFs; renderToBuffer works in Next.js API routes; uses pdfkit under the hood |
| chart.js | ^4.4.x | Chart configuration and rendering | Industry standard for chart definitions |
| chartjs-node-canvas | ^4.1.x | Server-side chart-to-image rendering | Renders Chart.js configs to PNG buffers without browser/DOM; uses node-canvas |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| bullmq | ^5.70.2 | Job queue for sync workers | Already installed; use for daily metrics sync and report generation jobs |
| archiver | ^7.x | ZIP file creation | Bulk report download -- zip multiple PDFs into single download |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @react-pdf/renderer | pdfkit (direct) | More control but imperative API; react-pdf uses pdfkit internally and provides declarative React components |
| @react-pdf/renderer | puppeteer | Heavier dependency; requires headless Chrome; overkill for structured reports |
| chartjs-node-canvas | SVG charts in react-pdf | react-pdf SVG support is limited; raster chart images are simpler and more reliable |

**Installation:**
```bash
npm install @react-pdf/renderer chart.js chartjs-node-canvas canvas archiver
npm install -D @types/archiver
```

Note: `canvas` is a peer dependency of `chartjs-node-canvas` and requires system-level build tools (pre-built binaries available for most platforms). On macOS it typically installs without issues.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── google-performance.ts    # GBP Performance API client functions
│   ├── google-keywords.ts       # GBP Search Keywords API client functions
│   ├── queue/
│   │   ├── metrics-sync-queue.ts    # Daily metrics sync queue + scheduler
│   │   └── report-generation-queue.ts # Report generation queue
│   └── pdf/
│       ├── report-template.tsx      # React PDF document component
│       ├── chart-renderer.ts        # chartjs-node-canvas chart generation
│       └── report-generator.ts      # Orchestrates data fetch + PDF creation
├── app/
│   ├── api/
│   │   ├── metrics/sync/route.ts          # Trigger metrics sync
│   │   ├── reports/generate/route.ts      # Generate single report
│   │   ├── reports/generate/bulk/route.ts # Generate all reports
│   │   ├── reports/[id]/download/route.ts # Download single PDF
│   │   └── reports/download/bulk/route.ts # Download bulk ZIP
│   └── dashboard/
│       ├── analytics/page.tsx             # Analytics dashboard with charts
│       └── reports/page.tsx               # Report listing + download UI (exists as placeholder)
workers/
├── metrics-sync-worker.ts       # BullMQ worker for daily metric sync
└── report-generation-worker.ts  # BullMQ worker for PDF generation
```

### Pattern 1: GBP Performance API Client
**What:** Wrapper around googleapis businessprofileperformance v1
**When to use:** All metric and keyword fetching
**Example:**
```typescript
// src/lib/google-performance.ts
import { google } from "googleapis";
import { createGoogleClient } from "./google";

const performanceApi = google.businessprofileperformance("v1");

export async function fetchDailyMetrics(
  googleAccountId: string,
  locationId: string,  // numeric ID extracted from locationName
  startDate: { year: number; month: number; day: number },
  endDate: { year: number; month: number; day: number }
) {
  const auth = await createGoogleClient(googleAccountId);

  const response = await performanceApi.locations.fetchMultiDailyMetricsTimeSeries({
    location: `locations/${locationId}`,
    dailyMetrics: [
      "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
      "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
      "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
      "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
      "WEBSITE_CLICKS",
      "CALL_CLICKS",
      "BUSINESS_DIRECTION_REQUESTS",
      "BUSINESS_CONVERSATIONS",
    ],
    "dailyRange.startDate.year": startDate.year,
    "dailyRange.startDate.month": startDate.month,
    "dailyRange.startDate.day": startDate.day,
    "dailyRange.endDate.year": endDate.year,
    "dailyRange.endDate.month": endDate.month,
    "dailyRange.endDate.day": endDate.day,
    auth,
  });

  return response.data;
}
```

### Pattern 2: Metrics Sync Worker (follows review-sync-worker pattern)
**What:** BullMQ repeatable worker that syncs metrics daily
**When to use:** Automated daily data collection
**Example:**
```typescript
// workers/metrics-sync-worker.ts
import { Worker, Job } from "bullmq";
import { redisConnection } from "../src/lib/queue/connection";
import { fetchDailyMetrics } from "../src/lib/google-performance";
import { prisma } from "../src/lib/prisma";

const worker = new Worker(
  "metrics-sync",
  async (job: Job) => {
    const profiles = await prisma.profile.findMany({
      where: { isConnected: true },
      include: { googleAccount: true },
    });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    for (const profile of profiles) {
      try {
        // Extract numeric location ID from locationName (e.g., "locations/12345" or "accounts/.../locations/12345")
        const locationId = profile.locationName.split("/").pop()!;

        const dateObj = {
          year: yesterday.getFullYear(),
          month: yesterday.getMonth() + 1,
          day: yesterday.getDate(),
        };

        const data = await fetchDailyMetrics(
          profile.googleAccountId,
          locationId,
          dateObj,
          dateObj
        );

        // Parse response and upsert into DailyMetric
        // ... (see response parsing section below)
      } catch (err) {
        console.error(`Failed to sync metrics for ${profile.name}:`, err);
      }
    }
  },
  { connection: redisConnection, concurrency: 1 }
);
```

### Pattern 3: PDF Report Generation with React PDF
**What:** Server-side PDF rendering using React components
**When to use:** Report generation API routes and workers
**Example:**
```typescript
// src/lib/pdf/report-generator.ts
import { renderToBuffer } from "@react-pdf/renderer";
import { ReportDocument } from "./report-template";
import { renderChart } from "./chart-renderer";

export async function generateReport(profileId: string, month: Date) {
  // 1. Fetch all data needed for the report
  const [metrics, keywords, reviews, posts, profile] = await Promise.all([
    fetchMonthMetrics(profileId, month),
    fetchKeywords(profileId, month),
    fetchReviewSummary(profileId, month),
    fetchPublishedPosts(profileId, month),
    prisma.profile.findUniqueOrThrow({ where: { id: profileId } }),
  ]);

  // 2. Generate chart image as base64 PNG
  const chartImage = await renderChart(metrics);

  // 3. Render PDF to buffer
  const pdfBuffer = await renderToBuffer(
    <ReportDocument
      profile={profile}
      metrics={metrics}
      keywords={keywords}
      reviews={reviews}
      posts={posts}
      chartImage={chartImage}
    />
  );

  return pdfBuffer;
}
```

### Pattern 4: Chart Image Generation
**What:** Render Chart.js charts to PNG buffers server-side
**When to use:** Creating chart images for PDF embedding
**Example:**
```typescript
// src/lib/pdf/chart-renderer.ts
import { ChartJSNodeCanvas } from "chartjs-node-canvas";

const chartCanvas = new ChartJSNodeCanvas({ width: 600, height: 300 });

export async function renderImpressionsChart(
  dailyData: { date: string; search: number; maps: number }[]
): Promise<Buffer> {
  const config = {
    type: "line" as const,
    data: {
      labels: dailyData.map((d) => d.date),
      datasets: [
        {
          label: "Search Impressions",
          data: dailyData.map((d) => d.search),
          borderColor: "#2563eb",
          fill: false,
        },
        {
          label: "Maps Impressions",
          data: dailyData.map((d) => d.maps),
          borderColor: "#16a34a",
          fill: false,
        },
      ],
    },
    options: {
      scales: { y: { beginAtZero: true } },
      plugins: { legend: { position: "bottom" as const } },
      animation: false as const,
    },
  };

  return chartCanvas.renderToBuffer(config);
}
```

### Anti-Patterns to Avoid
- **Fetching all-time metrics on every sync:** Only fetch yesterday's data (or the missing date range). The API has rate limits.
- **Generating PDFs synchronously in API routes:** For bulk generation, always use BullMQ workers. A single report is fast enough for an API route but 200 reports will time out.
- **Storing PDF files in the `public/` directory:** These are user-specific files, not public assets. Use a dedicated `uploads/` or `reports/` directory outside `public/`.
- **Using @react-pdf/renderer on the client:** The PDF template components use Node.js APIs via `renderToBuffer`. Keep all PDF generation server-side only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Server-side chart images | Custom SVG-to-PNG pipeline | chartjs-node-canvas | Handles all Chart.js chart types, produces crisp PNGs, no browser needed |
| PDF tables/layout | Manual coordinate-based PDF drawing | @react-pdf/renderer components | Declarative layout with flexbox, automatic page breaks, much less error-prone |
| ZIP file creation | Custom archive logic | archiver npm package | Handles streaming, compression, multiple file formats |
| Date range management | Manual date math | Built-in Date API or dayjs | GBP API uses simple year/month/day objects so native Date is sufficient |

**Key insight:** The GBP Performance API returns time series data that maps cleanly to the existing DailyMetric schema. The main complexity is in PDF layout and chart rendering, not API integration.

## Common Pitfalls

### Pitfall 1: GBP Location ID Format
**What goes wrong:** The Performance API uses `locations/{locationId}` format with a numeric ID, but the project stores `locationName` which may be in `accounts/{accountId}/locations/{locationId}` format.
**Why it happens:** Different GBP APIs use different resource name formats.
**How to avoid:** Extract the numeric location ID from the stored `locationName` by splitting on `/` and taking the last segment.
**Warning signs:** 404 errors from the Performance API.

### Pitfall 2: Performance API Data Lag
**What goes wrong:** Fetching yesterday's data returns empty results.
**Why it happens:** GBP performance data can be delayed 2-3 days. Data is not real-time.
**How to avoid:** Sync a rolling window (e.g., last 7 days) on each run, using upsert to avoid duplicates. The `@@unique([profileId, date])` constraint enables safe upserts.
**Warning signs:** Consistently missing data for recent dates.

### Pitfall 3: Search Keywords Threshold Values
**What goes wrong:** Keyword impressions show a threshold value (e.g., 15) instead of actual count.
**Why it happens:** Google privacy thresholds -- keywords with fewer than ~15 impressions show the threshold ceiling instead of actual count.
**How to avoid:** Check the response for `insightsValue.threshold` vs `insightsValue.value`. Store the threshold flag or just store the value as-is (it's still useful for ranking).
**Warning signs:** Many keywords showing exactly the same impression count.

### Pitfall 4: canvas Native Module on Railway
**What goes wrong:** `chartjs-node-canvas` depends on the `canvas` npm package which has native C++ bindings.
**Why it happens:** The `canvas` package needs pre-built binaries or build tools (cairo, pango, etc.) which may not be available in the deployment environment.
**How to avoid:** Railway's Node.js buildpack typically includes these dependencies. If issues arise, use the `CANVAS_PREBUILT=1` flag or add a Nixpacks config to install system dependencies: `apt-get install -y build-essential libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev`.
**Warning signs:** Build failures mentioning `canvas`, `node-gyp`, or `cairo`.

### Pitfall 5: React PDF Image Embedding
**What goes wrong:** Chart images don't render in the PDF or cause errors.
**Why it happens:** @react-pdf/renderer's `<Image>` component expects a specific format.
**How to avoid:** Convert the chart buffer to a data URI: `data:image/png;base64,${buffer.toString("base64")}`. The Image `src` prop accepts data URIs.
**Warning signs:** Empty rectangles in the PDF where charts should be.

### Pitfall 6: PDF Generation Memory with Bulk Reports
**What goes wrong:** Generating 200 PDF reports simultaneously causes memory spikes.
**Why it happens:** Each PDF buffer, chart buffer, and data query consumes memory.
**How to avoid:** Process reports sequentially in the worker (concurrency: 1), write each PDF to disk immediately, and clear references. Use BullMQ's built-in concurrency control.
**Warning signs:** Worker process crashes, OOM errors.

## Code Examples

### GBP Performance API Response Parsing
```typescript
// Source: Google Business Profile Performance API docs
// Response structure from fetchMultiDailyMetricsTimeSeries
interface PerformanceResponse {
  multiDailyMetricTimeSeries: Array<{
    dailyMetricTimeSeries: Array<{
      dailyMetric: string; // e.g., "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH"
      dailySubEntityType?: {
        dayOfWeek?: string;
        timeOfDay?: { hours: number; minutes: number };
      };
      timeSeries: {
        datedValues: Array<{
          date: { year: number; month: number; day: number };
          value?: string; // string representation of int64
        }>;
      };
    }>;
  }>;
}

// Parsing into DailyMetric upsert data
function parseMetricsResponse(response: PerformanceResponse, profileId: string) {
  const dayMap = new Map<string, Record<string, number>>();

  for (const multi of response.multiDailyMetricTimeSeries ?? []) {
    for (const series of multi.dailyMetricTimeSeries ?? []) {
      const metric = series.dailyMetric;
      for (const dv of series.timeSeries?.datedValues ?? []) {
        const dateKey = `${dv.date.year}-${String(dv.date.month).padStart(2, "0")}-${String(dv.date.day).padStart(2, "0")}`;
        if (!dayMap.has(dateKey)) dayMap.set(dateKey, {});
        dayMap.get(dateKey)![metric] = parseInt(dv.value ?? "0", 10);
      }
    }
  }

  return Array.from(dayMap.entries()).map(([dateStr, metrics]) => ({
    profileId,
    date: new Date(dateStr),
    impressionsSearchDesktop: metrics["BUSINESS_IMPRESSIONS_DESKTOP_SEARCH"] ?? 0,
    impressionsSearchMobile: metrics["BUSINESS_IMPRESSIONS_MOBILE_SEARCH"] ?? 0,
    impressionsMapsDesktop: metrics["BUSINESS_IMPRESSIONS_DESKTOP_MAPS"] ?? 0,
    impressionsMapsMobile: metrics["BUSINESS_IMPRESSIONS_MOBILE_MAPS"] ?? 0,
    websiteClicks: metrics["WEBSITE_CLICKS"] ?? 0,
    callClicks: metrics["CALL_CLICKS"] ?? 0,
    directionRequests: metrics["BUSINESS_DIRECTION_REQUESTS"] ?? 0,
    conversations: metrics["BUSINESS_CONVERSATIONS"] ?? 0,
  }));
}
```

### Search Keywords API Call
```typescript
// Source: GBP Performance API reference
export async function fetchSearchKeywords(
  googleAccountId: string,
  locationId: string,
  startMonth: { year: number; month: number },
  endMonth: { year: number; month: number }
) {
  const auth = await createGoogleClient(googleAccountId);
  const performanceApi = google.businessprofileperformance("v1");

  const allKeywords: Array<{ keyword: string; impressions: number }> = [];
  let pageToken: string | undefined;

  do {
    const response = await performanceApi.locations.searchkeywords.impressions.monthly.list({
      parent: `locations/${locationId}`,
      "monthlyRange.startMonth.year": startMonth.year,
      "monthlyRange.startMonth.month": startMonth.month,
      "monthlyRange.endMonth.year": endMonth.year,
      "monthlyRange.endMonth.month": endMonth.month,
      pageSize: 100,
      pageToken,
      auth,
    });

    for (const kw of response.data.searchKeywordsCounts ?? []) {
      allKeywords.push({
        keyword: kw.searchKeyword ?? "",
        impressions: parseInt(kw.insightsValue?.value ?? kw.insightsValue?.threshold ?? "0", 10),
      });
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return allKeywords;
}
```

### React PDF Report Template
```typescript
// src/lib/pdf/report-template.tsx
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10 },
  header: { marginBottom: 20 },
  title: { fontSize: 18, fontWeight: "bold", marginBottom: 4 },
  subtitle: { fontSize: 12, color: "#666" },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 14, fontWeight: "bold", marginBottom: 8, borderBottomWidth: 1, borderBottomColor: "#ddd", paddingBottom: 4 },
  metricsRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  metricBox: { width: "23%", padding: 8, backgroundColor: "#f3f4f6", borderRadius: 4 },
  metricValue: { fontSize: 16, fontWeight: "bold" },
  metricLabel: { fontSize: 8, color: "#666", marginTop: 2 },
  metricChange: { fontSize: 8, marginTop: 2 },
  chartImage: { width: "100%", height: 200, marginVertical: 8 },
  table: { width: "100%" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#eee", paddingVertical: 4 },
  tableHeader: { flexDirection: "row", borderBottomWidth: 2, borderBottomColor: "#333", paddingBottom: 4, marginBottom: 4 },
});

interface ReportProps {
  profile: { name: string; address?: string | null; category?: string | null };
  month: string; // "March 2026"
  metrics: { current: MetricsSummary; previous: MetricsSummary };
  chartImage: string; // base64 data URI
  keywords: Array<{ keyword: string; impressions: number }>;
  reviewSummary: { count: number; avgRating: number; responseRate: number };
  postsPublished: number;
}

export function ReportDocument(props: ReportProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Business Info Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{props.profile.name}</Text>
          <Text style={styles.subtitle}>{props.profile.address}</Text>
          <Text style={styles.subtitle}>Performance Report - {props.month}</Text>
        </View>

        {/* Key Metrics Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Key Metrics</Text>
          <View style={styles.metricsRow}>
            {/* Render metric boxes with current vs previous comparison */}
          </View>
        </View>

        {/* Impressions Trend Chart */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Impressions Trend</Text>
          <Image style={styles.chartImage} src={props.chartImage} />
        </View>

        {/* Top Search Keywords */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Search Keywords</Text>
          {/* Render keyword table rows */}
        </View>

        {/* Review Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reviews</Text>
          {/* Review count, avg rating, response rate */}
        </View>

        {/* Posts Published */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Posts Published</Text>
          <Text>{props.postsPublished} posts published this month</Text>
        </View>
      </Page>
    </Document>
  );
}
```

### API Route for Single Report Download
```typescript
// src/app/api/reports/[id]/download/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateReport } from "@/lib/pdf/report-generator";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const report = await prisma.report.findUniqueOrThrow({
    where: { id: params.id },
    include: { profile: true },
  });

  // Generate on-demand (or serve from stored file)
  const pdfBuffer = await generateReport(report.profileId, report.month);

  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${report.profile.name}-${report.month.toISOString().slice(0, 7)}.pdf"`,
    },
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| GBP v4 `reportInsights` | Performance API v1 `fetchMultiDailyMetricsTimeSeries` | 2022 | Old API deprecated; must use v1 Performance API |
| `getDailyMetricsTimeSeries` (single metric) | `fetchMultiDailyMetricsTimeSeries` (multi metric) | 2022 | Fetch all metrics in one call instead of multiple |
| Client-side PDF (jsPDF) | Server-side @react-pdf/renderer | Ongoing | Server-side is more reliable for complex reports |
| puppeteer for PDF | @react-pdf/renderer | Ongoing | No headless browser needed; lighter deployment |

**Deprecated/outdated:**
- GBP v4 `accounts.locations.reportInsights`: Fully deprecated. Use Performance API v1.
- `getDailyMetricsTimeSeries`: Still works but `fetchMultiDailyMetricsTimeSeries` is more efficient (multiple metrics per call).

## File Storage Strategy

**Recommendation: Generate on-demand, cache optionally.**

For the MVP, generate PDFs on-demand when requested rather than pre-generating and storing files. This avoids file storage complexity. The Report model's `filePath` field can be used later for caching if needed.

For bulk download, generate all PDFs in a worker, stream them into a ZIP using `archiver`, and return the ZIP. Alternatively, store temporarily in `/tmp/reports/` and clean up after download.

If persistent storage is needed later, use Cloudflare R2 or S3 -- but for MVP with internal team use, on-demand generation is sufficient.

## GBP API Details

### DailyMetric Enum (Complete List)
| Enum Value | Maps to Prisma Field |
|------------|---------------------|
| BUSINESS_IMPRESSIONS_DESKTOP_SEARCH | impressionsSearchDesktop |
| BUSINESS_IMPRESSIONS_MOBILE_SEARCH | impressionsSearchMobile |
| BUSINESS_IMPRESSIONS_DESKTOP_MAPS | impressionsMapsDesktop |
| BUSINESS_IMPRESSIONS_MOBILE_MAPS | impressionsMapsMobile |
| WEBSITE_CLICKS | websiteClicks |
| CALL_CLICKS | callClicks |
| BUSINESS_DIRECTION_REQUESTS | directionRequests |
| BUSINESS_CONVERSATIONS | conversations |
| BUSINESS_BOOKINGS | (not stored -- not relevant for MVP) |
| BUSINESS_FOOD_ORDERS | (not stored) |
| BUSINESS_FOOD_MENU_CLICKS | (not stored) |

### Search Keywords API
- Endpoint: `GET /v1/locations/{locationId}/searchkeywords/impressions/monthly`
- Pagination: `pageSize` max 100, `pageToken` for next page
- Date format: `monthlyRange.startMonth.year`, `monthlyRange.startMonth.month`
- Response: `searchKeywordsCounts[]` with `searchKeyword` and `insightsValue` (either `value` or `threshold`)
- Privacy threshold: Keywords with <15 impressions return `threshold: 15` instead of actual count

### API Rate Limits
The GBP Performance API is subject to Google's standard rate limits. For 200 profiles, add a small delay between requests (200-500ms) to avoid hitting quotas. The existing worker pattern with `concurrency: 1` naturally serializes requests.

## Open Questions

1. **Location ID extraction from locationName**
   - What we know: The project stores `locationName` on the Profile model. The Performance API needs `locations/{numericId}`.
   - What's unclear: Whether `locationName` stores the full path (`accounts/123/locations/456`) or just the location part (`locations/456`). Need to check actual data.
   - Recommendation: Parse with `locationName.split("/").pop()` -- works for both formats.

2. **Analytics dashboard charting library (client-side)**
   - What we know: Need charts on the analytics dashboard page (not just in PDFs).
   - What's unclear: Which client-side charting library to use.
   - Recommendation: Use `recharts` -- lightweight, React-native, good for line/bar charts. Install alongside chart.js (chart.js is for server-side PDF charts only).

## Sources

### Primary (HIGH confidence)
- [GBP Performance API Reference](https://developers.google.com/my-business/reference/performance/rest) - Full API structure, endpoints, auth
- [fetchMultiDailyMetricsTimeSeries](https://developers.google.com/my-business/reference/performance/rest/v1/locations/fetchMultiDailyMetricsTimeSeries) - Request/response format
- [DailyMetric Enum](https://developers.google.com/my-business/reference/performance/rest/v1/DailyMetric) - Complete metric enum values
- [Search Keywords Monthly List](https://developers.google.com/my-business/reference/performance/rest/v1/locations.searchkeywords.impressions.monthly/list) - Keyword API details
- [@react-pdf/renderer npm](https://www.npmjs.com/package/@react-pdf/renderer) - v4.3.2, React 19 compatibility
- [react-pdf compatibility](https://react-pdf.org/compatibility) - React 19 support since v4.1.0

### Secondary (MEDIUM confidence)
- [chartjs-node-canvas npm](https://www.npmjs.com/package/chartjs-node-canvas) - Server-side chart rendering
- [react-pdf Issue #3074](https://github.com/diegomura/react-pdf/issues/3074) - Confirmed renderToBuffer works with React 19

### Tertiary (LOW confidence)
- GBP API data lag (2-3 days) -- mentioned in community forums but not officially documented by Google

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - googleapis already installed, @react-pdf/renderer confirmed React 19 compatible, chartjs-node-canvas well-established
- Architecture: HIGH - follows existing BullMQ worker patterns exactly, Prisma models already defined
- GBP Performance API: HIGH - official Google documentation verified
- PDF generation: HIGH - confirmed working with current React/Next.js versions
- Pitfalls: MEDIUM - deployment concerns (canvas native module) based on community reports

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable APIs, well-established libraries)
