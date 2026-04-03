# Phase 17: Profile Optimization Page - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-03
**Phase:** 17-profile-optimization-page
**Areas discussed:** Score Gauge Visualization, Audit Card Layout, Suggestion Workflow Integration, Bulk Actions UX, Navigation & Entry Points
**Mode:** --auto (all decisions auto-selected)

---

## Score Gauge Visualization

| Option | Description | Selected |
|--------|-------------|----------|
| Recharts RadialBarChart | Reuses installed recharts + shadcn chart, consistent with Phase 18/19 | ✓ |
| Custom SVG gauge | Full control but more code, no library reuse | |
| CSS-only circular progress | Lightweight but limited animation/interactivity | |

**User's choice:** [auto] Recharts RadialBarChart (recommended default)
**Notes:** recharts already installed via Phase 14 deps, shadcn chart wrapper available.

---

## Audit Card Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Grid with status-colored left border | Reuses Card component, visual hierarchy from border color | ✓ |
| Accordion per signal | Collapsible, saves space but hides info | |
| Table rows | Compact but less visual impact | |

**User's choice:** [auto] Grid with status-colored left border (recommended default)
**Notes:** Card component exists with rounded/shadow variants. Status colors match Phase 14 grade colors.

---

## Suggestion Workflow Integration

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse ReoptimizeSection logic | Extract shared approve/push interactions, avoid duplication | ✓ |
| Build from scratch | Clean slate but duplicates v1.1 work | |
| Embed ReoptimizeSection directly | Quick but tightly couples to profile detail page layout | |

**User's choice:** [auto] Reuse ReoptimizeSection logic (recommended default)
**Notes:** v1.1 workflow handles descriptions and services. Extract shared logic for optimization page.

---

## Bulk Actions UX

| Option | Description | Selected |
|--------|-------------|----------|
| Toolbar with Approve All / Ignore All + confirmation dialog | Simple, uses existing Dialog component | ✓ |
| Checkbox selection + batch action | More granular but more complex, OPT-04 says "all" not "selected" | |
| Floating action bar | Appears on scroll, modern but over-engineered for this use case | |

**User's choice:** [auto] Toolbar with confirmation dialog (recommended default)
**Notes:** OPT-04 requirement says "bulk approve all" and "bulk ignore all" — two simple buttons with confirmation.

---

## Navigation & Entry Points

| Option | Description | Selected |
|--------|-------------|----------|
| Sidebar nav item + score badge link | Two entry points: sidebar for direct nav, badge for contextual | ✓ |
| Sidebar only | Single entry point, simpler but less discoverable from cards | |
| Profile detail page tab | Keeps optimization within profile context, no new route | |

**User's choice:** [auto] Sidebar nav item + score badge link (recommended default)
**Notes:** Sidebar navItems array is straightforward to extend. Score badge on cards becomes a natural entry point.

---

## Claude's Discretion

- Recharts RadialBarChart configuration details
- ReoptimizeSection logic extraction approach
- Profile picker behavior on `/dashboard/optimization`
- Skeleton fallback shapes
- Suspense boundary granularity
- Toast vs inline success messaging

## Deferred Ideas

None — auto mode stayed within phase scope.
