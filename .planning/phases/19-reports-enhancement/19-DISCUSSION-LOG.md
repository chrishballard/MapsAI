# Phase 19: Reports Enhancement - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-03
**Phase:** 19-reports-enhancement
**Areas discussed:** Page Architecture, Date Range Controls, Metric Cards & Sparklines, Actions Log Format, AI Narrative Placement, PDF Export Approach
**Mode:** Auto (all recommended defaults selected)

---

## Page Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Replace existing page | Transform `/dashboard/reports` into interactive dashboard, keep generate/download as collapsible section | :white_check_mark: |
| New route alongside | Add `/dashboard/reports/metrics` like Phase 18 did for reviews | |
| Tab toggle | Tab between "Dashboard" and "Generated Reports" views | |

**User's choice:** Replace existing page (auto-selected recommended default)
**Notes:** Existing page is minimal (generate form + download list) — not enough value to preserve as standalone view.

---

## Date Range Controls

| Option | Description | Selected |
|--------|-------------|----------|
| Preset buttons | 7d, 30d, 90d, custom — simple, covers most use cases | :white_check_mark: |
| Calendar date picker | Start/end date pickers with calendar UI | |
| Month picker | Match existing generate form's month input | |

**User's choice:** Preset buttons (auto-selected recommended default)
**Notes:** Period-over-period comparison uses preceding equal-length window automatically.

---

## Metric Cards & Sparklines

| Option | Description | Selected |
|--------|-------------|----------|
| Individual cards with sparklines | Each metric in its own card with value, % change, and mini chart | :white_check_mark: |
| Compact stat row | Dense row without sparklines | |
| Cards with mini bar charts | Bar charts instead of line sparklines | |

**User's choice:** Individual cards with sparklines (auto-selected recommended default)
**Notes:** Directly matches RPT-03/04/05 requirements specifying sparkline charts.

---

## Actions Log Format

| Option | Description | Selected |
|--------|-------------|----------|
| Timeline/feed | Chronological feed matching Phase 16 automations pattern | :white_check_mark: |
| Simple table | Columns: date, type, business, details | |
| Grouped by type | Actions grouped by category (posts, reviews, optimizations) | |

**User's choice:** Timeline/feed format (auto-selected recommended default)
**Notes:** Consistent with established automations feed UI pattern from Phase 16.

---

## AI Narrative Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Top callout banner | Styled card below date range, above charts — first thing users see | :white_check_mark: |
| Bottom summary | Summary section after all data | |
| Collapsible section | Below date range, can be collapsed | |

**User's choice:** Top callout banner (auto-selected recommended default)
**Notes:** Executive summary sets context for all the data below.

---

## PDF Export Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Enhance existing template | Extend report-generator.ts and report-template.tsx with new sections | :white_check_mark: |
| HTML-to-PDF | Use puppeteer/playwright to screenshot the dashboard | |
| New template alongside | Separate "enhanced report" template | |

**User's choice:** Enhance existing template (auto-selected recommended default)
**Notes:** Existing infrastructure works. chart.js server-side rendering handles PDF charts.

---

## Claude's Discretion

- Recharts sparkline configuration details
- Suspense boundary strategy
- Date range state management (URL params vs React state)
- MotionDiv animation timing
- AI narrative prompt engineering and caching
- Skeleton shapes for loading states

## Deferred Ideas

None — discussion stayed within phase scope.
