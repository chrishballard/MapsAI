# Feature Research: v1.2 Profile Optimization & UI Enhancements

**Domain:** GBP management platform — UI/analytics layer on top of existing management tooling
**Researched:** 2026-04-02
**Confidence:** HIGH (existing codebase fully understood; competitor patterns well-established)
**Builds on:** MapsAI v1.0 (posts, reviews, reports) + v1.1 (onboarding, optimization wizard)

---

## Overview

v1.2 adds five UI/analytics upgrades to an already-shipping platform. None of these features require new GBP API capabilities or new backend infrastructure — they are primarily data aggregation, visualization, and UX pattern improvements. The risk profile is LOW. The complexity is front-end and query complexity, not integration complexity.

---

## Feature 1: Profile Optimization Page

### What It Is

A per-profile page showing an optimization score (0-100 gauge), GBP audit cards (each scoring one signal), and AI-generated content suggestions with approve/ignore workflows.

### Table Stakes

Features users expect from any optimization tool. Missing these makes the page feel like a toy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Optimization score gauge (0-100) | Every GBP audit tool from HighLevel to Localo to Merchantynt shows a numeric score — users have been trained to expect one | MEDIUM | Computed from weighted factors: review frequency, post frequency, star rating, images uploaded, description present, services present, attributes set. Store as computed DB field or calculate on load. |
| Audit cards per signal | Breaking down the score makes it actionable — users need to know *why* the score is what it is, not just the number | MEDIUM | One card per signal: review frequency, post frequency, rating, image count, review keywords in responses, description quality. Each card: current value, benchmark, status (good/warning/critical), recommendation. |
| AI description suggestion with approve/ignore | Already built in v1.1 re-optimization — this is surfacing that same workflow on the new page | LOW | Re-use existing re-optimization API routes. Add "ignore" state to suppress repeated suggestions. |
| AI services suggestion with approve/ignore | Same as above — v1.1 built this | LOW | Same re-use pattern as description. |
| Attributes toggles | Already built in v1.1 — just surface here | LOW | Re-use existing attribute management UI as an embedded section. |
| Bulk approve action | Any approval workflow at scale needs bulk operations — reviewing 200 profiles one-at-a-time is not viable | MEDIUM | "Approve all suggestions" action. Confirm dialog showing what will be pushed. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Review keywords audit card | Paige/competitors don't surface this as a scored signal — checking whether review responses include target keywords is a concrete SEO improvement loop | MEDIUM | Compare profile keywords against recent AI-generated review responses. Flag profiles where responses aren't using keywords. Score component. |
| Score trend over time | Showing the score improving over time demonstrates value to the team managing Vineyard Growth clients | HIGH | Requires storing historical scores — snapshots in DB. Skip for MVP; add in v1.3. |
| Competitor audit comparison | Showing how the profile scores relative to nearby competitors on review count/frequency | HIGH | Requires competitor data via GBP API or external source. Out of scope for v1.2. |

### Anti-Features

| Anti-Feature | Why Avoid | Alternative |
|--------------|-----------|-------------|
| Auto-push all suggestions | Risky for 100-200 live client profiles — a bad AI generation pushed automatically could corrupt live GBP data | Bulk approve with explicit confirmation dialog showing what will change |
| Score breakdown that requires external data | Keyword volume, competitor ranking, citation consistency require third-party APIs and add cost | Keep all signals derivable from data already in the DB (reviews, posts, attributes, description fields) |
| Real-time score recalculation on every page load | Expensive query for 200 profiles | Calculate on profile sync completion and cache; expose "recalculate" button |

---

## Feature 2: Dashboard Upgrades

### What It Is

Four additions to the existing dashboard: (1) recent automations feed, (2) My Tasks table, (3) welcome banner, (4) business filter.

