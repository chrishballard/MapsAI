# Project Research Summary

**Project:** Rankmaps.io v1.2 — Profile Optimization & UI Enhancements
**Domain:** GBP management SaaS — analytics dashboards, optimization scoring, card grid UI
**Researched:** 2026-04-02
**Confidence:** HIGH

## Executive Summary

Rankmaps.io v1.2 adds five UI and analytics features to a fully-shipping GBP management platform: a profile optimization score page, dashboard upgrades, an upgraded business cards view, a review metrics dashboard, and report enhancements. All five features are front-end and query complexity problems, not integration complexity problems — every signal needed for scoring, analytics, and reporting is already in the PostgreSQL database from v1.0 and v1.1. Zero new GBP API capabilities are required. The recommended approach is to build incrementally on existing patterns: async RSC pages for data fetching, small client-component islands for interactivity, Recharts for all browser charts (via the shadcn ChartContainer wrapper), and a single pure TypeScript function for the optimization score that every UI surface imports without exception.

The principal risk is architectural fragmentation: the optimization score computed differently across the card grid, profile detail, and optimization page; browser chart components inadvertently pulling in the server-only chart.js/chartjs-node-canvas; and list-page queries over-fetching review rows for all profiles. All three risks have clear preventions — centralized score function, isolated leaf client components with "use client", and Prisma aggregation queries instead of full relation includes. A secondary operational risk is the PDF report generator: it uses a different rendering engine (@react-pdf/renderer) with different semantics than web React, and PDF changes should be explicitly sequenced after all web UI changes are validated.

The only feature with significant unknowns is the competitor comparison card in reports, which requires Google Places API calls not yet used in the codebase, quota implications, and data storage design. Research flags this as v1.3 work. Everything else is either already built (v1.1 re-optimization API routes, attribute UI, profile selector, tasks table) or a well-understood incremental addition.

---

## Key Findings

### Recommended Stack

The existing stack (Next.js 16, React 19, Prisma, Tailwind CSS 4, shadcn/ui) requires only two new npm packages for v1.2: `recharts@^3.8.1` for browser charts and `qrcode.react@^4.2.0` for client-side QR code rendering. Recharts is the official charting primitive behind shadcn's ChartContainer, is fully compatible with React 19, and integrates with Tailwind CSS variables via the ChartContainer wrapper. After installing recharts, run `npx shadcn@latest add chart` to get the Recharts v3-compatible chart primitives (PR #8486, merged March 2026). Map thumbnails on business cards require no npm package — use the Google Maps Static API via a plain `<img>` URL constructed server-side with a new `GOOGLE_MAPS_STATIC_API_KEY` env var (10,000 free requests/month, well within budget). The existing chart.js and chartjs-node-canvas remain for PDF server-side rendering only and must never be imported in browser chart components.

**Core technologies:**
- `recharts@^3.8.1`: browser charts (line, bar, radial gauge) — shadcn-native, React 19 compatible, SVG-based
- `qrcode.react@^4.2.0`: client-side QR code rendering for review request panel — zero backend, highest adoption in category
- Google Maps Static API (no npm): map thumbnails on business cards — server-side URL construction, free tier sufficient
- Recharts `RadialBarChart` (built-in): optimization score gauge — no separate gauge library needed

**Version requirements:**
- After `npm install recharts`, run `npx shadcn@latest add chart` to get v3-compatible primitives
- CSS variable syntax change: use `var(--chart-1)` not `hsl(var(--chart-1))` (breaking change in March 2026 update)

### Expected Features

v1.2 delivers five feature areas. All must-have items are derivable from existing DB data. The only P3/deferred item with external dependency risk is the competitor comparison card.

**Must have (table stakes):**
- Optimization score gauge (0-100) with per-signal audit card breakdown — users trained to expect a score from every GBP tool
- AI description and services suggestions with approve/ignore workflow — reuses v1.1 API routes directly
- Review total/trend, rating distribution chart, monthly review volume line chart — baseline for any review management tool
- Days since last review surfaced prominently — GBP ranking signal, prompts action
- Review request QR code panel — advertised by Paige (competitor), high user expectation
- Business cards 4-column grid with star rating, review count, address, status badge — competitor standard (BrightLocal, HighLevel)
- Dashboard automations feed (last 20 actions) and business filter polish — usability requirement at 100-200 profiles
- Reports: date range controls, Views on Google dual-line chart, website clicks sparkline, completed actions log

**Should have (competitive differentiators):**
- Google Maps thumbnail on business cards — no competitor does this; immediate visual recognition
- Optimization score badge on business cards — at-a-glance health without navigating to profile
- AI executive summary narrative in reports — one small Claude call, high perceived value
- Dual-line Views on Google chart (Search vs Maps breakdown) — more informative than competitors' single-line

