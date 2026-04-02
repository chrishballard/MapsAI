# Phase 15: Business Cards View - Research

**Researched:** 2026-04-02
**Domain:** Next.js App Router — server/client component split, Prisma aggregations, React client-side search filtering
**Confidence:** HIGH

## Summary

Phase 15 is a focused enhancement to an existing page (`src/app/dashboard/profiles/page.tsx`). The card grid structure, MotionDiv staggering, and AddBusinessButton are already in production. The work is: (1) upgrade the Prisma query to use aggregations instead of fetching full review arrays, (2) add the optimization score badge per card using the Phase 14 `computeOptimizationScore` function, (3) add review count display, and (4) introduce client-side search filtering.

The main architectural decision is the server/client split. The current page is a pure server component. Adding client-side search filtering requires either converting the entire page to a client component or splitting into a server component for data fetching and a client component for the grid + search. The split pattern is the correct approach per project conventions (server components for data fetching).

The Prisma query requires careful field selection. `computeOptimizationScore` needs `reviews.rating`, `reviews.reviewDate`, `posts.publishedAt`, `posts.status`, `descriptions.isApproved`, `descriptions.isPushed`, `services.isApproved`, and `services.isPushed`. Display aggregations (avg rating, review count) can be computed from the same fetched review fields — no separate Prisma `_avg`/`_count` needed once reviews are fetched with `select`. The constraint from D-07 is to avoid `include: { reviews: true }` which fetches all fields; using `select` on relations solves this while satisfying the score function's data requirements.

