# Phase 17: Profile Optimization Page - Research

**Researched:** 2026-04-03
**Domain:** Next.js App Router page — Recharts RadialBarChart, server/client Suspense split, reoptimize workflow reuse
**Confidence:** HIGH

## Summary

Phase 17 delivers a per-profile optimization page at `/dashboard/optimization/[profileId]/`. All major building blocks already exist in the codebase: `computeOptimizationScore` (Phase 14), `ReoptimizeSection` approve/push logic (v1.1), and the full set of shadcn UI primitives. Recharts 3.8.1 is installed and the `chart.tsx` wrapper is ready for `RadialBarChart`. No new npm dependencies are required.

The primary work is wiring together existing pieces into a new route. The server component fetches the profile data and computes the score; the client components handle the gauge rendering, audit card grid, and interactive suggestion workflow. Phase 16's Suspense streaming pattern (server sub-components with skeleton fallbacks) applies directly here.

The one meaningful extraction decision is whether to pull approve/ignore/push logic from `reoptimize-section.tsx` into a shared hook — or adapt it inline for the new page. Either path is low risk given the existing API endpoints are unchanged; the decision is delegated to Claude's discretion.

**Primary recommendation:** Build the optimization page as a server-driven Suspense shell (matching Phase 16 pattern) with one client component for the interactive suggestion/bulk-action workflow. No new dependencies, no API route changes.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Score Gauge Visualization (OPT-01)**
- D-01: Render the optimization score as a Recharts `RadialBarChart` — recharts is already installed (Phase 14), shadcn chart component available at `src/components/ui/chart.tsx`. Consistent with chart tooling used in Phase 18/19.
- D-02: Gauge shows numeric score center-label (e.g., "72%"), colored arc matching grade (green/amber/red per Phase 14 thresholds), and grade label beneath.

**Audit Card Layout (OPT-02)**
- D-03: Display individual signal audit cards in a responsive grid (2-3 columns). Each card uses the existing Card component with a status-colored left border (green/amber/red matching `ScoreCheck.status`).
- D-04: Each card shows: signal name, current value, benchmark, status indicator, and plain-English recommendation from `ScoreCheck`. No interactive elements on audit cards — they're informational.
- D-05: Cards ordered by status priority: critical first, then warning, then good — so actionable items surface at the top.

**Suggestion Workflow Integration (OPT-03)**
- D-06: Reuse the existing `ReoptimizeSection` approve/push workflow logic from `src/app/dashboard/profiles/[id]/reoptimize-section.tsx`. Extract shared approve/ignore/push API interactions rather than duplicating.
- D-07: Optimization page shows pending suggestions (descriptions, services) with approve/ignore buttons inline. Same API endpoints as v1.1 re-optimization flow.
- D-08: Only show suggestions section when there are pending (unapproved) items. If all approved/pushed, show a success state instead.

**Bulk Actions UX (OPT-04)**
- D-09: Toolbar above suggestions section with "Approve All" and "Ignore All" buttons. Toolbar only appears when there are pending suggestions.
- D-10: Both bulk actions trigger a confirmation Dialog (existing `dialog.tsx` component) showing the count of pending items and the action about to be taken.
- D-11: After bulk action completes, show a toast or inline success message and refresh the suggestions list.

**Navigation & Entry Points**
- D-12: Add "Optimization" item to sidebar `navItems` array in `src/components/sidebar.tsx`. Use a gauge-like icon (e.g., `Gauge` from lucide-react). Links to `/dashboard/optimization`.
- D-13: `/dashboard/optimization` (no profileId) shows a profile picker or redirects to the first profile — Claude's discretion on exact behavior.
- D-14: Score badge on business cards (Phase 15) becomes a clickable link to `/dashboard/optimization/[profileId]`.

