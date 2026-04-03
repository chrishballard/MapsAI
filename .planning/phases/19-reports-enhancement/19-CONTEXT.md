# Phase 19: Reports Enhancement - Context

**Gathered:** 2026-04-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver an interactive reports dashboard at `/dashboard/reports` replacing the current generate/download-only page. Users can select a date range and see all key GBP performance metrics (Views on Google, Phone Calls, Website Clicks, Direction Requests) with period-over-period comparisons and sparkline charts, a completed actions log, an AI-generated executive summary, and a PDF download of the current report view. Respects the business filter.

</domain>

<decisions>
## Implementation Decisions

### Page Architecture
- **D-01:** Replace the existing `/dashboard/reports` page with an interactive metrics dashboard. The current page is a generate form + download list — the enhanced version becomes the primary reports experience.
- **D-02:** Keep the "Generate Report" form and "Generated Reports" download list as a collapsible section at the bottom of the page, preserving existing functionality.

### Date Range Controls
- **D-03:** Preset date range buttons: 7 days, 30 days, 90 days, and a custom range option. Default to 30 days.
- **D-04:** Period-over-period comparison automatically uses the preceding equal-length period (e.g., 30d selected → compare last 30 days vs the 30 days before that). Matches Phase 18's rolling-window approach.
- **D-05:** Date range is client-side state that triggers a re-fetch of dashboard data. Use URL search params or React state — Claude's discretion.

### Views on Google Chart (RPT-02)
- **D-06:** Dual-line Recharts `LineChart` showing Search impressions vs Maps impressions over the selected date range. Daily granularity.
- **D-07:** Two summary cards above the chart showing Search total and Maps total with % change badges vs previous period.
- **D-08:** Search line uses violet (`#7c3aed`), Maps line uses emerald (`#10B981`) — consistent with existing chart-renderer.ts color scheme for maps.

### Metric Cards with Sparklines (RPT-03, RPT-04, RPT-05)
- **D-09:** Phone Calls, Website Clicks, and Direction Requests each rendered as an individual stat card showing: current period total (large number), previous period comparison, % change badge (green up / red down), and a small sparkline chart inside the card.
- **D-10:** Sparklines use Recharts `LineChart` or `AreaChart` in a compact container (~120x40px). No axes, no labels — just the trend line.
- **D-11:** Cards arranged in a 3-column responsive grid below the Views on Google section.

### Actions Log (RPT-06)
- **D-12:** Timeline/feed format consistent with the Phase 16 automations feed (`src/app/dashboard/automations-feed.tsx` pattern). Shows actions chronologically with type icon, timestamp, business name, and details.
- **D-13:** Actions include: posts published, reviews responded, descriptions pushed, services updated, attributes updated. Scoped to the selected date range.
- **D-14:** Query from Post (status=PUBLISHED, publishedAt in range), ReviewResponse (status=PUBLISHED, createdAt in range), and optimization-related activity if trackable.

### AI Executive Summary (RPT-07)
- **D-15:** 3-sentence summary displayed as a styled callout card at the top of the dashboard, below the date range selector and above the charts.
- **D-16:** Generated on-demand using Claude API (claude-sonnet) when the page loads or date range changes. Pass in the computed metrics as context for the prompt.
- **D-17:** Cache the narrative per profile + date range combo to avoid redundant API calls. Simple in-memory or database cache — Claude's discretion.

### PDF Export (RPT-08)
- **D-18:** Enhance existing `src/lib/pdf/report-generator.ts` and `src/lib/pdf/report-template.tsx` to include the new metric sections (sparkline equivalents as chart.js server-rendered PNGs, actions log as table).
- **D-19:** "Download PDF" button on the dashboard passes the current date range to the API endpoint. PDF reflects the same data the user sees on screen.
- **D-20:** Include the AI narrative text in the PDF as a styled text block at the top.

### Business Filter
- **D-21:** Respect existing `getSelectedProfileId()` business filter. When a profile is selected, all metrics scope to that profile. When no profile selected, show aggregate.