**Defer to v1.3+:**
- Reports competitor comparison card — requires Google Places API, quota planning, and data storage design
- Optimization score trend over time — requires historical score snapshots and schema additions
- Review keyword analysis (NLP on review text)
- Automated review request emails/SMS (email infra, CAN-SPAM, Google ToS review)
- Report scheduling and auto-delivery

### Architecture Approach

All five features follow the existing App Router pattern: async RSC pages perform all Prisma queries and computation server-side, passing serialized typed props to small `"use client"` leaf components for interactivity (chart animations, button handlers, QR code rendering). Two new routes are added (`/dashboard/optimization/[profileId]/` and `/dashboard/reviews/metrics/[profileId]/`), three existing pages are extended (profiles, dashboard, reports), and three minimal API routes are added for client-side re-fetch after mutations. No new Prisma models are required — the optimization score is a pure TypeScript function over existing data, and all chart data already exists in `Review`, `DailyMetric`, and `Post` tables.

**Major components:**
1. `src/lib/optimization-score.ts` — pure function, `ProfileWithRelations` → `{ total, grade, checks[] }`, single source of truth for every score display
2. `src/app/dashboard/optimization/[profileId]/page.tsx` — RSC: fetches profile with all optimization relations, passes to score gauge + audit grid client components
3. `src/app/dashboard/reviews/metrics/[profileId]/page.tsx` — RSC: parallel Prisma queries for rating distribution, monthly trend, place ID; passes to recharts components + QR code section
4. `src/components/optimization/score-gauge.tsx` — client component: Recharts RadialBarChart semicircle, score color bands (green ≥70, amber 40-69, red <40)
5. `src/components/reviews/review-trend-chart.tsx` and `rating-distribution.tsx` — client components: Recharts LineChart and horizontal BarChart with shadcn ChartContainer
6. Extended RSC queries in `/dashboard/profiles/page.tsx` (cards), `/dashboard/page.tsx` (automations + welcome), `/dashboard/reports/page.tsx` (metrics charts + actions log)

### Critical Pitfalls

1. **Chart hydration errors from wrong client boundary placement** — never add `"use client"` to a page or layout file for chart support; create isolated `*-chart.tsx` leaf components with `"use client"` at the top and pass pre-computed data as serializable props. Test with `next build` — hydration errors are silent in dev mode but explode in production.

2. **Divergent optimization scores across UI surfaces** — build `lib/optimization-score.ts` as the very first deliverable, before any UI; every component imports this one function, no inline score computation anywhere. Write a unit test before building any UI that consumes it.

3. **N+1 over-fetching on the business cards page** — replace `include: { reviews: true }` with `prisma.review.groupBy({ by: ['profileId'], _avg: { rating: true } })` and `_count` aggregates; never fetch full relation arrays on list endpoints; benchmark with the full 150-profile dataset before shipping.

4. **Dashboard aggregation blocking entire page render** — wrap heavy analytics widgets in `<Suspense fallback={<Skeleton />}>` with child async RSCs; limit dashboard scope to the selected profile's data (not cross-profile aggregations); add `DailyMetric(profileId, date)` composite DB index if missing.

5. **Review trend period boundary bugs** — use rolling 30-day windows (not calendar month vs last month) for trend comparisons; always surface the date range in the UI; perform all date arithmetic in UTC using `new Date('YYYY-MM-DD')` (no time component) to avoid timezone drift.

6. **Business cards page inadvertently breaking URL-based filters** — treat the upgrade as an enhancement of the existing `profiles/page.tsx`, not a rewrite; document every URL parameter the page currently accepts before touching it; the grid layout (`xl:grid-cols-4`) already exists.

---

## Implications for Roadmap

Based on research, the natural build order is: foundation lib first, then safest/most isolated feature (business cards), then the existing-page extension (dashboard), then the new optimization page (depends on foundation), then review metrics (independent, introduces chart pattern), then reports (highest operational risk due to PDF).

### Phase 1: Foundation — Score Library and Dependencies

**Rationale:** The optimization score function must exist before any UI that displays a score. Installing recharts before any chart component avoids mid-phase package.json changes that can break builds. This phase has zero visual output but enables all subsequent phases.
**Delivers:** `src/lib/optimization-score.ts` (pure function, unit-tested), `recharts` and `qrcode.react` installed, shadcn chart component updated to Recharts v3, `GOOGLE_MAPS_STATIC_API_KEY` env var documented.
**Addresses:** Foundational enabler for Phases 2-6.
**Avoids:** Divergent optimization scores (Pitfall 2), chart hydration errors from wrong setup (Pitfall 1).

### Phase 2: Business Cards View

