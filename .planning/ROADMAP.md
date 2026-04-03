# Roadmap: MapsAI

## Milestones

- ✅ **v1.0 MVP** - Phases 1-7 (shipped 2026-01-XX)
- ✅ **v1.1 Onboarding & Optimization** - Phases 8-13 (shipped 2026-03-06)
- 🚧 **v1.2 Profile Optimization & UI Enhancements** - Phases 14-19 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-7) - SHIPPED</summary>

Phases 1-7: auth, GBP OAuth, posts, reviews, reports, dashboard, deploy. All complete.

</details>

<details>
<summary>✅ v1.1 Onboarding & Optimization (Phases 8-13) - SHIPPED 2026-03-06</summary>

- Phase 8: Wizard Shell & Data Foundation (ONBRD-01, 02, 03)
- Phase 9: Keywords & Cities (KWRD-01, 02, 03, 04)
- Phase 10: Description Optimization (DESC-01, 02, 03)
- Phase 11: Service Optimization (SRVC-01, 02, 03, 04)
- Phase 12: Attributes & Profile Settings (ATTR-01, 02, 03, PROF-01, 02, ONBRD-04)
- Phase 13: Re-optimization (REOPT-01, 02)

</details>

### 🚧 v1.2 Profile Optimization & UI Enhancements (In Progress)

**Milestone Goal:** Upgrade the platform with optimization scoring, richer business cards, dashboard activity feeds, review analytics, and enhanced reporting — bringing parity with Paige by Merchynt's best UX patterns without manual work.

- [x] **Phase 14: Score Library & Dependencies** - Pure optimization score function, recharts/qrcode.react install, shadcn chart primitives, DB indexes (completed 2026-04-02)
- [x] **Phase 15: Business Cards View** - 4-column card grid with star rating, review count, address, optimization score badge, search (completed 2026-04-02)
- [x] **Phase 16: Dashboard Upgrades** - Recent automations feed, My Tasks table, business profile filter (completed 2026-04-02)
- [ ] **Phase 17: Profile Optimization Page** - Score gauge, per-signal audit cards, approve/ignore workflow, bulk actions
- [ ] **Phase 18: Review Metrics Dashboard** - Review trends, rating distribution chart, monthly volume chart, recency indicator
- [ ] **Phase 19: Reports Enhancement** - Date range controls, Views on Google chart, metric sparklines, completed actions log, AI narrative, PDF download

## Phase Details

### Phase 14: Score Library & Dependencies
**Goal**: The optimization score is a single, tested pure function that every UI surface imports without exception, and all chart/QR dependencies are installed and configured
**Depends on**: Phase 13 (v1.1 complete)
**Requirements**: None directly (foundational enabler for CARD-04, OPT-01, OPT-02, OPT-03, OPT-04)
**Success Criteria** (what must be TRUE):
  1. `src/lib/optimization-score.ts` exists with a pure function that accepts a profile-with-relations object and returns `{ total: number, grade: string, checks: Check[] }` with unit tests passing
  2. `recharts` and `qrcode.react` are installed and `npx shadcn@latest add chart` has been run — a test chart renders without hydration errors in `next build`
  3. Any missing composite DB indexes (`DailyMetric(profileId, date)`, `ProfileDescription(profileId, isApproved)`) have been added to `prisma/schema.prisma` and migrated
  4. Score thresholds are documented in code comments: green ≥70, amber 40-69, red <40
**Plans**: 2 plans
Plans:
- [x] 14-01-PLAN.md — TDD optimization score function with vitest setup
- [x] 14-02-PLAN.md — Install chart/QR deps, shadcn chart, Prisma index migration
**UI hint**: yes

### Phase 15: Business Cards View
**Goal**: Users can browse all business profiles as a visual card grid with at-a-glance health signals and search without navigating into each profile
**Depends on**: Phase 14
**Requirements**: CARD-01, CARD-02, CARD-03, CARD-04
**Success Criteria** (what must be TRUE):
  1. User can see all profiles as a 4-column card grid — each card shows business logo/icon, star rating, review count, business name, and address
  2. User can see a color-coded optimization score badge on each card (green/amber/red) computed from the Phase 14 score library
  3. User can type in a search bar to filter profiles by business name in real time
  4. User can click "Add a Business" on the profiles page and be taken to the onboarding flow
  5. Profile list queries use Prisma aggregations (`_avg`, `_count`) — no full review relation arrays fetched for list rendering
**Plans**: 1 plan
Plans:
- [x] 15-01-PLAN.md — Score badges, search filtering, query optimization
**UI hint**: yes