### Claude's Discretion
- Exact Recharts sparkline configuration (area fill, line thickness, color)
- Skeleton shapes for Suspense fallbacks during data loading
- Whether date range uses URL search params or client state
- MotionDiv animation timing
- AI narrative prompt engineering and caching strategy details
- Whether to use Suspense per section or one boundary

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Reports Infrastructure
- `src/app/dashboard/reports/page.tsx` — Current reports page (will be replaced/enhanced)
- `src/app/dashboard/reports/report-actions.tsx` — GenerateForm and DownloadButton client components (preserve)
- `src/lib/pdf/report-generator.ts` — PDF generation with Prisma queries, chart rendering, @react-pdf/renderer. **READ FULLY before modifying** (STATE.md research flag)
- `src/lib/pdf/report-template.tsx` — ReportDocument component and ReportData interface
- `src/lib/pdf/chart-renderer.ts` — chart.js server-side PNG rendering for PDF charts
- `src/app/api/reports/generate/route.ts` — API route for report generation
- `src/app/api/reports/[id]/download/route.ts` — API route for PDF download

### Data Model
- `prisma/schema.prisma` (lines 162-178) — `DailyMetric` model with impressions (search/maps desktop/mobile), websiteClicks, callClicks, directionRequests, conversations. Unique on `[profileId, date]`.

### Phase 18 Patterns (direct dependency)
- `src/app/dashboard/reviews/metrics/review-metrics-content.tsx` — Reference for Recharts + server data fetching pattern
- `src/app/dashboard/reviews/metrics/volume-rating-trend-chart.tsx` — Reference for Recharts LineChart with dual Y-axes
- `src/app/dashboard/reviews/metrics/rating-distribution-chart.tsx` — Reference for Recharts BarChart
- `src/lib/review-metrics.ts` — Reference for pure data transformation functions (TDD pattern)

### Dashboard Patterns
- `src/app/dashboard/stats-grid.tsx` — Stat card layout, Prisma queries with business filter
- `src/app/dashboard/page.tsx` — Suspense boundaries, MotionDiv page structure
- `src/components/sidebar.tsx` — Sidebar nav items (reports link already exists)

### Phase 16 Automations Feed
- `src/app/dashboard/automations-feed.tsx` — Reference for timeline/feed component pattern (actions log should follow this)

### UI Components
- `src/components/ui/chart.tsx` — ChartContainer wrapper for Recharts
- `src/components/ui/card.tsx` — Card component
- `src/components/ui/badge.tsx` — Badge for % change indicators
- `src/components/motion-wrapper.tsx` — MotionDiv for entrance animations

### Business Filter
- `src/lib/selected-profile.ts` — `getSelectedProfileId()` server-side helper

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ReportDocument` / `ReportData` (`src/lib/pdf/report-template.tsx`): Existing PDF template with metrics row, chart image, keywords table — extend with new sections
- `renderImpressionsChart` (`src/lib/pdf/chart-renderer.ts`): Server-side chart.js PNG rendering — reuse pattern for sparkline-equivalent charts in PDF
- `ChartContainer` (`src/components/ui/chart.tsx`): Recharts wrapper for browser charts
- `GenerateForm` / `DownloadButton` (`report-actions.tsx`): Existing client components to preserve
- `getSelectedProfileId()`: Business filter helper
- `sumMetrics()` in report-generator.ts: Metric aggregation pattern — extract/reuse for dashboard queries

### Established Patterns
- Server Components for data fetching, Client Components for Recharts interactivity
- Prisma queries with `profileFilter` spread for business filter scoping
- Pure data transformation functions with TDD (Phase 18 pattern)
- Recharts + ChartContainer for browser charts; chart.js for server-side PDF charts
- `@react-pdf/renderer` with `renderToBuffer` for PDF generation
- DailyMetric has separate fields for search/maps desktop/mobile impressions — aggregate in queries

### Integration Points
- `/dashboard/reports` route already exists in sidebar nav — no new nav item needed
- `/api/reports/generate` and `/api/reports/[id]/download` API routes — may need date range parameter additions
- DailyMetric table with `@@unique([profileId, date])` — efficient range queries
- Claude API (`@anthropic-ai/sdk`) already in project deps — use for AI narrative

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Auto-mode selected recommended defaults for all gray areas.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

RPT-09 (scheduled auto-delivery via email) and RPT-10 (configure report recipients) are already deferred to v1.3+ in REQUIREMENTS.md.

</deferred>

---

*Phase: 19-reports-enhancement*
*Context gathered: 2026-04-03*
