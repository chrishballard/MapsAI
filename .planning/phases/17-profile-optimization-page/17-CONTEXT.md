# Phase 17: Profile Optimization Page - Context

**Gathered:** 2026-04-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a per-profile optimization page at `/dashboard/optimization/[profileId]/` where users can see a radial score gauge (0-100%), individual audit cards per signal, and approve or ignore AI-generated suggestions — with bulk actions for efficiency. Adds sidebar navigation and entry points from existing business cards.

</domain>

<decisions>
## Implementation Decisions

### Score Gauge Visualization (OPT-01)
- **D-01:** Render the optimization score as a Recharts `RadialBarChart` — recharts is already installed (Phase 14), shadcn chart component available at `src/components/ui/chart.tsx`. Consistent with chart tooling used in Phase 18/19.
- **D-02:** Gauge shows numeric score center-label (e.g., "72%"), colored arc matching grade (green/amber/red per Phase 14 thresholds), and grade label beneath.

### Audit Card Layout (OPT-02)
- **D-03:** Display individual signal audit cards in a responsive grid (2-3 columns). Each card uses the existing Card component with a status-colored left border (green/amber/red matching `ScoreCheck.status`).
- **D-04:** Each card shows: signal name, current value, benchmark, status indicator, and plain-English recommendation from `ScoreCheck`. No interactive elements on audit cards — they're informational.
- **D-05:** Cards ordered by status priority: critical first, then warning, then good — so actionable items surface at the top.

### Suggestion Workflow Integration (OPT-03)
- **D-06:** Reuse the existing `ReoptimizeSection` approve/push workflow logic from `src/app/dashboard/profiles/[id]/reoptimize-section.tsx`. Extract shared approve/ignore/push API interactions rather than duplicating.
- **D-07:** Optimization page shows pending suggestions (descriptions, services) with approve/ignore buttons inline. Same API endpoints as v1.1 re-optimization flow.
- **D-08:** Only show suggestions section when there are pending (unapproved) items. If all approved/pushed, show a success state instead.

### Bulk Actions UX (OPT-04)
- **D-09:** Toolbar above suggestions section with "Approve All" and "Ignore All" buttons. Toolbar only appears when there are pending suggestions.
- **D-10:** Both bulk actions trigger a confirmation Dialog (existing `dialog.tsx` component) showing the count of pending items and the action about to be taken.
- **D-11:** After bulk action completes, show a toast or inline success message and refresh the suggestions list.

### Navigation & Entry Points
- **D-12:** Add "Optimization" item to sidebar `navItems` array in `src/components/sidebar.tsx`. Use a gauge-like icon (e.g., `Gauge` from lucide-react). Links to `/dashboard/optimization`.
- **D-13:** `/dashboard/optimization` (no profileId) shows a profile picker or redirects to the first profile — Claude's discretion on exact behavior.
- **D-14:** Score badge on business cards (Phase 15) becomes a clickable link to `/dashboard/optimization/[profileId]`.

### Claude's Discretion
- Exact Recharts RadialBarChart config (inner/outer radius, start/end angles, animation)
- Whether to extract ReoptimizeSection logic into shared hooks/utils or adapt inline
- Profile picker behavior on `/dashboard/optimization` (list, redirect, or selector)
- Skeleton shapes for Suspense fallbacks on the optimization page
- Whether audit cards and suggestions are separate Suspense boundaries or one
- Toast vs inline success message for bulk actions

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Score Library (Phase 14)
- `src/lib/optimization-score.ts` — `computeOptimizationScore(profile: ProfileInput)` returns `{ total, grade, checks }`. Each `ScoreCheck` has signal, score, max, status, value, benchmark, recommendation.
- `tests/lib/optimization-score.test.ts` — Test coverage showing expected inputs/outputs.

### Existing Re-optimization Workflow (v1.1)
- `src/app/dashboard/profiles/[id]/reoptimize-section.tsx` — Client component handling description and service approve/ignore/push. This is the primary code to reuse or extract from.
- `src/app/dashboard/profiles/[id]/page.tsx` — Profile detail page that hosts ReoptimizeSection.

### UI Components
- `src/components/ui/card.tsx` — Card component for audit cards.
- `src/components/ui/chart.tsx` — Shadcn chart primitives wrapping recharts.
- `src/components/ui/dialog.tsx` — Dialog component for bulk action confirmation.
- `src/components/ui/badge.tsx` — Badge component for status indicators.
- `src/components/ui/skeleton.tsx` — Skeleton component for Suspense fallbacks.

### Navigation
- `src/components/sidebar.tsx` — Sidebar with `navItems` array. Add Optimization entry here.
- `src/app/dashboard/profiles/page.tsx` — Business cards page where score badge should link to optimization.

### Data Models
- `prisma/schema.prisma` — Profile, ProfileDescription, ProfileService models. Check for approval/push status fields.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `computeOptimizationScore` (Phase 14): Returns full score breakdown with per-signal checks — directly feeds gauge + audit cards.
- `ReoptimizeSection`: Client component with description and service approve/ignore/push UI. Core logic reusable for OPT-03.
- `Card`, `Badge`, `Dialog`, `Skeleton`: All UI primitives needed are already available.
- `chart.tsx` (shadcn): Recharts wrapper components ready for RadialBarChart.
- `MotionDiv`: Entrance animation wrapper from `src/components/motion-wrapper.tsx`.

### Established Patterns
- **Suspense streaming**: Phase 16 split dashboard into async server sub-components with Skeleton fallbacks. Apply same pattern here.
- **Server + client split**: Server component fetches data, client component handles interactions (approve/ignore).
- **Business filtering**: `getSelectedProfileId()` from cookie — may inform default profile selection on `/dashboard/optimization`.
- **Score colors**: green (#22c55e) >= 70, amber (#f59e0b) 40-69, red (#ef4444) < 40 (Phase 15).

### Integration Points
- Sidebar `navItems` array: Add new entry.
- Profile detail page: Already includes ReoptimizeSection — optimization page is a dedicated view of similar data.
- Business cards page: Score badge needs to become a link.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 17-profile-optimization-page*
*Context gathered: 2026-04-03*