**Note:** The dashboard already has a `tasks-table.tsx` component and `getSelectedProfileId` filter logic. This milestone is enhancing what exists, not rebuilding.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Recent automations feed | Any automation platform needs an audit trail visible on the dashboard — users need to see what the system did without checking every individual resource | MEDIUM | Show last 10-20 automated actions: "Post published for [Business]", "Review responded to for [Business]", "Description pushed for [Business]". Source from existing Post/ReviewResponse/ProfileDescription tables filtered by `publishedAt` or `approvedAt`. |
| My Tasks table | The `tasks-table.tsx` already exists but likely needs refinement for v1.2 — surfacing pending posts, pending review responses, and profiles needing attention as actionable rows | LOW | Already partially built. Check what's implemented vs what the milestone spec calls for. Confirm the table already queries pending items correctly. |
| Business filter / profile selector | Managing 100-200 profiles without filtering is unusable — users need to focus on one business at a time | LOW | `getSelectedProfileId` already exists in the codebase. This is surfacing that filter as a prominent UI element (dropdown in header or top of dashboard). |
| Welcome banner | Orientation for new users; also a natural place for onboarding prompt ("3 profiles not yet onboarded") | LOW | Static or semi-dynamic banner. Low complexity. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Automations feed with profile-level drill-down | Clicking an automation event navigates to the relevant profile/post/review | LOW | Link each feed item to its source resource. Minimal extra work. |
| Dashboard summary stats scoped to selected profile | When a profile is selected via the business filter, all stat cards update to show that profile's data only | LOW | Already architected via `profileFilter` in existing dashboard queries. Just needs UI to surface the selection control. |

### Anti-Features

| Anti-Feature | Why Avoid | Alternative |
|--------------|-----------|-------------|
| Full activity log with search/filter | Dashboard is overview; full log is a separate concern | Keep feed to last 20 items; link to a future "Activity Log" page |
| Real-time WebSocket updates | Adds infra complexity (Pusher, Ably, or SSE) for marginal value on an internal tool | Reload-on-visit is fine; the team isn't watching the dashboard live |
| Notification system / email alerts | Out of scope for v1.2; the dashboard is pull not push | Defer to v1.3 |

---

## Feature 3: Business Cards View

### What It Is

Replace the current list/table view of the profiles page with a 4-column card grid. Each card shows: business logo, business name, star rating, review count, address, and a static Google Maps thumbnail.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| 4-column card grid layout | Any multi-location management tool (BrightLocal, LocalViking, Paige) uses a card grid for profile list — table rows feel generic and hard to scan for 50+ profiles | LOW | Tailwind grid layout. Cards already partially exist in the profiles page (`Card` component used). Replace list rows with cards. |
| Star rating display with numeric count | Review rating is the single most visible GBP metric — not showing it on the card is an omission users will notice | LOW | Rating and review count already fetched from `reviews` relation on Profile. Render stars (filled/half/empty) + "(N reviews)" |
| Business address display | Cards need enough info to identify the business at a glance — address distinguishes multi-location clients | LOW | Already in profile data. |
| Profile status badge | Users need to know at a glance if a profile is connected, onboarded, or has issues | LOW | `isConnected`, `isOnboarded` already on Profile model. Badge: "Active", "Needs Onboarding", "Disconnected". |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Google Maps thumbnail | Visual wayfinding — seeing the map pin location makes profiles immediately recognizable, especially for multi-location clients | MEDIUM | Use Google Static Maps API: `https://maps.googleapis.com/maps/api/staticmap?center={lat},{lng}&zoom=14&size=400x200&markers={lat},{lng}&key={key}`. Requires lat/lng on Profile (may need to add or geocode from address). API key already used in project. |
| Business logo | Branded cards look more professional and make profiles recognizable | LOW | GBP profiles have a logo media item. May need to store `logoUrl` on Profile after v1.1 logo upload. Or use a fallback icon. |
| Optimization score badge on card | Quick at-a-glance health indicator without navigating to the profile | LOW | Once optimization score is computed (Feature 1), add a small badge to each card: score with color coding (green/yellow/red). |
| Posts published this month on card | Shows activity level at a glance | LOW | Count from existing Post data. Small stat line on card. |

