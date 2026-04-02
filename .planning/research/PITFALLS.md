# Pitfalls Research

**Domain:** Adding optimization scoring UI, chart dashboards, card grid layouts, and review analytics to an existing Next.js + Prisma GBP management platform
**Researched:** 2026-04-02
**Confidence:** HIGH (based on existing codebase analysis + verified patterns)

---

## Critical Pitfalls

### Pitfall 1: Pulling Chart.js Into Server Components — Hydration Bombs

**What goes wrong:**
Chart.js (already in package.json as `chart.js`) is used only for server-side PDF rendering via `chartjs-node-canvas`. Adding interactive browser charts requires a different integration: a React wrapper like Recharts or shadcn/ui charts (which wraps Recharts). If you import Recharts directly in a page component or layout without `"use client"`, Next.js App Router will attempt server-side rendering, fail on browser-only APIs (SVG measurement, ResizeObserver), and throw hydration mismatch errors. The error only appears at runtime, not build time.

**Why it happens:**
The existing codebase uses `chart.js` + `chartjs-node-canvas` exclusively for server-side PDF rendering. New chart work naturally reaches for the same `chart.js` import, but browser charts need the React reconciler. Additionally, placing `"use client"` too high — on the page component itself rather than a leaf chart component — bloats the client bundle by pulling all sibling data-fetching server components into the client boundary.

**How to avoid:**
- Create isolated `*-chart.tsx` leaf components with `"use client"` at the top. Pass pre-computed data as plain serializable props from the Server Component parent.
- Do NOT add `"use client"` to any page or layout file for chart support.
- Use shadcn/ui chart components (they wrap Recharts with `"use client"` already applied) rather than importing Recharts directly — avoids double-boundary mistakes.
- The existing `chart-renderer.ts` (used for PDFs) is server-only. Never import it in a browser chart component.
- Test with `next build` — hydration errors are silent in dev mode with React 18 tolerant mode but explode in production.

**Warning signs:**
- `Error: Hydration failed because the server rendered HTML didn't match the client`
- `ReferenceError: ResizeObserver is not defined` during SSR
- Bundle analyzer showing chart library pulled into server component output
- Charts flash blank then render on first interaction

**Phase to address:**
Dashboard Upgrades and Review Metrics Dashboard phases — establish the chart component boundary pattern before writing any chart code.

---

### Pitfall 2: Optimization Score That Contradicts Itself Across the App

**What goes wrong:**
The optimization score for a profile is computed in multiple places: on the profile card in the Business Cards grid, on the Profile Optimization page, and potentially in the dashboard summary. If the score formula is not centralized, each view computes it differently (different weights, different input fields, different date windows). A profile shows 78% on the card grid but 91% on its detail page. Users notice and lose trust in the entire tool.

**Why it happens:**
Score computation feels simple at first — a quick inline calculation. Each developer or phase adds it independently to the component that needs it. The Prisma model has all the required data (keywords, descriptions, services, reviews, posts), so it's easy to inline. There is no existing `computeOptimizationScore()` utility in this codebase.

**How to avoid:**
- Build a single `lib/optimization-score.ts` function that accepts a typed `ProfileWithRelations` object and returns a structured score object: `{ total: number, breakdown: { keywords: number, description: number, services: number, reviews: number, posts: number } }`.
- Every UI that shows a score imports this one function. No exceptions.
- The function must be a pure TypeScript function (no Prisma calls inside it) — it operates on already-fetched data. This keeps it testable and usable in both Server and Client Components.
- Decide weights once and document them: e.g., keywords 20%, description 20%, services 20%, reviews 25%, posts 15%. Codify as named constants, not magic numbers.
- Write a unit test for the scoring function before building any UI that consumes it.

