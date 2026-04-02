# Phase 15: Business Cards View - Context

**Gathered:** 2026-04-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Enhance the existing profiles page with optimization score badges, real-time search filtering, and efficient Prisma aggregation queries. The card grid layout already exists — this phase upgrades it with CARD-01 through CARD-04 requirements. No new routes needed.

</domain>

<decisions>
## Implementation Decisions

### Score Badge
- **D-01:** Color-coded optimization score badge in top-right corner of each card. Uses Badge component with green/amber/red variants matching ScoreGrade from Phase 14.
- **D-02:** Badge shows numeric score (e.g., "85") with background color — green (#22c55e) for ≥70, amber (#f59e0b) for 40-69, red (#ef4444) for <40.
- **D-03:** Score computed server-side per card using `computeOptimizationScore` from `@/lib/optimization-score`. Pass profile with relations to the function.

### Search
- **D-04:** Client-side search filter — profiles list is 100-200 max, no server round-trips needed.
- **D-05:** Search bar at top of page, filters cards by business name as user types. Case-insensitive substring match.
- **D-06:** When search has no results, show "No businesses match your search" with existing empty state pattern.

### Query Optimization
- **D-07:** Replace current `include: { reviews: true }` with Prisma aggregations (`_avg`, `_count`) for list rendering per ROADMAP SC-5.
- **D-08:** For score computation, fetch necessary relations (reviews, posts, descriptions, services) but only the fields needed by ProfileInput interface.
- **D-09:** Use `select` to limit fields returned — no full relation arrays for display purposes.

### Card Layout
- **D-10:** Keep existing 4-column responsive grid (1→2→3→4 columns at breakpoints). Already matches CARD-01.
- **D-11:** Keep existing card elements: Building2 icon, star rating with filled stars, business name, address with MapPin, "View details" link.
- **D-12:** Add review count display next to star rating (e.g., "4.2 (47 reviews)").

### Add Business
- **D-13:** Keep existing AddBusinessButton component — already handles CARD-03. No changes needed.

### Claude's Discretion
- Exact Prisma query shape (which fields to select vs aggregate)
- Whether to split into server component (data) + client component (search filtering) or use a single client component
- Animation timing for card entrance (existing MotionDiv pattern)
- Search input debounce timing (if any)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Current Implementation
- `src/app/dashboard/profiles/page.tsx` — Existing profiles page with card grid (the file being enhanced)
- `src/app/dashboard/profiles/add-business-button.tsx` — AddBusinessButton component (keep as-is)
- `src/app/dashboard/profiles/resync-button.tsx` — ResyncButton component (keep as-is)

### Score Library (Phase 14)
- `src/lib/optimization-score.ts` — `computeOptimizationScore(profile: ProfileInput)` returns `{ total, grade, checks }`
- `tests/lib/optimization-score.test.ts` — Test coverage showing expected inputs/outputs

### UI Components
- `src/components/ui/card.tsx` — Card, CardHeader, CardContent, CardFooter primitives
- `src/components/ui/badge.tsx` — Badge component for score display
- `src/components/ui/input.tsx` — Input component for search bar
- `src/components/motion-wrapper.tsx` — MotionDiv for page animations

### Schema
- `prisma/schema.prisma` — Profile model with relations (reviews, posts, descriptions, services)

### Requirements
- `.planning/REQUIREMENTS.md` — CARD-01 through CARD-04

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Card` component with hover states and group transitions (already used on profiles page)
- `Badge` component for score grade display
- `MotionDiv` for staggered card entrance animations (already implemented)
- `buttonVariants` for consistent button styling
- `AddBusinessButton` and `ResyncButton` — keep unchanged

### Established Patterns
- Server components for data fetching, client components only when needed (search filter)
- Prisma queries in server components with `include` for relations
- Responsive grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`
- Lucide icons throughout (Building2, MapPin, Star, Plus)
- Zinc color palette for neutrals, brand-* for accents

### Integration Points
- `computeOptimizationScore` imported from `@/lib/optimization-score`
- Prisma Profile model with reviews, posts, descriptions, services relations
- Dashboard layout wraps all profile pages

</code_context>

<specifics>
## Specific Ideas

No specific requirements — the existing profiles page layout is well-established and just needs score badges, search, and query optimization layered on.

</specifics>

<deferred>
## Deferred Ideas

- **Google Maps thumbnails** — Out of scope per REQUIREMENTS.md (requires Static Maps API key)
- **Profile sorting options** — Sort by score, rating, name (could be a future enhancement)
- **Bulk actions on cards** — Select multiple profiles for batch operations

</deferred>

---

*Phase: 15-business-cards-view*
*Context gathered: 2026-04-02*