**Rationale:** Lowest risk feature — modifies one existing page, adds no new routes, no new models, no chart library integration. Builds confidence with the query extension pattern before tackling more complex pages.
**Delivers:** Enriched 4-column profile card grid with star rating (from `_avg` aggregation), review count, address, status badge, Google Maps thumbnail (conditional on placeId), optimization score badge (from Phase 1 lib), posts-this-month count.
**Addresses:** Business cards table stakes (card grid, rating, address, status badge); map thumbnail differentiator.
**Avoids:** N+1 over-fetching (Pitfall 3) — uses `_avg` and `_count` aggregates not full relation includes; URL filter preservation (Pitfall 6) — document existing searchParams before making changes.

### Phase 3: Dashboard Upgrades

**Rationale:** Extends the existing complex dashboard page rather than creating a new route. Comes after business cards builds confidence with the query extension pattern. Establishes Suspense boundaries before later phases add more metrics widgets.
**Delivers:** Welcome banner, extended automations feed (includes description/service optimization pushes), business filter bar polish. Suspense boundaries established as the dashboard pattern going forward.
**Addresses:** Dashboard table stakes (automations feed, business filter visibility); welcome banner as orientation.
**Avoids:** Dashboard aggregation blocking render (Pitfall 4) — Suspense boundaries added in this phase, not retrofitted later.

### Phase 4: Profile Optimization Page

**Rationale:** Depends on Phase 1 score library. New route, new components, first use of Recharts RadialBarChart gauge. Sidebar navigation item added here (after the page exists, avoiding dead links). Re-uses v1.1 approve/ignore API routes — no new backend work for the suggestions workflow.
**Delivers:** `/dashboard/optimization/[profileId]/` with score gauge, per-signal audit cards with CTAs, approve/ignore suggestion workflow (reusing v1.1 API routes), link from profile detail page, Optimization nav item in sidebar.
**Addresses:** Profile optimization page table stakes (gauge, audit cards, suggestions); bulk approve as stretch goal.
**Avoids:** Divergent scores (Pitfall 2) — uses Phase 1 lib exclusively; chart boundary pattern (Pitfall 1) — gauge is a leaf client component passing computed data from RSC parent.

### Phase 5: Review Metrics Dashboard

**Rationale:** Fully independent of Phase 4 but benefits from the Recharts client component pattern established there. QR code component introduced here. All review data is already in the DB from existing sync workers.
**Delivers:** `/dashboard/reviews/metrics/[profileId]/` with rating distribution horizontal bar chart, monthly review volume line chart, total reviews with trend (rolling 30-day window), days since last review, QR code review request panel with download option.
**Addresses:** Review metrics table stakes (total/trend, distribution, monthly chart, recency); QR code differentiator.
**Avoids:** Review trend period boundary bugs (Pitfall 5) — rolling 30-day window date utility built before any trend query; chart hydration (Pitfall 1) — leaf client component pattern already established.

### Phase 6: Reports Enhancement

**Rationale:** Highest operational risk phase because changes touch the existing PDF generator. Sequenced last so web UI enhancements are validated independently before PDF template changes are attempted. Competitor card ships as a static "Coming soon" placeholder — no Google Places API calls in this milestone.
**Delivers:** Date range controls on reports page, Views on Google dual-line chart (Search vs Maps from existing DailyMetric fields), website clicks sparkline, completed actions log table. PDF template extensions are optional/stretch. Competitor card rendered as labeled placeholder.
**Addresses:** Reports table stakes (date range, Views chart, website clicks, completed actions log); AI executive summary narrative as stretch (single Claude call).
**Avoids:** PDF generator operational risk — web UI enhancements validated before PDF changes; competitor API risk — deferred to v1.3.

### Phase Ordering Rationale

- Phase 1 is a prerequisite for Phases 2 and 4 (score function must be single source of truth before any score UI exists)
- Phase 2 is safest first — isolated page, no new routes, builds query extension pattern confidence
- Phase 3 extends the complex dashboard — better after simpler extension in Phase 2; establishes Suspense boundaries early
- Phase 4 uses Phase 1 lib; sidebar nav item added after the target page exists (avoids dead nav links)
- Phase 5 is independent but benefits from chart patterns established in Phase 4
- Phase 6 is last because PDF changes carry live-file operational risk

### Research Flags

Phases with well-documented patterns (skip `/gsd:research-phase`):
- **Phase 1:** Standard npm install + shadcn CLI — fully documented, no unknowns
- **Phase 2:** Page query extension and card layout — established patterns, existing grid already in place
- **Phase 3:** Dashboard extension with Suspense — Next.js streaming is well-documented, follows existing dashboard pattern
- **Phase 4:** RSC + client island for score page — mirrors existing v1.1 onboarding page structure exactly

