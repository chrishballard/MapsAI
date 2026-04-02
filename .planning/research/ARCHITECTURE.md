# Architecture Research

**Domain:** Next.js App Router — Adding 5 UI features to existing GBP management platform (v1.2)
**Researched:** 2026-04-02
**Confidence:** HIGH — based on direct codebase inspection of 129 TypeScript files

---

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (Next.js RSC + Client)            │
├────────────────┬────────────────┬───────────────────────────┤
│  /dashboard    │ /dashboard/    │  /dashboard/              │
│  (page.tsx)    │ profiles/      │  reviews/  reports/       │
│  MODIFY        │ (page + [id])  │  (pages)                  │
│                │ MODIFY         │  MODIFY                   │
├────────────────┴────────────────┴───────────────────────────┤
│                   NEW PAGES (v1.2)                           │
│  /dashboard/optimization/[profileId]/page.tsx                │
│  /dashboard/reviews/metrics/[profileId]/page.tsx             │
├─────────────────────────────────────────────────────────────┤
│        Layout: Sidebar (MODIFY) + Topbar (unchanged)         │
└─────────────────────────────────────────────────────────────┘
                         ↕ fetch / RSC direct
┌─────────────────────────────────────────────────────────────┐
│                    API Routes (/src/app/api/)                 │
│                                                              │
│  EXISTING (used, unchanged)        NEW (v1.2)                │
│  /api/profiles                     /api/profiles/[id]/score  │
│  /api/reviews (sync, approve)      /api/reviews/metrics      │
│  /api/reports/generate             /api/reviews/qr-code      │
│  /api/metrics/sync                 (PDF: extend existing)    │
└─────────────────────────────────────────────────────────────┘
                         ↕ Prisma
┌─────────────────────────────────────────────────────────────┐
│                   PostgreSQL (Prisma ORM)                     │
│                                                              │
│  ALL EXISTING MODELS — no new models needed for v1.2:        │
│  Profile, Review, Post, DailyMetric, MonthlyKeyword, Report  │
│  ProfileKeyword, ProfileCity, ProfileDescription             │
│  ProfileService, OnboardingProgress, ReviewResponse          │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component | Responsibility | v1.2 Status |
|-----------|----------------|-------------|
| `/dashboard/page.tsx` | Stats grid, automations feed, tasks table | Modify: welcome banner, extend automations for optimization pushes |
| `/dashboard/profiles/page.tsx` | Business card grid | Modify: richer cards (ratings, post count, optimization badge, map thumbnail) |
| `/dashboard/profiles/[id]/page.tsx` | Profile detail, metrics, re-optimize | Modify: optimization score widget, link to new optimization page |
| `/dashboard/reviews/page.tsx` | Review list with filters, bulk approve | No change — add "View Metrics" button to header only |
| `/dashboard/reviews/metrics/[profileId]/page.tsx` | Review trends, rating distribution, QR code | New page |
| `/dashboard/optimization/[profileId]/page.tsx` | Score gauge, audit cards, approve/ignore workflow | New page |
| `/dashboard/reports/page.tsx` | Report list + generate form | Modify: website clicks chart, completed actions log, competitor card |
| `src/components/sidebar.tsx` | Navigation | Modify: add Optimization nav item |

---

## Recommended Project Structure (New Files Only)

```
src/
├── app/
│   └── dashboard/
│       ├── optimization/
│       │   └── [profileId]/
│       │       ├── page.tsx                    # RSC: fetch profile + compute score
│       │       └── optimization-actions.tsx    # Client: approve/ignore action buttons
│       └── reviews/
│           └── metrics/
│               └── [profileId]/
│                   ├── page.tsx                # RSC: fetch review aggregations
│                   └── qr-code-section.tsx     # Client: renders QR code on demand
├── app/
│   └── api/
│       ├── profiles/
│       │   └── [id]/
│       │       └── score/
│       │           └── route.ts               # GET: compute + return optimization score
│       └── reviews/
│           ├── metrics/
│           │   └── route.ts                   # GET: rating distribution + monthly trend
│           └── qr-code/
│               └── route.ts                   # GET: return review request URL
└── components/
    ├── optimization/
    │   ├── score-gauge.tsx                    # Client: SVG arc gauge
    │   ├── audit-card.tsx                     # Client: individual audit check card
    │   └── audit-grid.tsx                     # Client: grid of audit cards
    └── reviews/
        ├── rating-distribution.tsx             # Client: horizontal bar chart (1-5 stars)
        └── review-trend-chart.tsx              # Client: line chart (reviews over time)
```