### Anti-Features

| Anti-Feature | Why Avoid | Alternative |
|--------------|-----------|-------------|
| Sortable/filterable grid with complex state | Adds client-side complexity for 100-200 profiles that can be managed with simple alphabetical ordering + search | Add a search input (client-side filter); defer advanced sorting to v1.3 |
| Animated map with interactive pins | Heavy (Mapbox/Google Maps JS SDK) for no additional value on a list page | Static thumbnail from Static Maps API is sufficient |
| Pagination | 200 cards load fine in a 4-column grid. Server pagination adds routing complexity. | Load all; add search/filter to narrow |

---

## Feature 4: Review Metrics Dashboard

### What It Is

A dedicated review analytics section showing: total reviews with trend, star rating distribution (5-bar chart), monthly review volume line chart, days since last review, QR code review request panel, and AI tips for getting more reviews.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Total reviews with trend | The most basic review stat — any review management tool shows this with a period-over-period trend | LOW | Count from existing Review table. Trend: compare this month vs last month count. |
| Star rating distribution | Users expect to see the breakdown of 1-star through 5-star — it reveals whether there are suppressed negative reviews or a skewed profile | LOW | GROUP BY rating query on Review table. Bar chart (could be simple CSS bars or recharts). |
| Monthly reviews line chart | Shows review velocity over time — Google's algorithm weights recent reviews more heavily, making this the most important review metric for local SEO | MEDIUM | GROUP BY month query. recharts LineChart. Date range selector. |
| Days since last review | Review recency is a Google ranking signal — surfacing this prominently prompts action | LOW | MAX(createdAt) from reviews for profile. Show "3 days ago" or "47 days — action needed". |
| Review request panel with QR code | Paige specifically advertises QR code review request as a feature — users expect a mechanism to drive new reviews | MEDIUM | Generate review link from GBP `place_id`. QR code from `qrcode` npm package (tiny, no server required). Display download button. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| AI tips for getting more reviews | Actionable, context-aware suggestions — "Your last review was 47 days ago. Consider sending a follow-up email to recent customers." — is more valuable than generic advice | MEDIUM | Claude prompt taking current review metrics → generate 2-3 specific actionable tips. Cache per profile per week to control AI cost. |
| Review keyword analysis | Showing which keywords appear most in reviews (customer language) vs. whether those match target keywords | HIGH | NLP/counting on review text. Useful but complex. Defer to v1.3. |
| Rating trend line (separate from volume) | Showing whether average rating is improving over time | MEDIUM | Monthly average query. Add as second line on the monthly chart (dual-line). |

### Anti-Features

| Anti-Feature | Why Avoid | Alternative |
|--------------|-----------|-------------|
| Automated review request emails/SMS | Requires email/SMS infrastructure (Postmark, Twilio), compliance concerns (CAN-SPAM, TCPA), and Google ToS review for solicitation patterns | Show QR code + copy-link — team sends manually. Defer automation. |
| Sentiment analysis with ML | Over-engineering for a tool that already surfaces review text. Star rating IS the sentiment. | Show rating distribution + review text; team reads context |
| Response rate metric | Only meaningful if you have a baseline; and the tool auto-responds via BullMQ — response rate will always be high | Don't surface metrics that look bad and can't be actioned |

---

## Feature 5: Reports Enhancement

### What It Is