### Claude's Discretion
- Exact Recharts RadialBarChart config (inner/outer radius, start/end angles, animation)
- Whether to extract ReoptimizeSection logic into shared hooks/utils or adapt inline
- Profile picker behavior on `/dashboard/optimization` (list, redirect, or selector)
- Skeleton shapes for Suspense fallbacks on the optimization page
- Whether audit cards and suggestions are separate Suspense boundaries or one
- Toast vs inline success message for bulk actions

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OPT-01 | User can view an optimization score gauge (0-100%) for any business profile, computed from weighted signals | `computeOptimizationScore` returns `total` and `grade`. Recharts `RadialBarChart` renders the arc. `ChartContainer` from `chart.tsx` wraps it. Color constants already established: green #22c55e >= 70, amber #f59e0b 40-69, red #ef4444 < 40. |
| OPT-02 | User can see individual GBP audit cards per signal showing current value, benchmark, status, and recommendation | `ScoreCheck` interface supplies all four fields. Card component with status-colored left border via inline style or border-l-4 Tailwind class. Sort by status: critical → warning → good. |
| OPT-03 | User can approve or ignore AI-generated description, services, and attribute suggestions on the optimization page | Reuse API endpoints: GET/POST `/api/reoptimize/description`, GET/POST `/api/reoptimize/services`, POST `/api/reoptimize/description/push`, POST `/api/reoptimize/services/push`. Extract logic from `reoptimize-section.tsx`. |
| OPT-04 | User can bulk approve or bulk ignore all pending suggestions with a confirmation dialog | `Dialog` from `@base-ui/react` (via `dialog.tsx`). Bulk approve = set all pending `isApproved: true`. Bulk ignore = remove/hide all unapproved items. Confirmation shows count. |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| recharts | 3.8.1 | RadialBarChart gauge rendering | Already installed; `chart.tsx` wrapper present; locked by D-01 |
| Next.js App Router | 16.1.6 | Route, server components, Suspense | Project framework |
| Prisma | 7.4.2 | Profile/description/services DB queries | Project ORM |
| @base-ui/react | 1.2.0 | Dialog for bulk-action confirmation | Used in existing `dialog.tsx` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | 0.577.0 | `Gauge` icon for sidebar nav item | D-12 |
| motion | 12.35.2 | `MotionDiv` entrance animation | All dashboard pages use it |
| vitest | 4.1.2 | Unit tests for pure functions | Test sort logic, status helpers |

### No New Dependencies

No packages need to be installed for this phase. All required libraries are present.

---

## Architecture Patterns

### Recommended File Structure

```
src/app/dashboard/optimization/
├── page.tsx                         # /dashboard/optimization — profile picker (server)
├── [profileId]/
│   ├── page.tsx                     # Server component: fetch + compute score
│   ├── optimization-score-gauge.tsx # Client component: RadialBarChart gauge
│   ├── audit-cards-grid.tsx         # Pure client component: renders sorted ScoreCheck[]
│   └── suggestions-panel.tsx        # Client component: approve/ignore/bulk actions
src/app/dashboard/profiles/
└── profiles-grid.tsx                # Edit: badge → Link to /dashboard/optimization/[id]
src/components/
└── sidebar.tsx                      # Edit: add Optimization navItem
```

### Pattern 1: Suspense Streaming Shell (Phase 16 pattern)

**What:** `page.tsx` for `/dashboard/optimization/[profileId]` does only the fast synchronous work (params extraction, profile name lookup), then wraps heavy async sub-components in `<Suspense>` with skeleton fallbacks.

**When to use:** Any dashboard page with slow DB queries. Established in Phase 16.

```typescript
// src/app/dashboard/optimization/[profileId]/page.tsx
import { Suspense } from 'react';
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { MotionDiv } from '@/components/motion-wrapper';
import { Skeleton } from '@/components/ui/skeleton';
import { OptimizationContent, OptimizationContentSkeleton } from './optimization-content';

export default async function OptimizationPage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;
  // Fast PK lookup — same pattern as dashboard/page.tsx
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { name: true },
  });
  if (!profile) notFound();

  return (
    <MotionDiv initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      <h1 className="text-3xl font-bold text-zinc-900 tracking-tight">{profile.name}</h1>
      <Suspense fallback={<OptimizationContentSkeleton />}>
        <OptimizationContent profileId={profileId} />
      </Suspense>
    </MotionDiv>
  );
}
```