Plus one new lib file:
```
src/lib/optimization-score.ts    # Pure function: ProfileWithRelations → OptimizationScore
```

### Structure Rationale

- **`/dashboard/optimization/[profileId]/`** — Profile-scoped route mirrors the v1.1 pattern for `/dashboard/onboarding/[profileId]/`. Score is per-profile.
- **`/dashboard/reviews/metrics/[profileId]/`** — Under reviews/ because it is a sub-view of review data. Scoped to profile because trends are per-business.
- **`/api/profiles/[id]/score/`** — The `[id]` directory already exists (contains `offboard/route.ts`) so this is a natural sibling route.
- **`/components/optimization/` and `/components/reviews/`** — Feature-namespaced folders, consistent with existing `/components/onboarding/`.

---

## Architectural Patterns

### Pattern 1: Server Component with Client Islands

**What:** Each new page is an async RSC that performs all data fetching and computation server-side. Small client components handle interactivity (button handlers, chart animations, QR code rendering).
**When to use:** All five new features follow this pattern. The heavy Prisma aggregations stay server-side — only interactivity needs `"use client"`.
**Trade-offs:** Fast initial load, no client-side fetch spinners, no skeleton states for data. Mutations use fetch calls to API routes from within client islands.

**Example (Optimization Page):**
```typescript
// /dashboard/optimization/[profileId]/page.tsx (RSC)
export default async function OptimizationPage({ params }) {
  const { profileId } = await params;
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    include: { keywords: true, cities: true, descriptions: true,
               services: true, onboardingProgress: true,
               _count: { select: { posts: true } } },
  });
  const score = computeOptimizationScore(profile); // pure function, no await
  return (
    <>
      <ScoreGauge score={score.total} />        {/* client component */}
      <AuditGrid checks={score.checks} profileId={profileId} />  {/* client */}
    </>
  );
}
```

### Pattern 2: Prisma Aggregation Directly in RSC (No API Route Needed)

**What:** For read-only display features, run Prisma queries directly in the RSC page component rather than creating a dedicated API route.
**When to use:** Dashboard upgrades (welcome banner, extended automations), business cards enrichment, reports website clicks chart, completed actions log. None of these need client-side re-fetching.
**Trade-offs:** Fewer files. Filtering/sorting requires URL search param changes and a page reload — acceptable for an internal tool.

**Example (Business Cards enrichment):**
```typescript
// /dashboard/profiles/page.tsx — extend existing query
const profiles = await prisma.profile.findMany({
  where: { isConnected: true, isOnboarded: true },
  include: {
    reviews: { select: { rating: true } },
    _count: { select: { posts: true } },          // NEW
    keywords: { select: { keyword: true }, take: 3 }, // NEW
    descriptions: { where: { isPushed: true }, take: 1 }, // NEW (for score badge)
  },
  orderBy: { name: "asc" },
});
```

### Pattern 3: Derived Score as Pure Function Over Existing Data

**What:** The optimization score is computed as a pure TypeScript function from data already in the database. No new GBP API calls, no new Prisma models required.
**When to use:** Score computation in `/src/lib/optimization-score.ts`, used by both the optimization page and as an inline badge on profile cards.
**Trade-offs:** Score reflects the Prisma database state, not the live GBP state. Acceptable — all optimization writes go through the app, so DB state is authoritative.