Four additions to the existing PDF report generator: (1) competitor comparison card, (2) Views on Google dual-line chart (Search vs Maps), (3) website clicks sparkline, (4) completed actions log. Plus date range controls for the report.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Date range controls | Any reporting tool must allow the user to set the period being reported | LOW | Date range picker UI. Pass range to existing report generation API. |
| Website clicks chart | Website clicks from GBP are a primary conversion metric — any agency reporting tool tracks this | MEDIUM | Already synced via GBP Insights API into existing `GBPMetric` or similar model. Surface as sparkline in existing report. Verify field names in Prisma schema. |
| Views on Google dual-line chart (Search vs Maps) | Google provides separate views for Search and Maps — showing both lines demonstrates total visibility, which is a key metric agencies report on | MEDIUM | Two data series from existing metrics: `businessImpressionsDesktopSearch` + `businessImpressionsMobileSearch` (one line) vs `businessImpressionsDesktopMaps` + `businessImpressionsMobileMaps` (other line). Already available in GBP Insights API response. |
| Completed actions log | Demonstrates the value of the service — "Here are the 47 actions we took this month" is the agency's proof of work | LOW | Query posts published, reviews responded to, optimizations pushed in the date range. Render as a table in the PDF. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Competitor comparison card | Shows the profile's review count and rating vs. top 2-3 local competitors — powerful for justifying ongoing management fees | HIGH | Requires competitor data. GBP API does not expose competitor data. Would need Google Places API calls (Places Nearby Search or Text Search for category+location). Quota implications. Flag as HIGH complexity. |
| Report scheduling / auto-delivery | Monthly reports sent automatically reduce manual work for agency team | HIGH | Requires email integration. Defer to v1.3. |
| Executive summary AI narrative | A 3-sentence Claude-generated summary of the month: "Your profile received X views, Y calls, and Z new reviews this month. Post frequency was maintained at 4/week. Rating improved from 4.2 to 4.6." | LOW | Claude prompt with metric data. Cheap (one small call per report). High perceived value. |

### Anti-Features

| Anti-Feature | Why Avoid | Alternative |
|--------------|-----------|-------------|
| Interactive web-based reports | PDF is already working and serves the use case (send to client or print) — interactive reports require a separate UI surface and auth model | Keep PDF; add date range controls to existing PDF generator |
| Keyword ranking data in reports | Would require rank tracking API (BrightLocal, SEMrush) — adds cost and dependency | GBP Insights metrics (views, clicks, calls) are sufficient for the report |
| Competitor tracking over time | Requires scheduling competitor data pulls, storing competitor history — significant infra for marginal value | One-time competitor snapshot on the report; no history tracking |

---

## Feature Dependencies

```
Feature 1 (Profile Optimization Page)
    ├──requires──> Optimization score computed (new DB field or computed query)
    ├──reuses──> Re-optimization API routes (v1.1, already built)
    ├──reuses──> Attribute management UI (v1.1, already built)
    └──feeds into──> Feature 3 (Business Cards View) — score badge on card

Feature 2 (Dashboard Upgrades)
    ├──reuses──> getSelectedProfileId (already built)
    ├──reuses──> TasksTable component (already built, tasks-table.tsx)
    └──independent of Features 1, 3, 4, 5

Feature 3 (Business Cards View)
    ├──reuses──> Profile data with reviews (already fetched)
    ├──requires──> Google Static Maps API key (already in project for GBP auth)
    └──enhanced by──> Feature 1 score badge (nice-to-have, not blocking)

Feature 4 (Review Metrics Dashboard)
    ├──reuses──> Review data (already in DB from review sync)
    ├──requires──> QR code library (qrcode npm, new small dep)
    └──feeds into──> Feature 5 (completed actions log includes review responses)

Feature 5 (Reports Enhancement)
    ├──reuses──> Existing PDF generator (@react-pdf/renderer, already built)
    ├──reuses──> GBPMetric data (already synced for existing reports)
    ├──requires──> Date range controls (new UI, simple)
    └──competitor card──requires──> Google Places API calls (HIGH complexity, HIGH risk)
```

### Dependency Notes