### Pattern 2: RadialBarChart Gauge with Center Label

**What:** Recharts `RadialBarChart` with a custom center label overlay. The shadcn `ChartContainer` wraps it in a `ResponsiveContainer`.

**Key config facts (verified against recharts 3.x docs):**
- `RadialBarChart` with `innerRadius` / `outerRadius` as percentages or pixels
- Custom label rendered as absolute-positioned JSX inside the container (not `label` prop on RadialBar — it renders at the bar end, not center)
- `startAngle` / `endAngle` control the arc sweep: `startAngle={180} endAngle={0}` creates a half-circle; `startAngle={220} endAngle={-40}` creates a 260-degree arc (recommended for gauges)
- Single data entry: `[{ name: 'score', value: score.total, fill: colorForGrade }]`
- Background ring: `<RadialBar background={{ fill: '#e4e4e7' }} ...>` (zinc-200)

```typescript
// src/app/dashboard/optimization/[profileId]/optimization-score-gauge.tsx
'use client';
import { RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts';
import { ChartContainer } from '@/components/ui/chart';

const GRADE_COLORS = {
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
} as const;

export function OptimizationScoreGauge({
  total,
  grade,
}: {
  total: number;
  grade: 'green' | 'amber' | 'red';
}) {
  const data = [{ value: total, fill: GRADE_COLORS[grade] }];

  return (
    <div className="relative w-48 h-48">
      <ChartContainer config={{ score: { color: GRADE_COLORS[grade] } }} className="aspect-square">
        <RadialBarChart
          data={data}
          innerRadius="70%"
          outerRadius="90%"
          startAngle={220}
          endAngle={-40}
          barSize={16}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background={{ fill: '#e4e4e7' }} dataKey="value" cornerRadius={8} />
        </RadialBarChart>
      </ChartContainer>
      {/* Center label — absolute overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-zinc-900">{total}%</span>
        <span className="text-sm font-medium" style={{ color: GRADE_COLORS[grade] }}>
          {grade.charAt(0).toUpperCase() + grade.slice(1)}
        </span>
      </div>
    </div>
  );
}
```

### Pattern 3: Server Component Fetches, Client Component Renders

**What:** The server sub-component (`optimization-content.tsx`) fetches all DB data and calls `computeOptimizationScore`, passing the result as props to client components. Client components receive pre-computed data — no client-side fetching needed for score/audit cards.

**Exception:** The suggestions panel still uses the existing `fetch('/api/reoptimize/...')` pattern because it needs to mutate (approve/push) — keeping the established v1.1 client-side mutation pattern.

### Pattern 4: Audit Card Sort Priority

**What:** Sort `ScoreCheck[]` before rendering: critical first, warning second, good last.

```typescript
// Pure function — testable
const STATUS_ORDER: Record<ScoreStatus, number> = { critical: 0, warning: 1, good: 2 };
export function sortByStatusPriority(checks: ScoreCheck[]): ScoreCheck[] {
  return [...checks].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}
```

### Pattern 5: Index Route Profile Picker (D-13)

**What:** `/dashboard/optimization` (no profileId) needs a landing behavior. Three options:
1. Redirect to first profile (simplest — `redirect('/dashboard/optimization/' + profiles[0].id)`)
2. Show a list of profile cards with "View Optimization" links
3. Redirect to cookie-selected profile if set