**Recommended 100-point formula:**
```typescript
// src/lib/optimization-score.ts
export interface OptimizationCheck {
  id: string;
  label: string;
  weight: number;
  pass: boolean;
  cta?: string; // What action fixes this
}

export interface OptimizationScore {
  total: number;    // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  checks: OptimizationCheck[];
}

export function computeOptimizationScore(profile: ProfileWithRelations): OptimizationScore {
  const checks: OptimizationCheck[] = [
    {
      id: 'description',
      label: 'SEO Description published',
      weight: 25,
      pass: profile.descriptions.some(d => d.isPushed),
      cta: 'Push your AI description to Google',
    },
    {
      id: 'services',
      label: 'Services optimized',
      weight: 20,
      pass: profile.services.some(s => s.isPushed),
      cta: 'Approve and push your service descriptions',
    },
    {
      id: 'keywords',
      label: 'Target keywords set',
      weight: 15,
      pass: profile.keywords.length >= 3,
      cta: 'Add at least 3 target keywords in Onboarding',
    },
    {
      id: 'attributes',
      label: 'Attributes configured',
      weight: 15,
      pass: profile.onboardingProgress?.completedSteps.includes(4) ?? false,
      cta: 'Complete the Attributes step in Onboarding',
    },
    {
      id: 'posts_active',
      label: 'Active post schedule',
      weight: 10,
      pass: (profile._count?.posts ?? 0) > 0,
      cta: 'Generate and publish your first post',
    },
    {
      id: 'cities',
      label: 'Target cities defined',
      weight: 10,
      pass: profile.cities.length >= 1,
      cta: 'Add target cities in Onboarding',
    },
    {
      id: 'reviews_responded',
      label: 'Reviews responded to',
      weight: 5,
      pass: false, // computed from review data passed in separately
    },
  ];
  const total = checks.reduce((sum, c) => sum + (c.pass ? c.weight : 0), 0);
  const grade = total >= 90 ? 'A' : total >= 75 ? 'B' : total >= 60 ? 'C' : total >= 45 ? 'D' : 'F';
  return { total, grade, checks };
}
```

### Pattern 4: URL Search Params for Filter State

**What:** All filtering (business selector, date range, rating filter) is driven by URL search params, not React state.
**When to use:** Dashboard business filter, review metrics date range, reports month filter. This is the pattern already used in the reviews page (`?profileId=&rating=&responseStatus=`).
**Trade-offs:** Shareable URLs, back-button works, no hydration issues. Requires `router.push` or a `<form>` for updates. The existing `getSelectedProfileId()` cookie mechanism already provides global profile selection.

---

## Data Flow

### Optimization Score Flow

```
GET /dashboard/optimization/[profileId]
    ↓ prisma.profile.findUnique (includes all optimization relations)
    ↓ computeOptimizationScore(profile)  [pure function, <1ms]
    ↓ result: { total: 72, grade: 'B', checks: [...] }
    ↓ RSC renders:
<ScoreGauge score={72} grade="B" />         [client, SVG arc animation]
<AuditGrid checks={checks} />               [client, maps to AuditCard items]
  → each AuditCard shows pass/fail + CTA button
  → CTA links to onboarding step OR triggers re-optimization API
```

### Review Metrics Flow

```
GET /dashboard/reviews/metrics/[profileId]
    ↓ parallel Prisma queries:
    prisma.review.groupBy({ by: ['rating'], _count: true })
        → rating distribution [{ rating: 5, _count: 42 }, ...]
    prisma.review.findMany({ orderBy: reviewDate, select: { reviewDate, rating } })
        → all reviews for trend bucketing (group by month in JS)
    prisma.profile.findUnique({ select: { placeId, name } })
        → for QR code URL construction
    ↓ RSC renders:
<RatingDistribution data={distribution} />  [client, horizontal bars]
<ReviewTrendChart data={monthlyTrend} />     [client, recharts LineChart]
<QRCodeSection placeId={placeId} />          [client, qrcode.react]
```

### Dashboard Activity Feed Extension

```
/dashboard/page.tsx (RSC — extend existing Promise.all block)
    Current queries:
        recentPublishedPosts, recentPublishedResponses
    NEW additions:
        prisma.profileDescription.findMany({
          where: { isPushed: true, ...profileFilter },
          take: 3, orderBy: { pushedAt: desc },
          include: { profile: { select: { name: true } } }
        })
        prisma.profileService.findMany({
          where: { isPushed: true, ...profileFilter },
          take: 3, orderBy: { pushedAt: desc },
          include: { profile: { select: { name: true } } }
        })
    → Merge into automations[] with type: 'optimization_push'
    → Welcome banner: conditional block using session.user.name (already in session)
```

### Business Cards Upgrade Flow

```
/dashboard/profiles/page.tsx (RSC — extend existing include)
    Current: { reviews: true, googleAccount: true }
    Extended: {
      reviews: { select: { rating: true } },
      _count: { select: { posts: true } },
      keywords: { select: { keyword: true }, take: 3 },
      descriptions: { where: { isPushed: true }, take: 1 },
    }
    ↓ card render:
<ProfileCard>
  <LogoPlaceholder />     // styled initials avatar (no logo API needed)
  <MapThumbnail />        // <img src="maps.googleapis.com/staticmap?..."> if placeId
  <RatingBadge />         // already computed from reviews[]
  <OptimizationBadge />   // inline computeOptimizationScore(profile).total
  <PostCountBadge />      // profile._count.posts
</ProfileCard>
```

