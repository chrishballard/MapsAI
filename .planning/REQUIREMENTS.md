# Requirements: MapsAI

**Defined:** 2026-04-02
**Core Value:** Every client's GBP is fully managed end-to-end — from initial optimization through ongoing posts, reviews, and reporting — without manual work or expensive third-party tools.

## v1.2 Requirements

Requirements for Milestone v1.2: Profile Optimization & UI Enhancements.

### Profile Optimization (OPT)

- [ ] **OPT-01**: User can view an optimization score gauge (0-100%) for any business profile, computed from weighted signals (review frequency, post frequency, rating, images, description, services, attributes)
- [ ] **OPT-02**: User can see individual GBP audit cards per signal showing current value, benchmark, status (good/warning/critical), and recommendation
- [ ] **OPT-03**: User can approve or ignore AI-generated description, services, and attribute suggestions on the optimization page (reuses v1.1 re-optimization workflow)
- [ ] **OPT-04**: User can bulk approve or bulk ignore all pending suggestions with a confirmation dialog

### Dashboard (DASH)

- [x] **DASH-01**: User can see a recent automations feed on the dashboard showing last 20 automated actions (posts published, reviews responded, descriptions pushed) with timestamps and "See details" links
- [x] **DASH-02**: User can see a My Tasks table showing pending items needing action (approve posts, review responses, profiles needing onboarding) with due date, business, task type, and action button
- [x] **DASH-03**: User can filter all dashboard data by selecting a specific business profile from the header dropdown

### Business Cards (CARD)

- [x] **CARD-01**: User can view business profiles as a 4-column card grid with business logo/icon, star rating, review count, business name, and address
- [x] **CARD-02**: User can search profiles by name using a search bar on the profiles page
- [x] **CARD-03**: User can click "Add a Business" to navigate to the onboarding flow
- [x] **CARD-04**: User can see an optimization score badge on each business card (color-coded green/yellow/red)

### Review Metrics (RVMT)

- [ ] **RVMT-01**: User can see total review count with period-over-period trend badge (% change)
- [ ] **RVMT-02**: User can see star rating distribution as a horizontal bar chart (5 to 1 stars with counts)
- [ ] **RVMT-03**: User can see monthly review volume as a line chart with date range
- [ ] **RVMT-04**: User can see days since last review with status indicator (good/warning/critical)
- [ ] **RVMT-05**: User can see average rating trend over time as a second line on the monthly chart

### Reports (RPT)

- [ ] **RPT-01**: User can view a live interactive reports dashboard with date range selector and period-over-period comparison
- [ ] **RPT-02**: User can see Views on Google as a dual-line chart (Search vs Maps) with summary cards showing totals and % change
- [ ] **RPT-03**: User can see Phone Calls metric with last period vs this period comparison, % change badge, and sparkline chart
- [ ] **RPT-04**: User can see Website Clicks metric with last period vs this period comparison, % change badge, and sparkline chart
- [ ] **RPT-05**: User can see Direction Requests metric with last period vs this period comparison, % change badge, and sparkline chart
- [ ] **RPT-06**: User can see a completed actions log showing all actions taken in the selected period (posts published, reviews responded, optimizations pushed)
- [ ] **RPT-07**: User can see an AI-generated executive summary narrative (3-sentence month summary) on the reports page
- [ ] **RPT-08**: User can download the current report view as a PDF

## v1.3+ Requirements (Deferred)

### Competitor Analysis

- **COMP-01**: User can see a competitor comparison card on the reports page (requires Google Places API)

### Review Enhancements

- **RVMT-06**: User can see a QR code review request panel with shareable link per business
- **RVMT-07**: User can see AI-generated tips for getting more reviews based on current metrics
- **RVMT-08**: User can see review keyword analysis (which keywords appear in reviews vs target keywords)

### Dashboard Enhancements

- **DASH-04**: User can see a welcome banner with personalized greeting and onboarding prompt

### Optimization Enhancements

- **OPT-05**: User can see optimization score trend over time (requires historical snapshots)

### Report Automation

- **RPT-09**: User can schedule monthly reports for auto-delivery via email
- **RPT-10**: User can configure report recipients and BCC

## Out of Scope

| Feature | Reason |
|---------|--------|
| Google Maps thumbnails on business cards | Requires separate Static Maps API key setup; defer to v1.3 |
| Automated review request emails/SMS | Requires email/SMS infrastructure + compliance (CAN-SPAM, TCPA) |
| Real-time WebSocket dashboard updates | Over-engineering for internal tool; reload-on-visit is sufficient |
| Competitor tracking over time | Requires scheduling competitor data pulls + history storage |
| Auto-push all suggestions | Risky for 100-200 live client profiles; bulk approve with confirmation instead |
| Interactive map with pins | Heavy SDK for no additional value on a list page |
| Keyword ranking data in reports | Would require third-party rank tracking API (BrightLocal, SEMrush) |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| OPT-01 | Phase 17 | Pending |
| OPT-02 | Phase 17 | Pending |
| OPT-03 | Phase 17 | Pending |
| OPT-04 | Phase 17 | Pending |
| DASH-01 | Phase 16 | Complete |
| DASH-02 | Phase 16 | Complete |
| DASH-03 | Phase 16 | Complete |
| CARD-01 | Phase 15 | Complete |
| CARD-02 | Phase 15 | Complete |
| CARD-03 | Phase 15 | Complete |
| CARD-04 | Phase 15 | Complete |
| RVMT-01 | Phase 18 | Pending |
| RVMT-02 | Phase 18 | Pending |
| RVMT-03 | Phase 18 | Pending |
| RVMT-04 | Phase 18 | Pending |
| RVMT-05 | Phase 18 | Pending |
| RPT-01 | Phase 19 | Pending |
| RPT-02 | Phase 19 | Pending |
| RPT-03 | Phase 19 | Pending |
| RPT-04 | Phase 19 | Pending |
| RPT-05 | Phase 19 | Pending |
| RPT-06 | Phase 19 | Pending |
| RPT-07 | Phase 19 | Pending |
| RPT-08 | Phase 19 | Pending |

**Coverage:**
- v1.2 requirements: 24 total
- Mapped to phases: 24
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-02*
*Last updated: 2026-04-02 — traceability populated after roadmap creation*