Phases that may benefit from targeted pre-implementation validation:
- **Phase 5:** Prisma `groupBy` date aggregation with timezone handling — confirm UTC date boundary behavior against the actual `@db.Date` schema field before writing trend queries (Prisma issue #6653 documents timezone drift). Also confirm `profile.placeId` population rate before building QR code component.
- **Phase 6 (PDF extension):** `@react-pdf/renderer` API for adding new chart sections needs direct inspection of `src/lib/pdf/report-generator.ts` before writing — PDF rendering semantics differ from web React and the full file structure was not inspected during research.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommendations verified against official docs, GitHub releases, and confirmed PRs. React 19 compatibility confirmed. Only two new packages required. |
| Features | HIGH | Based on direct codebase inspection of v1.0/v1.1 plus competitor feature analysis (Paige, BrightLocal, HighLevel). Table stakes are well-established in the local SEO tool category. |
| Architecture | HIGH | Based on direct inspection of 129 TypeScript files. Existing patterns identified and extended — not invented. Prisma schema inspected directly. Build order derived from actual file dependencies. |
| Pitfalls | HIGH | Based on direct codebase pattern analysis (over-fetch identified in profiles page, server-only chart renderer identified) plus verified Next.js App Router hydration issues from confirmed GitHub issues. |

**Overall confidence:** HIGH

### Gaps to Address

- **`recharts` install status:** Architecture research flags that recharts may or may not already be installed. Verify with `grep recharts package.json` before Phase 1. If already present, skip the install but still run `npx shadcn@latest add chart` to get Recharts v3-compatible primitives.
- **`GOOGLE_MAPS_STATIC_API_KEY` vs existing GBP OAuth key:** Unclear whether a separate key is needed or the existing Google OAuth project key can serve both GBP and Static Maps. Verify in Google Cloud Console during Phase 2 before building the map thumbnail component.
- **`profile.placeId` population rate:** Map thumbnail and QR code review URL both depend on `profile.placeId` being populated from v1.1 onboarding. Verify what percentage of onboarded profiles have `placeId` set and build explicit fallback states before shipping components that depend on it.
- **PDF generator internal structure:** `src/lib/pdf/report-generator.ts` was identified but not fully read during research. Before Phase 6 PDF work, read the full file to understand how new data sections thread through the existing template before committing to an approach.
- **DB index coverage:** Pitfalls research recommends `DailyMetric(profileId, date)` and `ProfileDescription(profileId, isApproved)` composite indexes. Verify current schema index definitions in `prisma/schema.prisma` before writing aggregation queries — add missing indexes in Phase 1 or Phase 3 before scale queries are written.

---

## Sources

### Primary (HIGH confidence)
- Existing MapsAI codebase (v1.0 + v1.1) — direct inspection of 129 TypeScript files, Prisma schema, existing component patterns
- [shadcn/ui Chart docs](https://ui.shadcn.com/docs/components/chart) — Recharts v3 requirement confirmed, ChartContainer usage
- [shadcn/ui PR #8486](https://github.com/shadcn-ui/ui/pull/8486/files) — Recharts v3 support merged March 2026, breaking CSS variable syntax change confirmed
- [recharts GitHub releases](https://github.com/recharts/recharts/releases) — v3.8.1 latest, React 19 compatibility confirmed in issue #4558
- [Next.js server/client components docs](https://nextjs.org/docs/app/getting-started/server-and-client-components) — "use client" leaf placement best practice
- [Prisma groupBy and aggregation docs](https://www.prisma.io/docs/orm/prisma-client/queries/aggregation-grouping-summarizing)
- [Google Maps Static API docs](https://developers.google.com/maps/documentation/maps-static/start) — URL format verified, 10k free/month confirmed
- [HighLevel GBP Optimization docs](https://help.gohighlevel.com/support/solutions/articles/155000005837) — competitor feature baseline
- [AgencyAnalytics GBP Insights guide](https://agencyanalytics.com/blog/google-business-profile-insights) — metrics and reporting standards
- [shadcn/ui chart hydration issue #5661](https://github.com/shadcn-ui/ui/issues/5661) — confirmed hydration failure pattern in App Router

### Secondary (MEDIUM confidence)
- [Paige by Merchynt feature overview](https://www.merchynt.com/paige) — marketing page, competitor feature baseline
- [EmbedSocial GBP Management Tools 2026](https://embedsocial.com/blog/best-google-business-profile-management-tools/) — competitive landscape overview
- [GBP Performance API data lag](https://support.powermyanalytics.com/portal/en/kb/articles/missing-or-delayed-data-in-google-business-profile) — 1-4 day lag confirmed across multiple sources
- [qrcode.react npm](https://www.npmjs.com/package/qrcode.react) — v4.2.0, 1,215 dependents, API confirmed

### Tertiary (LOW confidence — needs validation during implementation)
- `profile.placeId` population rate — assumed from v1.1 onboarding flow but not directly measured in DB
- Google Static Maps API key sharing with GBP OAuth project — assumed separate key required, needs Google Cloud Console verification

---
*Research completed: 2026-04-02*
*Ready for roadmap: yes*