- **Feature 1 score badge → Feature 3 cards:** Score badge is additive to cards. Cards can ship without it. No blocking dependency.
- **Feature 5 competitor card:** This is the only feature with a non-trivial external dependency (Google Places API for competitor data). It should be evaluated separately — potentially deferred.
- **Feature 2 is fully independent:** Dashboard upgrades don't depend on any other v1.2 feature. Can be built first or last.
- **Review data freshness:** Features 1 and 4 depend on review data being current. The existing review sync worker handles this.

---

## MVP Definition

### Launch With (v1.2 Core)

These features deliver the highest visible value per complexity unit.

- [x] **Business Cards View** — replaces existing list; purely front-end; zero API changes; high visual impact. Easiest win.
- [x] **Dashboard Upgrades: automations feed + business filter polish** — reuses existing data and components; makes the home screen feel alive.
- [x] **Profile Optimization Page: score gauge + audit cards** — the single feature that most distinguishes a "management tool" from a "management platform". Core to the Paige replacement goal.
- [x] **Review Metrics Dashboard: total/trend + rating distribution + monthly chart + QR code** — table stakes for review management. QR code is a differentiator that Paige advertises.
- [x] **Reports Enhancement: Views dual-line chart + website clicks + completed actions log + date range** — strengthens existing reporting without adding complexity.

### Add After Validation (v1.2 Stretch)

Features to add if core ships with time remaining.

- [ ] **Optimization page: bulk approve action** — valuable but adds confirmation flow complexity. Add after core approve/ignore works.
- [ ] **Reports: AI executive summary narrative** — low effort, high perceived value. Add as last step if time allows.
- [ ] **Dashboard: welcome banner with onboarding prompt** — nice UX touch, low priority.

### Future Consideration (v1.3+)

Features to defer until v1.2 is shipped and validated.

- [ ] **Reports: competitor comparison card** — HIGH complexity due to Google Places API dependency, quota risks, and data storage requirements.
- [ ] **Optimization score trend over time** — requires historical score snapshots; adds schema complexity.
- [ ] **Review keyword analysis** — NLP complexity, unclear ROI.
- [ ] **Automated review request emails/SMS** — requires email infra + compliance research.
- [ ] **Report scheduling/auto-delivery** — requires email integration.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Business Cards View | HIGH | LOW | P1 |
| Dashboard: Business filter polish + automations feed | HIGH | LOW | P1 |
| Profile Optimization: Score gauge + audit cards | HIGH | MEDIUM | P1 |
| Review Metrics: Total/trend + distribution + monthly chart | HIGH | MEDIUM | P1 |
| Review Metrics: QR code panel | MEDIUM | MEDIUM | P1 |
| Reports: Views dual-line + website clicks sparkline | MEDIUM | LOW | P1 |
| Reports: Completed actions log | MEDIUM | LOW | P1 |
| Reports: Date range controls | MEDIUM | LOW | P1 |
| Profile Optimization: Approve/ignore suggestions (reuse v1.1) | HIGH | LOW | P1 |
| Profile Optimization: Bulk approve | MEDIUM | MEDIUM | P2 |
| Reports: AI executive summary | MEDIUM | LOW | P2 |
| Dashboard: Welcome banner | LOW | LOW | P2 |
| Reports: Competitor comparison card | MEDIUM | HIGH | P3 |
| Optimization score trend over time | LOW | HIGH | P3 |
| Review keyword analysis | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v1.2 launch
- P2: Should have, add if time allows within v1.2
- P3: Defer to v1.3+

---

## Competitor Feature Analysis

