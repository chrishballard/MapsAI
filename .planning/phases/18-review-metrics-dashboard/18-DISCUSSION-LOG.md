# Phase 18: Review Metrics Dashboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-03
**Phase:** 18-review-metrics-dashboard
**Areas discussed:** Page Location & Navigation, Chart Styling & Layout, Recency Thresholds, Data Sync Label Pattern
**Mode:** --auto (all decisions auto-selected with recommended defaults)

---

## Page Location & Navigation

| Option | Description | Selected |
|--------|-------------|----------|
| Sub-route `/dashboard/reviews/metrics` | Groups review pages together, tab toggle between list and metrics | ✓ |
| Separate top-level `/dashboard/review-metrics` | Standalone page, separate sidebar entry | |
| Sub-section on existing reviews page | Add charts below the review list | |

**User's choice:** [auto] Sub-route under reviews (recommended default)
**Notes:** Keeps review-related pages grouped. Existing list stays at `/dashboard/reviews`, analytics at `/dashboard/reviews/metrics`.

---

## Chart Styling & Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Summary cards row + charts grid below | Top stat cards, 2-column chart grid below | ✓ |
| Single-column stacked layout | All widgets in a single column | |
| Tab-based sections | Separate tabs for overview, distribution, trends | |

**User's choice:** [auto] Summary cards row + charts grid (recommended default)
**Notes:** Matches common analytics dashboard pattern. Consistent with dashboard page layout conventions.

---

## Recency Thresholds

| Option | Description | Selected |
|--------|-------------|----------|
| Good ≤14d, Warning 15-30d, Critical >30d | Standard thresholds for local business review cadence | ✓ |
| Good ≤7d, Warning 8-21d, Critical >21d | Aggressive — may cause too many warnings | |
| Good ≤30d, Warning 31-60d, Critical >60d | Lenient — may miss stale profiles | |

**User's choice:** [auto] 14/30 day thresholds (recommended default)
**Notes:** 2 weeks without a review is normal for local businesses; a month signals attention needed. Aligns with green/amber/red pattern from optimization scoring.

---

## Data Sync Label Pattern

| Option | Description | Selected |
|--------|-------------|----------|
| Single page-level subtitle | One "Data through [date]" below page heading | ✓ |
| Per-chart label | Each chart shows its own data-through label | |
| Footer label | Single label at bottom of page | |

**User's choice:** [auto] Single page-level subtitle (recommended default)
**Notes:** All data comes from same sync, so one label is sufficient and cleaner.

---

## Claude's Discretion

- Exact Recharts configuration (margins, ticks, tooltips, legend)
- Stat card component design (reuse Card or create MetricCard)
- Skeleton fallback shapes and Suspense boundary strategy
- MotionDiv animation timing
- Zero-reviews empty state messaging

## Deferred Ideas

None — RVMT-06/07/08 already deferred to v1.3+ in REQUIREMENTS.md.