### Reports Enhancement Flow

```
/dashboard/reports/page.tsx (RSC — extend existing queries)
    Current: prisma.report.findMany, prisma.profile.findMany
    NEW additions:
        prisma.dailyMetric.findMany({
          where: { profileId: selectedProfileId, date: { gte: last30days } },
          orderBy: { date: 'asc' }, select: { date: true, websiteClicks: true }
        })
        prisma.post.findMany({
          where: { status: 'PUBLISHED', publishedAt: { gte: last30days }, ...profileFilter },
          orderBy: { publishedAt: 'desc' }, take: 20,
          include: { profile: { select: { name: true } } }
        })
        prisma.profileDescription.findMany({
          where: { isPushed: true, ...profileFilter },
          orderBy: { pushedAt: 'desc' }, take: 10
        })
    ↓ renders:
<WebsiteClicksChart data={dailyClicks} />        [client, recharts LineChart]
<CompletedActionsLog posts={...} descs={...} />  [client or static RSC table]
<CompetitorCard />                               [static "Coming soon" placeholder]
```

---

## New API Endpoints

| Endpoint | Method | Query Params | Purpose | Notes |
|----------|--------|--------------|---------|-------|
| `/api/profiles/[id]/score` | GET | — | Return optimization score + checks | Used when client components need to re-fetch score after actions |
| `/api/reviews/metrics` | GET | `?profileId=` | Rating distribution + monthly trend aggregation | Callable from client if needed for date range filtering |
| `/api/reviews/qr-code` | GET | `?profileId=` | Return review request URL from `Profile.placeId` | Generates `https://search.google.com/local/writereview?placeid={id}` |

**Most v1.2 features require NO new API routes** — they extend existing RSC page queries. New API routes are only needed for endpoints that client components re-call after page load (e.g., re-scoring after approve action).

---

## Integration Points with Existing Pages

### `/dashboard/page.tsx` — Dashboard Upgrades

**Existing queries touched:** `Promise.all` block at top of component. Add 2 new queries (description pushes, service pushes) to the parallel fetch array.

**Welcome banner:** Rendered as a conditional block above the stats grid when `totalProfiles === 0 && !selectedProfileId`. References `session.user.name` available via `getServerSession(authOptions)` already called in layout.

**Business filter bar:** The `getSelectedProfileId()` cookie mechanism already powers per-profile filtering throughout the dashboard. The filter bar is a `"use client"` component that sets/clears the cookie via a new `/api/profiles/select` route (or reuse the existing mechanism). Renders as pill buttons, one per profile.

### `/dashboard/profiles/page.tsx` — Business Cards

**Current query:** `prisma.profile.findMany({ include: { googleAccount: true, reviews: true } })`.

**Problem:** Loading all review rows for avgRating computation is wasteful at 200 profiles. Replace `reviews: true` with `_count: { select: { reviews: true } }` and a separate `prisma.review.groupBy` for rating computation, OR compute avgRating with a raw `prisma.$queryRaw` aggregate. The simplest fix is `include: { reviews: { select: { rating: true } } }` (already fetching only `rating` column — acceptable at scale).