| Feature | Paige (Merchynt) | BrightLocal | HighLevel | Our Approach |
|---------|-----------------|-------------|-----------|--------------|
| Optimization score | Yes — "GBP audit" + score | Yes — profile audit tool | Yes — completeness score with alerts | Computed from DB data; weighted 0-100 gauge |
| Audit cards with signals | Yes | Yes — 25+ criteria | Alert icons + tooltips | Cards per signal: review frequency, post frequency, rating, images, description, attributes |
| Review analytics dashboard | Basic review count/rating | Full review reporting tab | Via Reputation tab | Per-profile: total, distribution, monthly chart, recency |
| QR code review requests | Yes — advertised prominently | No (uses separate tools) | Via Reputation | Generate from GBP place_id; `qrcode` npm package |
| Business card grid | No (list-based) | Card grid style | Card grid style | 4-column grid with logo, rating, map thumbnail |
| Google Maps thumbnails on cards | No | No | No | Static Maps API — differentiator |
| Dashboard automations feed | Weekly progress emails | No | Activity log | Real-time feed of last 20 automated actions |
| Reports: Views on Search vs Maps | Via GBP Insights embed | Separate chart | No | Dual-line chart in PDF report |
| Reports: Competitor card | Basic competitor citations | Competitor rank comparison | No | Google Places API lookup — v1.3 |
| Reports: Completed actions log | Yes — "all completed actions" feature | No | No | Query posts/reviews/optimizations in date range |
| AI description/services suggestions | Yes — full optimization | No (audit only) | No | Reuse v1.1 re-optimization workflow |

---

## Complexity Summary by Feature

| Feature | Overall Complexity | Primary Complexity Driver |
|---------|-------------------|--------------------------|
| Business Cards View | LOW | CSS/layout only; data already fetched |
| Dashboard Upgrades | LOW-MEDIUM | Automations feed query; existing components reused |
| Profile Optimization Page (score + cards) | MEDIUM | Score computation logic; audit signal definitions |
| Profile Optimization Page (suggestions workflow) | LOW | Reuses v1.1 API routes entirely |
| Review Metrics Dashboard | MEDIUM | recharts integration; QR code generation |
| Reports: Views/clicks charts | LOW-MEDIUM | Data already in DB; recharts in PDF context |
| Reports: Actions log | LOW | Query + table in existing PDF template |
| Reports: Date range controls | LOW | UI only; pass params to existing generator |
| Reports: Competitor card | HIGH | External API, quota, data storage |

---

## Sources

- [Paige by Merchynt — feature overview](https://www.merchynt.com/paige) (MEDIUM confidence — marketing page)
- [HighLevel GBP Optimization Tool — score and alerts](https://help.gohighlevel.com/support/solutions/articles/155000005837-easily-optimize-your-google-business-profile-in-highlevel) (HIGH confidence — official docs)
- [AgencyAnalytics — Top 8 GBP Metrics to Track in 2026](https://agencyanalytics.com/blog/google-business-profile-metrics) (HIGH confidence)
- [AgencyAnalytics — GBP Insights guide](https://agencyanalytics.com/blog/google-business-profile-insights) (HIGH confidence)
- [EmbedSocial — 22 Best GBP Management Tools 2026](https://embedsocial.com/blog/best-google-business-profile-management-tools/) (MEDIUM confidence)
- [Localo GBP Audit Tool](https://localo.com/local-seo-tool/gmb-audit-tool) (MEDIUM confidence)
- [Spokk GBP Audit Tool with AI Insights](https://www.spokk.io/tools/google-business-profile-audit) (MEDIUM confidence)
- [EmbedMyReviews — QR Codes for Google Reviews](https://www.embedmyreviews.com/features/qr-codes/) (MEDIUM confidence)
- [GMBMantra — Review Link & QR Generator](https://gmbmantra.ai/review-link-qr-generator) (MEDIUM confidence)
- [Search Engine Land — 5-step GBP audit](https://searchengineland.com/google-business-profile-audit-local-rankings-472990) (HIGH confidence)
- [Sterling Sky — Interpreting GBP Performance Metrics](https://www.sterlingsky.ca/interpret-google-business-profile-performance/) (HIGH confidence)
- Existing MapsAI codebase (v1.0 + v1.1) — confirmed shipped features (HIGH confidence)

---

*Feature research for: GBP management platform — v1.2 Profile Optimization & UI Enhancements*
*Researched: 2026-04-02*
