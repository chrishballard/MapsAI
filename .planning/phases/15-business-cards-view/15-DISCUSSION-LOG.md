# Phase 15: Business Cards View - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-02
**Phase:** 15-business-cards-view
**Areas discussed:** Score badge placement, Search implementation, Query optimization, Empty states
**Mode:** --auto (all decisions auto-selected)

---

## Score Badge Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Top-right corner badge | Color-coded badge in card top-right, matches existing status indicator patterns | ✓ |
| Below business name | Inline score display under the business name |  |
| Bottom of card | Score bar at card footer |  |

**User's choice:** [auto] Top-right corner badge (recommended default)
**Notes:** Aligns with CARD-04 requirement "optimization score badge on each business card"

---

## Search Implementation

| Option | Description | Selected |
|--------|-------------|----------|
| Client-side filter | Filter rendered cards by name in browser — instant, no server round-trips | ✓ |
| Server-side search | URL-param based Prisma where clause — supports pagination |  |

**User's choice:** [auto] Client-side filter (recommended — 100-200 profiles max)
**Notes:** Dataset small enough that client-side is simpler and faster

---

## Query Optimization

| Option | Description | Selected |
|--------|-------------|----------|
| Prisma aggregations | Use _avg and _count for display, separate query for score computation | ✓ |
| Keep current approach | Fetch full review arrays as-is |  |

**User's choice:** [auto] Prisma aggregations (required by ROADMAP SC-5)
**Notes:** Must not fetch full review relation arrays for list rendering

---

## Empty States

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing pattern | Building2 icon + descriptive message, consistent with current empty state | ✓ |
| Custom illustration | New empty state with search-specific illustration |  |

**User's choice:** [auto] Reuse existing pattern (recommended default)
**Notes:** Existing empty state in profiles page is well-designed

---

## Claude's Discretion

- Prisma query shape and field selection
- Server/client component split for search filtering
- Animation timing
- Search debounce timing

## Deferred Ideas

- Google Maps thumbnails (out of scope per REQUIREMENTS.md)
- Profile sorting options
- Bulk card actions