**Map thumbnail:** `<img src={googleStaticMapsUrl} />` requires `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. If `profile.placeId` is null, render a styled placeholder with the MapPin icon already imported. This is purely additive — no query change needed.

### `/dashboard/profiles/[id]/page.tsx` — Profile Detail

**Current:** Fetches all profile relations, renders stats grid, posts/reviews/metrics sections, re-optimize section.

**v1.2 addition:** Add an optimization score row above the stats grid. The profile with all optimization relations is already fetched — pass it to `computeOptimizationScore()` inline. Add a "View Optimization" link button pointing to `/dashboard/optimization/${id}`.

**No new Prisma query needed** — the page already fetches `onboardingProgress`, which is one of the score inputs.

### `/dashboard/reviews/page.tsx` — Reviews List

**No structural changes.** Add a "View Metrics" button to the page header, linking to `/dashboard/reviews/metrics/[profileId]`. If no profile is selected, the button is hidden (metrics are per-profile).

### `/dashboard/reports/page.tsx` — Reports Enhancement

**Current queries:** `prisma.report.findMany` + `prisma.profile.findMany`.

**New additions:** 3 new Prisma queries added to a second `Promise.all` block (separate from the report list query to avoid blocking it). Only runs when `selectedProfileId` is set — these charts are per-profile.

**PDF generator:** The `src/lib/pdf/report-generator.ts` and `report-template.tsx` may be extended to add the new data sections (website clicks over time, completed actions). This is optional for v1.2 — the web UI enhancements and PDF enhancements are separable. PDF changes carry higher risk (generated files).

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (100-200 profiles) | Direct Prisma queries in RSC are fine. Score computed in <5ms. Business cards page is the only query to watch: includes reviews for all profiles. |
| 1k profiles | Cache optimization scores with 1-hour Redis TTL. Invalidate on profile mutation. Business cards: paginate to 50 per page. |
| 10k profiles | Materialized view for optimization scores. Paginate business cards. Consider dedicated analytics service for metrics aggregation. |

**Immediate concern for v1.2:** The current `/dashboard/profiles/page.tsx` fetches `include: { reviews: true }` for all profiles. At 200 profiles × 50 reviews avg = 10,000 rows per page load. The fix is to use `reviews: { select: { rating: true } }` (already in place — only the `rating` field is loaded, which is minimal). At 200 profiles this is fine; add pagination if profiles exceed 500.

---

## Anti-Patterns

### Anti-Pattern 1: New Prisma Models for Derived Data

**What people do:** Create an `OptimizationScore` model to persist the computed score.
**Why it's wrong:** Score is a pure derivation of 6 existing models. Persisting it creates a sync problem — the score goes stale whenever `ProfileDescription`, `ProfileService`, `ProfileKeyword`, `ProfileCity`, or `OnboardingProgress` changes.
**Do this instead:** Compute score in a pure TypeScript function from a single joined Prisma query. At 200 profiles, this is <10ms per page load. Only cache in Redis if profiling proves it necessary.

### Anti-Pattern 2: Client-Side Fetching for Charts

**What people do:** Fetch chart data in a `useEffect`, show skeleton → spinner → chart.
**Why it's wrong:** All chart data (DailyMetric, Review history) lives in PostgreSQL and is accessible server-side. The RSC pattern makes spinners unnecessary for initial page load.
**Do this instead:** Query in RSC, serialize to a typed array prop, pass to a `"use client"` chart component that only renders the data it receives. Only the Recharts component itself needs to be a client component.

### Anti-Pattern 3: GBP API Calls for Score Computation

**What people do:** Fetch live GBP profile data to check description length, service count, etc., as part of the optimization audit.
**Why it's wrong:** GBP API is rate-limited, slow (network call), and the data is already mirrored in the database from v1.1 onboarding writes.
**Do this instead:** Compute entirely from Prisma DB state. The data is authoritative — all optimization writes go through the app.

### Anti-Pattern 4: Server-Side QR Code Generation

**What people do:** Create a Next.js API route that generates QR codes as PNG buffers.
**Why it's wrong:** QR codes are deterministic per profile (based on the static `placeId`). Generating server-side adds latency, an API round-trip, and a file buffer for data that could be rendered in the browser in milliseconds.
**Do this instead:** Use `qrcode.react` (client component). Pass `placeId` as a prop. QR renders client-side with zero API calls. The review URL is `https://search.google.com/local/writereview?placeid=${profile.placeId}`.

### Anti-Pattern 5: Modifying the PDF Generator Alongside UI Changes

**What people do:** Bundle PDF template changes with web UI changes in the same phase.
**Why it's wrong:** The PDF generator (`report-generator.ts` + `report-template.tsx`) uses `@react-pdf/renderer`, which has different rendering semantics than web React. Bugs in the PDF break report downloads for all users.
**Do this instead:** Ship the web UI enhancements to the reports page first. Add the PDF template enhancements in a follow-up phase after the web changes are validated.

---

## Build Order (Feature Dependencies)

