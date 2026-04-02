# Phase 16: Dashboard Upgrades - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-02
**Phase:** 16-dashboard-upgrades
**Areas discussed:** Automations Feed Expansion, Task Types & Onboarding, Suspense Architecture, See Details Navigation
**Mode:** --auto (all decisions auto-selected)

---

## Automations Feed Expansion

| Option | Description | Selected |
|--------|-------------|----------|
| Same pattern as posts/reviews | Query ProfileDescription with status PUSHED, show as 'Pushed description' with profile name and timestamp | ✓ |
| Separate feed section | Show description pushes in a separate section from posts/reviews | |

**User's choice:** [auto] Same pattern as posts/reviews — merge all event types into a single chronological feed
**Notes:** Existing automations array pattern (map + sort + slice) extends naturally to include description push events. Increase limit from 10 to 20 per SC-1.

| Option | Description | Selected |
|--------|-------------|----------|
| Per-item "See details" link | Each row has a text link routing to the relevant section page | ✓ |
| Row-click navigation | Entire row is clickable | |
| Keep current "View All" only | Only header link, no per-item links | |

**User's choice:** [auto] Per-item "See details" text link — matches SC-1 wording
**Notes:** Routes: posts→/dashboard/posts, reviews→/dashboard/reviews, descriptions→/dashboard/profiles/[profileId]

---

## Task Types & Onboarding

| Option | Description | Selected |
|--------|-------------|----------|
| Add onboarding tasks | Profiles without completed onboarding appear as "Start Onboarding" tasks | ✓ |
| Posts and reviews only | Keep current two task types | |

**User's choice:** [auto] Add onboarding tasks — DASH-02 mentions "profiles needing onboarding" as a task type
**Notes:** Links to /dashboard/onboarding/[id]. Detection logic for onboarding completeness left to Claude's discretion.

---

## Suspense Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| 3 Suspense boundaries | Split into StatsGrid, AutomationsFeed, TasksSection async components | ✓ |
| Full page skeleton | Single Suspense boundary wrapping entire page | |
| Per-widget granular | Each individual stat card, feed item wrapped separately | |

**User's choice:** [auto] 3 Suspense boundaries — balanced granularity, prevents blocking while keeping code manageable
**Notes:** AI Insights and CTA stay inline since they depend on already-fetched stats data. Skeleton fallbacks use existing skeleton.tsx component.

---

## Claude's Discretion

- Prisma query shapes for description push events and onboarding detection
- Skeleton layout details (placeholder dimensions and counts)
- File organization (separate files vs named exports)
- Animation timing for new components
- Onboarding completeness detection approach

## Deferred Ideas

None — all discussion stayed within phase scope