**Warning signs:**
- Score logic written inline in a JSX component (not a shared function)
- Score values differ between card and detail view for same profile
- Score changes when the page filter changes (indicates it's reading from filtered data instead of full profile data)

**Phase to address:**
Profile Optimization Page phase — create `lib/optimization-score.ts` as the very first deliverable, before any UI work.

---

### Pitfall 3: N+1 Queries When Loading 100–200 Business Cards with Metrics

**What goes wrong:**
The Business Cards View needs each card to show: profile name, address, average rating, recent post count, optimization score. The current `profiles/page.tsx` already does `include: { reviews: true }` which loads ALL review rows for all profiles in a single query — that is already loading hundreds to thousands of rows just for star ratings. Adding metrics (DailyMetric rows), posts, keywords, services, and descriptions to the card query for 150 profiles creates a monster query with massive data transfer.

**Why it happens:**
Prisma's `include` is convenient. Adding `include: { dailyMetrics: true }` feels like a one-liner, but for 150 profiles each with 90 days of DailyMetric rows, that's 13,500 rows returned to Node.js just for one section of one page. The existing `profiles/page.tsx` already uses `include: { reviews: true }` — a pattern that works at 10 profiles but degrades at 150.

**How to avoid:**
- Replace `include: { reviews: true }` on the profiles list query with a `_count` aggregate or a separate `groupBy` query for average ratings — never fetch all review rows just to compute an average.
- Use Prisma's `_avg` aggregation: `prisma.review.groupBy({ by: ['profileId'], _avg: { rating: true }, where: { profileId: { in: profileIds } } })` — one query for all profiles.
- For metrics on cards, query only the most recent 30-day aggregate, not all-time: `prisma.dailyMetric.groupBy({ by: ['profileId'], _sum: { websiteClicks: true, ... }, where: { date: { gte: thirtyDaysAgo } } })`.
- Pre-compute optimization scores server-side in a single pass over already-fetched data — do not issue a query per profile.
- Set a performance budget: the entire business cards page load should complete in under 1 second. Test with the full 150-profile dataset.

**Warning signs:**
- Slow Business Cards page load (over 2 seconds)
- Railway memory spikes on page visits
- `include` with relation arrays (not `_count`) on list endpoints

**Phase to address:**
Business Cards View phase — query design must be reviewed before implementation begins.

---

### Pitfall 4: Dashboard Aggregation Queries Blocking the Entire Page Render

**What goes wrong:**
The enhanced dashboard needs: recent automations feed (already exists), My Tasks table (already exists), optimization score averages across profiles, plus metrics summaries. Adding cross-profile metric aggregations (total impressions, avg rating across all profiles) to the existing `dashboard/page.tsx` Server Component stacks all queries serially — even with `Promise.all`, a slow aggregation query (e.g., summing 90 days of DailyMetric across 150 profiles) makes the entire page wait before rendering anything.

**Why it happens:**
`dashboard/page.tsx` is a single monolithic async Server Component. All data fetches happen at the top, all must complete before any HTML is sent. The existing page already runs 7 parallel queries. Adding heavy aggregations to this array makes the page noticeably slower for every visit.

**How to avoid:**
- Use React Suspense with streaming: wrap heavy analytics widgets in `<Suspense fallback={<Skeleton />}>` and split them into child async Server Components. The page shell renders immediately; slow stats stream in.
- Move cross-profile metric aggregations to dedicated API routes called client-side (or via Server Actions with `cache()`) so they don't block initial page HTML.
- For the dashboard, limit the scope: show metrics for the selected profile only (already the pattern via `getSelectedProfileId()`), not all-profile aggregations. All-profile aggregations belong in a dedicated analytics view, not the dashboard.
- Add database indexes if they don't exist: `DailyMetric(profileId, date)` is the most critical composite index for time-range queries.

**Warning signs:**
- Dashboard Time to First Byte over 500ms
- Page blank-screens for 2+ seconds before content appears
- Adding a new `Promise.all` entry to `dashboard/page.tsx` without a Suspense boundary

**Phase to address:**
Dashboard Upgrades phase — Suspense boundary architecture must be established before adding any new dashboard metrics.

---

### Pitfall 5: Review Trend Calculations That Are Wrong at Period Boundaries

**What goes wrong:**
Review Metrics Dashboard needs trend data: "15% more reviews this month vs last month." The naive implementation compares `count(reviews WHERE date >= startOfMonth)` to `count(reviews WHERE date >= startOfLastMonth AND date < startOfMonth)`. This works mid-month but produces misleading results early in the month (3 reviews vs 45 = -93%) and at year-end boundaries (December vs January month numbering).

**Why it happens:**
JavaScript `Date` arithmetic at month boundaries is error-prone. `new Date(now.getFullYear(), now.getMonth() - 1, 1)` works for most months but fails for January (month index 0): `now.getMonth() - 1 = -1` which JavaScript handles by wrapping to December of the previous year — actually correct, but only if you know it. Developers who aren't aware of this behavior may try to "fix" it and break it. Similarly, comparing a partial current month to a complete previous month is inherently unfair and produces alarming negative trends.

**How to avoid:**
- Use a date utility for all period calculations — never inline month arithmetic in component files.
- For trend comparisons, compare rolling 30-day windows (last 30 days vs prior 30 days) rather than calendar month vs last month. This produces stable, fair comparisons regardless of current date.
- Alternatively, if calendar months are required, show "month to date" comparisons by comparing the same day-of-month range in the prior month (e.g., "first 8 days of this month vs first 8 days of last month").
- Always surface the date range in the UI: "Apr 1–2 vs Mar 1–2" — users can then understand why numbers look different early in the month.
- Store `reviewDate` as UTC in the database (already the case in the schema) and do all boundary calculations in UTC to avoid timezone drift at midnight.

**Warning signs:**
- Trend shows -90% on the 1st of a new month
- Different users in different timezones see different trend numbers
- Month boundary dates hardcoded in component files

**Phase to address:**
Review Metrics Dashboard phase — establish the date range utility before writing any trend calculation.

---

### Pitfall 6: Replacing the List View with Card Grid Breaks Existing URL-Based Filters

**What goes wrong:**
The existing `profiles/page.tsx` renders a card grid (already 4-column grid — `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`). The reviews page has URL-based filters via `searchParams` (`?profileId=&rating=&responseStatus=`). When upgrading the Business Cards View, it's tempting to rebuild the page from scratch. Rebuilding without preserving the `searchParams` filter pattern breaks deep links, browser history, and the existing `ReviewFilters` component that depends on URL state.

**Why it happens:**
The "upgrade" scope feels like a rewrite, so developers start fresh. The existing URL filter pattern is subtle — it uses Next.js `searchParams` as the source of truth (not React state), which is the correct App Router pattern but easy to accidentally replace with `useState`.

**How to avoid:**
- Treat the Business Cards View as an enhancement of `profiles/page.tsx`, not a replacement. Add features incrementally: logo placeholder, optimization score badge, map thumbnail — without touching the query structure or the page's routing contract.
- If adding filters to the Business Cards View (e.g., filter by optimization score, filter by rating), use the same URL `searchParams` pattern already established in `reviews/page.tsx`.
- Before touching any page that has `searchParams`, document every URL parameter it currently accepts and verify they all still work after changes.
- The grid layout is already there (`xl:grid-cols-4`). The main work is enriching card data and adding new card slots — not rebuilding the grid.

**Warning signs:**
- New filter implemented with `useState` instead of URL params
- Existing `?profileId=` deeplinks stopped working after card view update
- `searchParams` import removed from a page that previously used it

**Phase to address:**
Business Cards View phase — read and document existing URL contracts before making any changes.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Inline score computation per component | Faster to build | Score diverges across pages; weight changes require hunting across files | Never — always centralize in `lib/optimization-score.ts` |
| `include: { reviews: true }` on profiles list | Simple one-liner | 1000s of rows fetched just for avg rating at scale | Never for list endpoints — use `_avg` aggregation |
| Monolithic dashboard page without Suspense | Simple code | Slow initial load blocks all widgets when one query is slow | Acceptable for MVP; refactor at first performance complaint |
| Hardcoded 30-day lookback for metrics | Simple implementation | Wrong for profiles with no recent data; misleading empty state | Acceptable if documented and shown in UI |
| `"use client"` on page-level for one chart | Fixes chart immediately | Entire page loses server-side rendering benefits | Never — push boundary to leaf chart component |
| Rating distribution computed in-memory from fetched reviews | Simple | All reviews fetched from DB just to count them by star | Acceptable under 500 reviews per profile; use groupBy above that |

---

## Integration Gotchas

Common mistakes when connecting the new features to the existing system.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Optimization score + onboarding status | Scoring un-onboarded profiles as 0% when they're intentionally out of scope | Filter score computation to only `isOnboarded: true` profiles; show "Not onboarded" state instead of 0 |
| Chart.js (PDF) vs. browser charts | Importing `chart.js` or `chartjs-node-canvas` in a browser chart component | Create separate `lib/pdf/chart-renderer.ts` (server-only) vs. `components/charts/*.tsx` (client, Recharts) — never import from each other |
| `getSelectedProfileId()` cookie in new pages | Forgetting to apply profile filter on new API endpoints | Every new endpoint reads `getSelectedProfileId()` and applies the filter — test with a profile selected AND with no profile selected |
| GBP metrics 1–3 day lag on charts | Showing "data as of today" when last data point is 2 days ago | Display the actual last data point date: "Views on Google — through Apr 1" not "through today" |
| DailyMetric date field (`@db.Date`) | Timezone drift — inserting as JavaScript `Date` object converts to UTC, shifts the date | Always construct dates as `new Date('YYYY-MM-DD')` (no time component) or use raw SQL for date-only fields |
| Review QR code + profile selection | QR code URL pointing to `/review` without profile context | QR code URL must encode the specific Google review link (`writeReviewUrl`) from the GBP profile data, not a generic app URL |
| Reports enhancement + existing PDF generator | Adding chart data to reports requires feeding it through `report-generator.ts`, not through React render | Report enhancements (competitor card, new charts) go in `lib/pdf/` using the existing `renderImpressionsChart` pattern — not React components |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loading all reviews per profile to compute avg rating on list view | Business Cards page takes 3–5 seconds | Use `prisma.review.groupBy({ by: ['profileId'], _avg: { rating: true } })` | At ~50 profiles with 50+ reviews each |
| Animating all 150 business cards with staggered MotionDiv delays | Cards render for 15 seconds as animations cascade | Cap stagger at 20 items max; use `viewport` prop to animate only visible cards | At 50+ profiles with `delay: i * 0.03` |
| Fetching full DailyMetric history for chart rendering | Report/chart page takes 10+ seconds | Always apply a date range `where` clause — never fetch all-time metrics | At 200 profiles × 365 days = 73,000 rows |
| Running optimization score on all profiles without indexed queries | Dashboard loads slowly; Railway timeouts | Add DB index on `ProfileDescription(profileId, isApproved)`, `ProfileKeyword(profileId)` | At 150+ profiles |
| Generating QR codes server-side for all profiles on page load | Business cards page slow; high CPU | Generate QR codes client-side (browser canvas API via `qrcode` library) or on-demand | At 50+ profiles |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Exposing raw profile metrics in a public API endpoint without auth | Any user can scrape GBP performance data for all clients | All new `/api/` routes must check `getServerSession()` and return 401 if unauthenticated — audit every new route |
| QR code review URL containing internal profile IDs | Enumerable profile IDs exposed in QR code links | QR codes should link to the GBP direct review URL (stored as `profile.websiteUrl` or fetched from GBP) — never to internal app routes with profile IDs |
| Competitor data stored without client consent indication | Compliance risk if client data is used to train competitor benchmarks | Competitor data for v1.2 is illustrative/static (not API-sourced) — document this clearly; do not build competitor tracking from client data |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Optimization score changes daily (post count goes up, score goes up) | Score feels gameable and meaningless | Score should reflect SEO completeness (profile fields filled), not operational activity; posts/reviews are a maintenance indicator, not a completeness signal |
| Showing optimization score for profiles with no GBP metrics yet (1–3 day lag) | Score appears low even though profile is well-optimized | Show a "Metrics syncing..." state for profiles where `DailyMetric` has no recent data; don't penalize score for API lag |
| Chart date axis showing UTC dates shifting overnight | Charts show wrong day for users in non-UTC timezones | Display dates in `America/Los_Angeles` or use local format; GBP metrics are already date-only (`@db.Date`), not timestamps |
| Displaying "0 reviews" on cards for profiles that have reviews but haven't synced | Misleading signal; team thinks profile has no reviews | Show `null` / "Not synced" state distinctly from verified 0-review state |
| Bulk actions on card grid (approve all, re-optimize all) with no confirmation | Accidental mass GBP edits trigger the 10-edit/min rate limit across profiles | Bulk actions must show a confirmation modal with count and a progress indicator; process one profile at a time with visible feedback |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Optimization Score gauge:** Shows a number but doesn't explain the breakdown — verify there is a breakdown tooltip or expand section showing per-category scores (keywords: X/20, description: X/20, etc.)
- [ ] **Review Metrics Dashboard:** Shows rating distribution chart but doesn't reflect the same date filter applied to trend charts — verify all charts on the page share the same date window state
- [ ] **Business Cards with logos:** Logo placeholder renders but actual GBP logo URL is not stored in the `Profile` model — verify logo fetching from GBP API is wired up, or show a deterministic avatar (initials) that renders identically server and client (avoid hydration mismatch from random colors)
- [ ] **Views on Google chart:** Chart renders but last data point is 2 days ago due to API lag — verify the "data through [date]" label is visible and accurate
- [ ] **QR Code review request:** QR code renders but the review link behind it is the wrong URL (app URL vs. Google review URL) — verify QR code encodes the correct `maps.google.com/maps?cid=...&authuser=0#action=write-review` or equivalent link
- [ ] **Competitor card in reports:** Renders static placeholder data, not real competitor data — verify it is clearly labeled as "Example" or "Industry Average" and is not presented as live data
- [ ] **Profile filter + new pages:** All new routes respect `getSelectedProfileId()` — verify each new page endpoint with a profile selected shows only that profile's data

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Hydration mismatch from chart in wrong component boundary | LOW | Move `"use client"` to leaf chart component; remove it from page/layout; clear `.next` cache |
| Divergent optimization scores across pages | MEDIUM | Extract scoring to `lib/optimization-score.ts`; do a grep for all inline score calculations; replace all with the shared function; verify visually |
| Slow Business Cards page (N+1 or over-fetching) | MEDIUM | Replace `include` with aggregation queries; add missing DB indexes; test with EXPLAIN ANALYZE |
| Review trend showing -90% on month start | LOW | Replace calendar month comparison with rolling 30-day window; add date range label to UI |
| Chart blank on production but works in dev | LOW | Usually a missing `"use client"` or SSR-incompatible import; check for dynamic imports as fallback (`next/dynamic` with `{ ssr: false }`) |
| QR code pointing to wrong URL | LOW | Update QR code generation to use the correct GBP review URL field; resync profiles to populate the field if it was missing |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Chart hydration + client boundary architecture | Dashboard Upgrades (first chart phase) | `next build` with no hydration errors; bundle analyzer shows charts in client bundle only |
| Optimization score centralization | Profile Optimization Page (first phase) | Single `lib/optimization-score.ts` function; grep shows zero inline score calculations in components |
| N+1 / over-fetching on Business Cards | Business Cards View phase | Page load time under 1s with 150 profiles; no `include` with relation arrays on list queries |
| Dashboard aggregation blocking render | Dashboard Upgrades phase | Dashboard TTFB under 300ms; heavy widgets wrapped in Suspense |
| Review trend period boundary bugs | Review Metrics Dashboard phase | Trend numbers stable on 1st of month; same result for users in different timezones |
| URL filter preservation during card upgrade | Business Cards View phase | `?profileId=&rating=` deeplinks still work after changes |
| GBP metrics lag not surfaced in UI | Reports Enhancement + Review Metrics phases | Every chart shows "Data through [last sync date]" label |
| Staggered animation performance at scale | Business Cards View phase | Card grid renders under 500ms for 150 profiles; stagger capped at 20 items |

---

## Sources

- Codebase analysis: `src/app/dashboard/profiles/page.tsx` — existing card grid with `include: { reviews: true }` over-fetch pattern identified
- Codebase analysis: `src/lib/pdf/chart-renderer.ts` — server-only chart rendering with `chartjs-node-canvas`, must stay isolated from browser chart code
- Codebase analysis: `prisma/schema.prisma` — `DailyMetric(profileId, date @db.Date)`, `Review(profileId, rating)`, `MonthlyKeyword(profileId, month)` — aggregation query opportunities identified
- Codebase analysis: `src/app/dashboard/reviews/page.tsx` — URL `searchParams` filter pattern that must be preserved
- [shadcn/ui Charts — Recharts wrapper with built-in `"use client"`](https://www.shadcn.io/charts) — HIGH confidence
- [shadcn/ui Next.js 15 hydration bug with charts](https://github.com/shadcn-ui/ui/issues/5661) — confirmed hydration failure pattern in App Router — HIGH confidence
- [Next.js "use client" placement best practice — push to leaves](https://nextjs.org/docs/app/getting-started/server-and-client-components) — HIGH confidence
- [Prisma groupBy and aggregation — use `where` to filter before grouping](https://www.prisma.io/docs/orm/prisma-client/queries/aggregation-grouping-summarizing) — HIGH confidence
- [Prisma groupBy date timezone pitfalls](https://github.com/prisma/prisma/issues/6653) — no native timezone-aware date grouping; requires raw SQL or UTC-normalized dates — HIGH confidence
- [GBP Performance API data lag (up to 4 days)](https://support.powermyanalytics.com/portal/en/kb/articles/missing-or-delayed-data-in-google-business-profile) — MEDIUM confidence (multiple sources agree on 1–4 day lag)
- [Next.js streaming + Suspense for slow aggregations](https://dev.to/kiravaughn/nextjs-performance-when-you-have-200000-database-rows-5ee0) — HIGH confidence

---
*Pitfalls research for: v1.2 Profile Optimization & UI Enhancements — MapsAI / Rankmaps.io*
*Researched: 2026-04-02*