**Recommendation (Claude's discretion):** Use option 3 — check `getSelectedProfileId()` cookie first; if set, redirect to that profile; if not, show a simple profile picker list (same data already fetched for business cards).

### Anti-Patterns to Avoid

- **Don't call `computeOptimizationScore` on the client with a fetch.** The function is a pure library call — call it in the server component that already has the DB data. No API endpoint needed for the score computation.
- **Don't duplicate approve/push API calls.** The existing endpoints at `/api/reoptimize/description`, `/api/reoptimize/description/push`, `/api/reoptimize/services`, `/api/reoptimize/services/push` are complete and correct. Use them as-is.
- **Don't use `label` prop on `RadialBar` for the center number.** Recharts places bar-end labels at the arc's endpoint, not the center. Use an absolute-positioned overlay `div` instead.
- **Don't block the Suspense shell on the full profile data fetch.** Follow Phase 16 pattern: name lookup fast in page.tsx, heavy selects inside the sub-component.
- **Don't mix `isApproved` and `isPushed` semantics.** In the existing data model: `isPushed` = live on GBP; `isApproved` = approved by user but not yet pushed. "Pending" suggestions are those where `!isApproved && !isPushed`. "Ignore" means set the record aside without pushing (client-side hide or a soft delete depending on existing API behavior).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Gauge chart | Custom SVG arc math | `recharts RadialBarChart` | Recharts handles responsive sizing, animation, accessibility |
| Approve/push API | New routes | Existing `/api/reoptimize/*` endpoints | Already tested; same GBP write logic |
| Confirmation dialog | Custom modal | `dialog.tsx` (`@base-ui/react`) | Animation, focus trap, a11y all handled |
| Score computation | Re-implement signal scoring | `computeOptimizationScore` from `src/lib/optimization-score.ts` | Single source of truth; Phase 14 tests cover all edge cases |
| Status color mapping | Inline ternaries everywhere | `GRADE_CLASSES` from `score-utils.ts` + explicit hex constants for SVG fill | Consistent with Phase 14/15 contract |

**Key insight:** This phase is almost entirely composition of existing pieces. The risk is accidentally duplicating logic that already exists rather than under-building.

---

## Common Pitfalls

### Pitfall 1: Date Deserialization in Server-to-Client Data Passing

**What goes wrong:** Server passes `Date` objects in profile data to a client component as props — Next.js serializes them as ISO strings, breaking `new Date(r.reviewDate)` comparisons in the score function.

**Why it happens:** Next.js App Router serializes server component props to JSON when crossing the server/client boundary.

**How to avoid:** Call `computeOptimizationScore` in the server component (before the boundary), not in a client component. Pass the already-computed `OptimizationScore` object (plain numbers and strings) as props.

**Warning signs:** TypeScript error about `Date` not being serializable, or score always returning 0 for time-based signals.

**Existing precedent:** `profiles-grid.tsx` already handles this with explicit `new Date(r.reviewDate)` in the client component. Since we're calling the score function server-side, the problem doesn't arise.

### Pitfall 2: RadialBarChart Domain Mismatch

**What goes wrong:** Score arc renders at wrong proportion because `PolarAngleAxis domain` defaults to data min/max instead of `[0, 100]`.

**Why it happens:** Recharts infers domain from the data unless explicitly set.

**How to avoid:** Always set `<PolarAngleAxis type="number" domain={[0, 100]} tick={false} />` when the gauge represents a percentage.

### Pitfall 3: Bulk Ignore Semantics vs. API Contract

**What goes wrong:** "Ignore All" has no API endpoint — the existing API only supports approve/push, not soft-delete or ignore.

**Why it happens:** The v1.1 flow never needed a bulk ignore — users acted on suggestions individually or just didn't approve them.

**How to avoid:** Implement "Ignore All" as client-side state only (filter out unapproved items from the local list). If you want persistence across page loads, you would need a new API endpoint — but for this phase, client-side hide (remove from the local array) is sufficient and matches D-11 ("refresh the suggestions list").

**Action required:** Confirm with the existing API whether `isApproved: false` and `isPushed: false` are the "pending" state. If so, "ignore" = don't call any API, just hide in local state. No new route needed.

### Pitfall 4: Sidebar Active State for Nested Routes

**What goes wrong:** The `Optimization` sidebar item doesn't highlight as active when the user is at `/dashboard/optimization/[profileId]`.

**Why it happens:** The current `isActive` check uses `pathname.startsWith(item.href)`. If `item.href` is `/dashboard/optimization`, this correctly matches both the index and sub-routes.

**How to avoid:** Use `/dashboard/optimization` as the href in `navItems`. The existing `startsWith` logic handles the nested profileId route correctly.

### Pitfall 5: Profile Not Found on Optimization Page

**What goes wrong:** User navigates to `/dashboard/optimization/[profileId]` with a stale or invalid ID — page crashes.

**How to avoid:** Call `notFound()` from `next/navigation` when `prisma.profile.findUnique` returns null. This is the pattern used in `profiles/[id]/page.tsx`.

---

## Code Examples

### Existing API Endpoints (verified by reading source)

```
GET  /api/reoptimize/description?profileId=X
     → { currentGBPDescription, savedDescription: { id, content, isApproved, isPushed, pushedAt }, keywords }

POST /api/reoptimize/description
     body: { profileId }
     → { description: string }  (AI generated, not saved yet)

POST /api/reoptimize/description/push
     body: { profileId, content }
     → { success: boolean, description: { id } }

GET  /api/reoptimize/services?profileId=X
     → { currentGBPServices, availableServices, savedServices[] }

POST /api/reoptimize/services
     body: { profileId, serviceNames: string[] }
     → { services: [{ serviceName, description }] }

POST /api/reoptimize/services/push
     body: { profileId }
     → { success: boolean }
```

### Prisma Query for Optimization Page Server Component

```typescript
// Fetch all fields needed by computeOptimizationScore + description/service pending state
const profile = await prisma.profile.findUnique({
  where: { id: profileId },
  select: {
    id: true,
    name: true,
    reviews: { select: { rating: true, reviewDate: true } },
    posts: { select: { publishedAt: true, status: true } },
    descriptions: {
      select: { id: true, content: true, isApproved: true, isPushed: true, pushedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 1,
    },
    services: {
      select: { id: true, serviceName: true, description: true, isApproved: true, isPushed: true, pushedAt: true },
    },
  },
});
```

### Status Color Helper for Audit Cards

```typescript
const STATUS_COLORS = {
  good: { border: 'border-l-emerald-500', badge: 'bg-emerald-100 text-emerald-700' },
  warning: { border: 'border-l-amber-500', badge: 'bg-yellow-100 text-yellow-700' },
  critical: { border: 'border-l-red-500', badge: 'bg-red-100 text-red-700' },
} as const;
```

### Bulk Action Confirmation Dialog Pattern

```typescript
// Uses existing dialog.tsx (@base-ui/react)
<Dialog>
  <DialogTrigger asChild>
    <Button variant="outline">Approve All ({pendingCount})</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogTitle>Approve all pending suggestions?</DialogTitle>
    <DialogDescription>
      This will approve {pendingCount} pending item{pendingCount !== 1 ? 's' : ''}.
      You can still push them to Google individually afterward.
    </DialogDescription>
    <div className="flex justify-end gap-2">
      <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
      <Button onClick={handleBulkApprove}>Approve All</Button>
    </div>
  </DialogContent>
</Dialog>
```

---

## Runtime State Inventory

> This is a UI-only phase adding a new route. No data migration, rename, or runtime state changes.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no schema changes, no new tables | None |
| Live service config | None — no external service changes | None |
| OS-registered state | None | None |
| Secrets/env vars | None | None |
| Build artifacts | None | None |

---

## Environment Availability

> This phase uses only already-installed npm packages and existing Railway-deployed PostgreSQL. No external tool checks needed.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| recharts | RadialBarChart gauge (OPT-01) | Yes | 3.8.1 | — |
| @base-ui/react | Dialog for bulk confirmation (OPT-04) | Yes | 1.2.0 | — |
| lucide-react | Gauge icon for sidebar | Yes | 0.577.0 | Use BarChart3 or Activity icon |
| PostgreSQL | Profile/description/services data | Yes (Railway) | — | — |

**No missing dependencies.**

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 |
| Config file | none — configured via `package.json` scripts |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OPT-01 | `computeOptimizationScore` returns correct total/grade | unit | `npx vitest run tests/lib/optimization-score.test.ts` | Yes (Phase 14) |
| OPT-02 | `sortByStatusPriority` sorts critical→warning→good | unit | `npx vitest run tests/lib/optimization-sort.test.ts` | No — Wave 0 |
| OPT-02 | Status color helper returns correct Tailwind classes per status | unit | `npx vitest run tests/app/optimization-utils.test.ts` | No — Wave 0 |
| OPT-03 | Suggestion pending state: `!isApproved && !isPushed` correctly identifies pending | unit | `npx vitest run tests/app/optimization-utils.test.ts` | No — Wave 0 |
| OPT-04 | Bulk approve sets all pending items to `isApproved: true` | unit | `npx vitest run tests/app/optimization-utils.test.ts` | No — Wave 0 |
| OPT-04 | Bulk ignore removes all pending items from local list | unit | `npx vitest run tests/app/optimization-utils.test.ts` | No — Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/lib/optimization-sort.test.ts` — covers `sortByStatusPriority` (OPT-02)
- [ ] `tests/app/optimization-utils.test.ts` — covers status color mapping, pending-state detection, bulk approve/ignore logic (OPT-02, OPT-03, OPT-04)

*(Both test files cover pure functions with no React/DOM dependencies — vitest can run them without any additional setup.)*

---

## Open Questions

1. **"Ignore All" persistence across page loads**
   - What we know: The existing API has no "ignore" endpoint. The current data model has no `isIgnored` field on `ProfileDescription` or `ProfileService`.
   - What's unclear: Should "Ignore All" persist (hide even after page refresh) or only apply for the current session?
   - Recommendation: Implement as client-state-only hide for this phase — consistent with D-11 ("refresh the suggestions list") and avoids a schema migration. User can always navigate back and re-generate suggestions.

2. **`/dashboard/optimization` index route behavior (D-13)**
   - What we know: `getSelectedProfileId()` reads a cookie set by the header profile selector.
   - What's unclear: What happens if the cookie is stale (profile deleted)?
   - Recommendation: Check cookie → verify profile exists → redirect if valid; else show profile picker list. Guard with `prisma.profile.findUnique` before redirect.

3. **Score badge on business cards as clickable link (D-14)**
   - What we know: The badge is rendered in `profiles-grid.tsx` as a `<Badge>` with no wrapping `<Link>`.
   - What's unclear: Should the entire card link to optimization, or only the badge?
   - Recommendation: Wrap only the badge in a `<Link href="/dashboard/optimization/${profile.id}">` to preserve the existing "View details" link behavior. The card already has a "View details" link to `profiles/${id}`.

---

## Sources

### Primary (HIGH confidence)

- Codebase: `src/lib/optimization-score.ts` — `computeOptimizationScore`, `ScoreCheck`, `ProfileInput`, `OptimizationScore` interfaces verified by direct read
- Codebase: `src/app/dashboard/profiles/[id]/reoptimize-section.tsx` — approve/ignore/push handlers, API endpoint URLs verified by direct read
- Codebase: `src/components/sidebar.tsx` — `navItems` array structure verified by direct read
- Codebase: `src/components/ui/chart.tsx` — `ChartContainer`, `ChartConfig` types verified; wraps `recharts ResponsiveContainer`
- Codebase: `src/components/ui/dialog.tsx` — Uses `@base-ui/react` Dialog primitives verified
- Codebase: `prisma/schema.prisma` — `ProfileDescription` and `ProfileService` fields verified: `isApproved`, `isPushed`, `pushedAt`
- Codebase: `package.json` — recharts 3.8.1, vitest 4.1.2, lucide-react 0.577.0 confirmed installed

### Secondary (MEDIUM confidence)

- Recharts RadialBarChart API: `PolarAngleAxis domain`, `startAngle`/`endAngle`, `background` prop behavior consistent with recharts 3.x documentation patterns

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified in package.json, no new dependencies needed
- Architecture: HIGH — all patterns derived directly from existing codebase code (Phase 16, Phase 15)
- Pitfalls: HIGH — all pitfalls derived from reading actual source code, not assumptions
- Recharts gauge config: MEDIUM — API patterns consistent with recharts 3.x; exact angle values and cornerRadius are Claude's discretion per context

**Research date:** 2026-04-03
**Valid until:** 2026-05-03 (stable stack; recharts API is stable)