### Phase 16: Dashboard Upgrades
**Goal**: Users can quickly see what the platform did automatically and what needs their attention, filtered to any single business
**Depends on**: Phase 14
**Requirements**: DASH-01, DASH-02, DASH-03
**Success Criteria** (what must be TRUE):
  1. User can see a recent automations feed showing the last 20 automated actions (posts published, reviews responded, descriptions pushed) with timestamps and "See details" links
  2. User can see a My Tasks table showing pending items that need action — each row shows due date, business name, task type, and an action button
  3. User can select a specific business profile from the header dropdown and all dashboard widgets update to show only that profile's data
  4. Dashboard widgets load progressively (Suspense skeletons) and never block the entire page render on slow aggregation queries
**Plans**: 2 plans
Plans:
- [x] 16-01-PLAN.md — Sub-components, data functions, tests, TasksTable extension
- [x] 16-02-PLAN.md — Suspense shell refactor and end-to-end verification
**UI hint**: yes

### Phase 17: Profile Optimization Page
**Goal**: Users can see exactly how optimized each profile is, understand why, and approve or dismiss AI suggestions in one place
**Depends on**: Phase 14
**Requirements**: OPT-01, OPT-02, OPT-03, OPT-04
**Success Criteria** (what must be TRUE):
  1. User can navigate to `/dashboard/optimization/[profileId]/` and see a radial gauge showing the profile's optimization score (0-100%) computed from the Phase 14 score library
  2. User can see individual audit cards for each optimization signal — each card shows current value, benchmark, status (good/warning/critical), and a plain-English recommendation
  3. User can approve or ignore individual AI-generated description, services, and attribute suggestions directly on the optimization page
  4. User can bulk approve all pending suggestions or bulk ignore all pending suggestions, with a confirmation dialog before the action fires
  5. Optimization sidebar nav item exists and links to the page without producing a dead link before the page is built
**Plans**: 3 plans
Plans:
- [x] 17-01-PLAN.md — Utility functions with tests, navigation wiring (sidebar, badge links, index route)
- [x] 17-02-PLAN.md — Score gauge, audit cards grid, Suspense shell page
- [ ] 17-03-PLAN.md — Suggestions panel with approve/ignore and bulk actions
**UI hint**: yes

### Phase 18: Review Metrics Dashboard
**Goal**: Users can understand the review health of any profile — volume trends, rating breakdown, and how recently a review arrived — from a single dedicated page
**Depends on**: Phase 14
**Requirements**: RVMT-01, RVMT-02, RVMT-03, RVMT-04, RVMT-05
**Success Criteria** (what must be TRUE):
  1. User can see the total review count with a period-over-period trend badge showing % change (rolling 30-day window, not calendar month)
  2. User can see star rating distribution as a horizontal bar chart showing counts for 1 through 5 stars
  3. User can see monthly review volume as a line chart alongside average rating trend as a second line on the same chart, with the date range displayed
  4. User can see days since the last review with a status indicator (good/warning/critical) that prompts action when the profile has gone too long without a review
  5. Every chart carries a "Data through [last sync date]" label to communicate GBP metrics lag to users
**Plans**: TBD
**UI hint**: yes

### Phase 19: Reports Enhancement
**Goal**: Users can explore an interactive metrics dashboard with date controls, see all key GBP performance metrics with trend comparisons, view a log of platform actions, and download a polished PDF
**Depends on**: Phase 18
**Requirements**: RPT-01, RPT-02, RPT-03, RPT-04, RPT-05, RPT-06, RPT-07, RPT-08
**Success Criteria** (what must be TRUE):
  1. User can select a date range and see all report metrics recalculate for that period, with period-over-period comparison to the preceding equal-length period
  2. User can see Views on Google as a dual-line chart (Search vs Maps) with summary cards showing totals and % change
  3. User can see Phone Calls, Website Clicks, and Direction Requests each as a metric card with previous period comparison, % change badge, and a sparkline chart
  4. User can see a completed actions log listing all platform actions taken in the selected period (posts published, reviews responded, optimizations pushed)
  5. User can see a 3-sentence AI-generated executive summary narrative on the reports page
  6. User can click "Download PDF" and receive a PDF export of the current report view
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:** 14 → 15 → 16 → 17 → 18 → 19

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 14. Score Library & Dependencies | v1.2 | 2/2 | Complete    | 2026-04-02 |
| 15. Business Cards View | v1.2 | 1/1 | Complete    | 2026-04-02 |
| 16. Dashboard Upgrades | v1.2 | 2/2 | Complete    | 2026-04-02 |
| 17. Profile Optimization Page | v1.2 | 2/3 | In Progress|  |
| 18. Review Metrics Dashboard | v1.2 | 0/? | Not started | - |
| 19. Reports Enhancement | v1.2 | 0/? | Not started | - |