```
Phase A: Foundation — no visual output, pure lib/infra
  1. src/lib/optimization-score.ts          Pure function, can be unit-tested immediately
  2. Verify/add recharts to package.json    Only new npm dep the milestone likely needs
  3. Verify/add qrcode.react                For review QR codes

Phase B: Business Cards — lowest risk (modifies existing page, no new routes)
  4. Upgrade /dashboard/profiles/page.tsx
     - Extend Prisma query (_count.posts, descriptions where isPushed)
     - Swap Building2 for styled initials avatar
     - Add map thumbnail (conditional on placeId)
     - Add inline optimization score badge (uses lib from Phase A)

Phase C: Dashboard Upgrades — extends existing complex page
  5. Upgrade /dashboard/page.tsx
     - Welcome banner (session.user.name, totalProfiles === 0 condition)
     - Extend automations query to include optimization pushes
     - Business filter bar component + cookie/URL param logic

Phase D: Optimization Page — new route, uses Phase A lib
  6. src/components/optimization/score-gauge.tsx     SVG arc client component
  7. src/components/optimization/audit-card.tsx      Per-check card with CTA
  8. src/components/optimization/audit-grid.tsx      Grid wrapper
  9. /dashboard/optimization/[profileId]/page.tsx    RSC page
  10. /api/profiles/[id]/score/route.ts               API endpoint for client re-fetch
  11. Modify sidebar.tsx: add Optimization nav item
  12. Modify profiles/[id]/page.tsx: add score widget + link

Phase E: Review Metrics — new route, independent of Phase D
  13. src/components/reviews/rating-distribution.tsx  Horizontal bar chart
  14. src/components/reviews/review-trend-chart.tsx   Recharts line chart
  15. /dashboard/reviews/metrics/[profileId]/page.tsx  RSC page
  16. QR code section (qrcode.react, client component)
  17. Add "View Metrics" button to /dashboard/reviews/page.tsx header
  18. /api/reviews/metrics/route.ts                   API for client-side re-fetch

Phase F: Reports Enhancement — highest operational risk (touches PDF)
  19. Add website clicks chart to /dashboard/reports/page.tsx
  20. Add completed actions log (posts + description pushes)
  21. Add competitor card (static "Coming soon" UI)
  22. Optional: extend src/lib/pdf/report-generator.ts (deferred if risky)
```

**Rationale for this order:**
- Business Cards (B) is safest first — no new routes, no new models, isolated to one page.
- Dashboard (C) extends an already-complex page — do after gaining confidence from B.
- Optimization Page (D) depends on the score lib from A; added to sidebar after the page exists.
- Review Metrics (E) is fully independent but introduces a chart library — establish the pattern after D.
- Reports Enhancement (F) is last because PDF changes are operationally sensitive and can be separated from web UI changes.

---

## External Dependencies Assessment

| Dependency | Status | Purpose | Notes |
|------------|--------|---------|-------|
| `recharts` | Likely not installed — verify | LineChart for metrics/review trends | Standard for Next.js RSC+client chart pattern. ~60KB gzipped. Only add if not present. |
| `qrcode.react` | Not installed | Client-side QR code rendering | Tiny library, zero backend required. |
| Google Static Maps API | Requires API key | Map thumbnail on business cards | Needs `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` env var. The key may already be available in the Google OAuth project. Fallback: styled placeholder if `placeId` is null. |
| All other v1.1 deps | Already installed | All GBP operations, AI, PDF | `googleapis`, `@anthropic-ai/sdk`, `@react-pdf/renderer` all remain unchanged. |

**Verify before starting:**
```bash
cat /Users/christopherballlard/Projects/MapsAI/package.json | grep -E "recharts|qrcode"
```

---

## Sources

- Direct codebase inspection: `/src/app/dashboard/`, `/src/app/api/`, `/src/lib/`, `/prisma/schema.prisma`, `/src/components/` — HIGH confidence
- Architecture patterns derived from existing v1.0/v1.1 patterns (RSC + client island, direct Prisma in RSC, Server Actions pattern, cookie-based profile selection)
- Optimization score formula derived from `OnboardingProgress.completedSteps` logic in existing `/src/app/api/onboarding/summary/route.ts`
- Score inputs mapped directly to existing Prisma models: `ProfileDescription.isPushed`, `ProfileService.isPushed`, `ProfileKeyword`, `ProfileCity`, `OnboardingProgress.completedSteps`, `Post._count`

---
*Architecture research for: Rankmaps.io v1.2 Profile Optimization & UI Enhancements*
*Researched: 2026-04-02*