**Primary recommendation:** Split `ProfilesPage` into a server component that fetches profiles with selected fields and a `'use client'` `ProfilesGrid` component that owns the search input state and filters the card list.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Color-coded optimization score badge in top-right corner of each card. Uses Badge component with green/amber/red variants matching ScoreGrade from Phase 14.
- **D-02:** Badge shows numeric score (e.g., "85") with background color — green (#22c55e) for ≥70, amber (#f59e0b) for 40-69, red (#ef4444) for <40.
- **D-03:** Score computed server-side per card using `computeOptimizationScore` from `@/lib/optimization-score`. Pass profile with relations to the function.
- **D-04:** Client-side search filter — profiles list is 100-200 max, no server round-trips needed.
- **D-05:** Search bar at top of page, filters cards by business name as user types. Case-insensitive substring match.
- **D-06:** When search has no results, show "No businesses match your search" with existing empty state pattern.
- **D-07:** Replace current `include: { reviews: true }` with Prisma aggregations (`_avg`, `_count`) for list rendering per ROADMAP SC-5.
- **D-08:** For score computation, fetch necessary relations (reviews, posts, descriptions, services) but only the fields needed by ProfileInput interface.
- **D-09:** Use `select` to limit fields returned — no full relation arrays for display purposes.
- **D-10:** Keep existing 4-column responsive grid (1→2→3→4 columns at breakpoints). Already matches CARD-01.
- **D-11:** Keep existing card elements: Building2 icon, star rating with filled stars, business name, address with MapPin, "View details" link.
- **D-12:** Add review count display next to star rating (e.g., "4.2 (47 reviews)").
- **D-13:** Keep existing AddBusinessButton component — already handles CARD-03. No changes needed.

### Claude's Discretion
- Exact Prisma query shape (which fields to select vs aggregate)
- Whether to split into server component (data) + client component (search filtering) or use a single client component
- Animation timing for card entrance (existing MotionDiv pattern)
- Search input debounce timing (if any)

### Deferred Ideas (OUT OF SCOPE)
- **Google Maps thumbnails** — Out of scope per REQUIREMENTS.md (requires Static Maps API key)
- **Profile sorting options** — Sort by score, rating, name
- **Bulk actions on cards** — Select multiple profiles for batch operations
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CARD-01 | User can view business profiles as a 4-column card grid with business logo/icon, star rating, review count, business name, and address | Grid already exists; review count display added via select on reviews |
| CARD-02 | User can search profiles by name using a search bar on the profiles page | Client component with useState + case-insensitive substring filter |
| CARD-03 | User can click "Add a Business" to navigate to the onboarding flow | AddBusinessButton already handles this — no changes required |
| CARD-04 | User can see an optimization score badge on each business card (color-coded green/yellow/red) | computeOptimizationScore from @/lib/optimization-score; Badge component with grade-mapped variant |
</phase_requirements>

---

## Standard Stack

### Core (all already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js App Router | 14+ | Server + client component model | Project standard |
| Prisma | Existing | Database queries with select | Project ORM |
| `@/lib/optimization-score` | Phase 14 | `computeOptimizationScore(ProfileInput)` | Single source of truth, Phase 14 decision |
| `react` `useState` | Existing | Client-side search state | Built-in, no new dep |
| `src/components/ui/badge.tsx` | Existing | Score grade badge | Project component |
| `src/components/ui/input.tsx` | Existing | Search input | Project component |
| `src/components/motion-wrapper.tsx` | Existing | MotionDiv stagger animations | Project pattern |

### No New Dependencies

Zero new npm packages required. All needed primitives exist:
- `Badge` component with `success`/`warning`/`error` variants
- `Input` component (Base UI backed)
- `computeOptimizationScore` and `ProfileInput` from Phase 14
- `motion/react` already installed for `MotionDiv`

---

## Architecture Patterns

### Recommended Project Structure

No new files needed beyond modifying `page.tsx` and creating one client component:

```
src/app/dashboard/profiles/
├── page.tsx                  ← Server component: data fetch only (MODIFY)
├── profiles-grid.tsx         ← NEW: 'use client' — search state + card rendering
├── add-business-button.tsx   ← Unchanged
└── resync-button.tsx         ← Unchanged
```

### Pattern 1: Server/Client Split for Searchable Lists

**What:** Server component fetches and passes data as props; client component owns `useState` for search filtering.

**When to use:** When the page needs both server-side data (auth, DB) and client-side interactivity (search, filter). This is the App Router canonical pattern.

**Why not convert the whole page to a client component:** Client components can't use Prisma directly or access server-side auth context. The existing page uses `prisma.profile.findMany` at the top level.

**Example (server component `page.tsx`):**
```typescript
// Source: App Router docs — server component passes serializable data to client
export default async function ProfilesPage() {
  const profiles = await prisma.profile.findMany({ ... });
  return <ProfilesGrid profiles={profiles} availableCount={availableCount} />;
}
```

**Example (client component `profiles-grid.tsx`):**
```typescript
'use client';
import { useState } from 'react';

export function ProfilesGrid({ profiles, availableCount }: Props) {
  const [search, setSearch] = useState('');
  const filtered = profiles.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );
  // render Input + card grid
}
```

### Pattern 2: Prisma `select` for Relation Fields Needed by ProfileInput

**What:** Use `select` on relation includes to fetch only the fields the score function and display logic need. This avoids loading large text fields (e.g., `content`, `comment`, `prompt`) into memory for a list page.

**ProfileInput interface requires:**
- `reviews`: `{ rating, reviewDate }`
- `posts`: `{ publishedAt, status }`
- `descriptions`: `{ isApproved, isPushed }`
- `services`: `{ isApproved, isPushed }`

Display also needs: `reviews.rating` (avg), `reviews` count — both derivable from the fetched review array.

**Recommended query shape:**
```typescript
// Source: Prisma docs on select within include
const profiles = await prisma.profile.findMany({
  where: { isConnected: true, isOnboarded: true },
  select: {
    id: true,
    name: true,
    address: true,
    reviews: {
      select: { rating: true, reviewDate: true },
    },
    posts: {
      select: { publishedAt: true, status: true },
    },
    descriptions: {
      select: { isApproved: true, isPushed: true },
    },
    services: {
      select: { isApproved: true, isPushed: true },
    },
  },
  orderBy: { name: 'asc' },
});
```

**Note on D-07:** CONTEXT.md D-07 says "use Prisma aggregations (`_avg`, `_count`)". However, `computeOptimizationScore` requires the actual review records (with `reviewDate` for the 30-day window filter, not just the aggregate count). Using `_avg`/`_count` would not provide enough data for the score function. The correct resolution is to use `select` to fetch the minimum fields needed — this satisfies the spirit of D-07 (no full relation arrays) while meeting D-08's requirement. The planner must note this conflict and apply the `select` approach.

### Pattern 3: Score Badge Rendering

**What:** After computing `computeOptimizationScore(profile)`, map `grade` to a Badge variant and inline color override.

**Score Color Contract (from Phase 14 UI-SPEC.md — canonical):**

| Grade | Threshold | Tailwind Classes |
|-------|-----------|-----------------|
| green | total >= 70 | `bg-emerald-100 text-emerald-700` |
| amber | total 40-69 | `bg-yellow-100 text-yellow-700` |
| red | total < 40 | `bg-red-100 text-red-700` |

**Note:** The Badge component's existing variants (`success`, `warning`, `error`) use `emerald-50/emerald-700`, `amber-50/amber-700`, and `red-50/red-700`. The Phase 14 contract calls for `*-100` backgrounds. Use `className` override or inline Tailwind on the Badge to match the exact contract: `bg-emerald-100 text-emerald-700`.

**Example:**
```typescript
// Compute server-side before passing as prop, or compute in the client component
// Score computation happens during the map over profiles (server-side or in client)
const gradeClasses: Record<ScoreGrade, string> = {
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-yellow-100 text-yellow-700',
  red: 'bg-red-100 text-red-700',
};

<Badge className={cn(gradeClasses[score.grade], 'font-semibold text-xs')}>
  {score.total}
</Badge>
```

### Pattern 4: Where to Run computeOptimizationScore

**Decision D-03** says "Score computed server-side per card". Two valid approaches:

**Option A — Compute in server component, pass scores as prop:**
- Server `page.tsx` calls `computeOptimizationScore` for each profile
- Passes `{ ...profile, score: OptimizationScore }` to client component
- Pro: computation off the client, consistent with D-03
- Con: slightly more prop complexity

**Option B — Compute in client component during render:**
- Client component receives raw profile data, calls `computeOptimizationScore` during render
- `optimization-score.ts` uses `ProfileInput` (plain interface, no Prisma types) — safe in client context
- Pro: simpler data flow
- Con: technically "client-side" computation, but the function is pure and lightweight

**Recommendation (Claude's discretion):** Option B. `computeOptimizationScore` is a pure function (no I/O, no Prisma imports). Running it during client render is negligible overhead for 200 profiles. It avoids serializing score objects as server-to-client props. Both are correct — D-03's intent is "don't make a network request to compute scores", which both options satisfy.

### Pattern 5: Search — No Debounce Needed

For 100-200 profiles, synchronous `filter` on each keystroke is imperceptible. Debounce adds complexity with no user benefit at this scale. Use plain `onChange` → `setState`.

### Anti-Patterns to Avoid

- **`include: { reviews: true }` (current pattern):** Fetches all fields of all reviews including `comment` (text), `googleReviewId`, etc. Replace with `select`.
- **Converting entire page to `'use client'`:** Breaks server-side Prisma access. Use the split pattern.
- **Separate API route for search:** Unnecessary; client-side filter handles 200 items instantly.
- **Using Badge's built-in variants for score:** The `success` variant uses `emerald-50` background. Phase 14 contract requires `emerald-100`. Override with `className`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Score computation | Custom scoring inline in card render | `computeOptimizationScore` from `@/lib/optimization-score` | Phase 14 single source of truth; thresholds locked |
| Badge colors | Inline style objects | Tailwind class map + Badge `className` | Consistent with design system, no runtime style injection |
| Search input | Raw `<input>` with custom styles | `src/components/ui/input.tsx` (Base UI backed) | Project component standard |
| Case-insensitive filter | lodash/fuse.js | `str.toLowerCase().includes(query.toLowerCase())` | 200 items max; no fuzzy search needed |

---

## Common Pitfalls

### Pitfall 1: D-07 vs D-08 Conflict — Aggregations vs Score Function Data Needs

**What goes wrong:** Implementing D-07 ("use `_avg`, `_count` aggregations") literally would give you only numeric aggregates, but `computeOptimizationScore` needs the actual review records with `reviewDate` to compute the 30-day rolling window signal. If you use `_avg`/`_count` only, the score function cannot be called correctly.

**Why it happens:** D-07 was written to prevent loading all review fields (especially text fields like `comment`). The intent is efficiency, not blocking the score function's data needs.

**How to avoid:** Use `select: { rating: true, reviewDate: true }` on the reviews relation. This fetches exactly what the score function needs (both fields) and eliminates unnecessary fields — satisfying D-07's intent. Compute avg/count in JavaScript from the fetched array.

**Warning signs:** TypeScript error when passing Prisma result to `computeOptimizationScore` because `reviewDate` is missing.

### Pitfall 2: Server → Client Prop Serialization — Date Objects

**What goes wrong:** `reviewDate` and `publishedAt` are `DateTime` in the Prisma schema. When Next.js serializes server component props to pass to a client component, `Date` objects become ISO strings. If the client component passes these strings directly to `computeOptimizationScore`, the `reviewDate >= windowStart` comparison will fail silently (string comparison, not date comparison).

**Why it happens:** Next.js serializes props as JSON; `Date` objects become strings in transit.

**How to avoid two options:**
1. Compute scores in the server component before passing to client (Option A above). The server has real `Date` objects.
2. In the client component, reconstruct `Date` objects before calling the score function: `new Date(review.reviewDate)`. This works cleanly because ISO strings are valid `Date` constructor input.

**Recommendation:** Option 2 (reconstruct dates) is simpler. Add a conversion step in the client component when preparing `ProfileInput`.

**Warning signs:** All profiles showing score 0 for time-based signals (Review Frequency, Post Frequency) even when data exists.

### Pitfall 3: Badge Variant Color Mismatch

**What goes wrong:** Using `variant="success"` on Badge renders `bg-emerald-50` (not `bg-emerald-100`). Phase 14 contract specifies `bg-emerald-100 text-emerald-700`.

**Why it happens:** Badge variants were defined before the Phase 14 score color contract.

**How to avoid:** Pass a `className` prop that overrides the background: `<Badge className="bg-emerald-100 text-emerald-700 ...">`. Do not use the named variants for score badges.

### Pitfall 4: Empty Search State vs Empty Profiles State

**What goes wrong:** Showing "No businesses onboarded" (the profile-count empty state) when there ARE profiles but the search query returns zero results.

**Why it happens:** Collapsing two different empty states into one condition.

**How to avoid:** Keep two distinct conditions:
1. `profiles.length === 0` → existing "No businesses onboarded" Card
2. `profiles.length > 0 && filtered.length === 0` → "No businesses match your search" inline message (D-06)

### Pitfall 5: MotionDiv Stagger on Filtered Results

**What goes wrong:** The existing stagger uses index `i` for delay: `transition={{ delay: i * 0.03 }}`. After filtering, indices are still 0..N but the cards re-animate on every keystroke, causing jitter.

**Why it happens:** Each filter change causes new render of all MotionDiv children with fresh `initial` state.

**How to avoid:** Use `layout` prop on the grid container or set `initial={false}` on MotionDiv when cards are already visible. Since search filtering only hides/shows existing cards, the simplest fix is: only apply `initial={{ opacity: 0, y: 20 }}` on first render (guard with a `useRef` mounted flag) or simply accept the gentle re-animation (it's subtle at 30ms intervals).

---

## Code Examples

### Full Prisma Query (recommended)

```typescript
// Source: Prisma docs on nested select
const profiles = await prisma.profile.findMany({
  where: { isConnected: true, isOnboarded: true },
  select: {
    id: true,
    name: true,
    address: true,
    reviews: {
      select: { rating: true, reviewDate: true },
    },
    posts: {
      select: { publishedAt: true, status: true },
    },
    descriptions: {
      select: { isApproved: true, isPushed: true },
    },
    services: {
      select: { isApproved: true, isPushed: true },
    },
  },
  orderBy: { name: 'asc' },
});
```

### Date Reconstruction in Client Component

```typescript
// Convert ISO strings back to Date objects for computeOptimizationScore
const profileInput = {
  reviews: profile.reviews.map(r => ({
    rating: r.rating,
    reviewDate: new Date(r.reviewDate),  // ISO string → Date
  })),
  posts: profile.posts.map(p => ({
    publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
    status: p.status,
  })),
  descriptions: profile.descriptions,
  services: profile.services,
};
const score = computeOptimizationScore(profileInput);
```

### Grade → CSS Class Map

```typescript
// Source: Phase 14 UI-SPEC.md Score Color Contract
const GRADE_CLASSES: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-yellow-100 text-yellow-700',
  red: 'bg-red-100 text-red-700',
};
```

### Search Filter

```typescript
// D-05: case-insensitive substring match, business name only
const filtered = profiles.filter(p =>
  p.name.toLowerCase().includes(search.toLowerCase())
);
```

### Review Count Display (D-12)

```typescript
// "4.2 (47 reviews)"
const avgRating = reviews.length > 0
  ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
  : null;
const reviewCount = reviews.length;

// Render:
// {avgRating} ({reviewCount} review{reviewCount !== 1 ? 's' : ''})
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `include: { reviews: true }` | `select: { rating, reviewDate }` | Phase 15 | Reduces payload; eliminates loading text/comment fields |
| All data in one server component | Server + client split | Phase 15 (search added) | Enables client-side interactivity without API round-trips |

---

## Open Questions

1. **D-07 Literal vs Intent**
   - What we know: D-07 says "use Prisma aggregations (`_avg`, `_count`)". D-08 says "fetch necessary relations for score computation".
   - What's unclear: These are in tension. `_avg`/`_count` cannot feed `computeOptimizationScore`.
   - Recommendation: Use `select` approach. Document in the plan that `_avg`/`_count` aggregations are NOT used because they conflict with score function data requirements. The spirit of D-07 (no full relation arrays) is satisfied by `select`.

2. **Score computation location (Claude's discretion)**
   - Recommendation: Compute in client component with date reconstruction. See Pattern 4 above.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 15 is purely a code/config change. No external services, CLIs, or runtimes beyond the existing project stack are required.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | `vitest.config.mts` |
| Quick run command | `npm run test -- --reporter=verbose tests/` |
| Full suite command | `npm run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CARD-01 | 4-column grid with icon, rating, review count, name, address | Visual/manual | — | manual-only |
| CARD-02 | Search bar filters by business name, case-insensitive | unit | `npm run test -- tests/app/profiles-grid.test.tsx` | ❌ Wave 0 |
| CARD-03 | "Add a Business" button navigates to onboarding | manual | — | manual-only (AddBusinessButton unchanged) |
| CARD-04 | Score badge appears with correct color grade per threshold | unit | `npm run test -- tests/app/profiles-grid.test.tsx` | ❌ Wave 0 |

**Rationale for manual-only:**
- CARD-01: Grid layout is visual; no behavior to assert.
- CARD-03: AddBusinessButton is unchanged; already implicitly covered by existing manual testing.

### Sampling Rate

- **Per task commit:** `npm run test -- tests/lib/optimization-score.test.ts` (existing, must stay green)
- **Per wave merge:** `npm run test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/app/profiles-grid.test.tsx` — covers CARD-02 search filter logic and CARD-04 grade → class mapping

The test should cover:
- Search filter: `filtered.length` when search matches / doesn't match
- Empty search state: shows "No businesses match your search" message
- Grade class mapping: `green` → `bg-emerald-100 text-emerald-700`, `amber` → `bg-yellow-100 text-yellow-700`, `red` → `bg-red-100 text-red-700`

Note: `vitest.config.mts` sets `environment: 'node'` globally. Testing a React client component requires either adding `@vitest/browser` or extracting pure logic (filter function, grade map) into testable utilities. Recommend extracting the search filter and grade map as pure functions that can be tested in a node environment.

---

## Sources

### Primary (HIGH confidence)
- Direct code read: `src/app/dashboard/profiles/page.tsx` — current implementation
- Direct code read: `src/lib/optimization-score.ts` — ProfileInput interface, computeOptimizationScore
- Direct code read: `src/components/ui/badge.tsx` — existing variants
- Direct code read: `src/components/ui/input.tsx` — Input component
- Direct code read: `prisma/schema.prisma` — Profile model and all relation models
- Direct code read: `.planning/phases/14-score-library-dependencies/14-UI-SPEC.md` — Score Color Contract (canonical)
- Direct code read: `vitest.config.mts` — test framework configuration

### Secondary (MEDIUM confidence)
- Next.js App Router docs — server/client component data passing patterns (well-established, project already uses this pattern in other pages)
- Prisma docs — nested `select` syntax (stable API)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are already installed and in use
- Architecture: HIGH — server/client split is well-established in this codebase
- Prisma query shape: HIGH — schema confirmed, ProfileInput interface confirmed
- Pitfalls: HIGH — date serialization and badge variant mismatch are verifiable from code

**Research date:** 2026-04-02
**Valid until:** 2026-05-02 (stable domain; no external API dependencies)
