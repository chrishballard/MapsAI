# Phase 16: Dashboard Upgrades - Context

**Gathered:** 2026-04-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Enhance the existing dashboard page with an expanded automations feed (20 items including description pushes), enriched tasks table (including onboarding tasks), progressive Suspense loading with skeleton fallbacks, and verification that the existing business filter covers all widgets. No new routes — upgrades to `src/app/dashboard/page.tsx` and its child components.

</domain>

<decisions>
## Implementation Decisions

### Automations Feed (DASH-01)
- **D-01:** Expand feed from 10 to 20 items, merging posts (published/approved/scheduled), review responses (published/approved), and description pushes (status PUSHED) — sorted by timestamp descending.
- **D-02:** Add ProfileDescription push events by querying `ProfileDescription` where `pushedAt IS NOT NULL`, mapped to automation items with label "Pushed description" and profile name.
- **D-03:** Each automation row gets a per-item "See details" text link (not just the header "View All"). Links route to: posts→`/dashboard/posts`, reviews→`/dashboard/reviews`, descriptions→`/dashboard/profiles/[profileId]`.

### Tasks Table (DASH-02)
- **D-04:** Add "profiles needing onboarding" as a task type alongside existing approve_post and approve_review_reply. Show profiles where onboarding is incomplete with "Start Onboarding" action linking to `/dashboard/onboarding/[id]`.
- **D-05:** Task type labels: "Approve Post", "Approve Review Reply", "Start Onboarding". Each shows due date, business name, task type badge, and action button.

### Business Filter (DASH-03)
- **D-06:** BusinessSelector already exists in topbar and dashboard page already uses `getSelectedProfileId()` with `profileFilter`. Verify all new/updated widgets (automations feed, tasks table, stats) respect the filter. No new UI needed — just ensure filter coverage is complete.

### Suspense Loading (SC-4)
- **D-07:** Split the monolithic dashboard server component into 3 async server sub-components: StatsGrid, AutomationsFeed, TasksSection. Each wrapped in React Suspense with Skeleton fallbacks.
- **D-08:** AI Insights panel stays inline (uses data already available from other queries or can be co-located with stats). Get Started CTA stays inline.
- **D-09:** Use existing `skeleton.tsx` component for loading fallbacks. Each skeleton matches the visual shape of its loaded counterpart (stat cards, feed rows, table rows).

### Claude's Discretion
- Exact Prisma query shapes for description push events and onboarding status detection
- Skeleton component layout details (number of placeholder rows, dimensions)
- Whether to extract stats/automations/tasks into separate files or keep as named exports in same file
- MotionDiv animation timing for new components
- Whether onboarding completeness is determined by a flag on Profile or by checking wizard step completion

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Current Dashboard Implementation
- `src/app/dashboard/page.tsx` — Main dashboard page with stats grid, automations feed, tasks, AI insights, CTA. This is the primary file being enhanced.
- `src/app/dashboard/tasks-table.tsx` — TasksTable client component with approve/delete dialog. Needs new "onboarding" task type.
- `src/components/business-selector.tsx` — BusinessSelector dropdown in topbar. Already sets cookie and triggers router.refresh().
- `src/lib/selected-profile.ts` — Server-side helper to read selected profile ID from cookie.

### UI Components
- `src/components/ui/skeleton.tsx` — Skeleton loading component for Suspense fallbacks.
- `src/components/ui/card.tsx` — Card component used throughout dashboard.
- `src/components/ui/badge.tsx` — Badge component for task types and status indicators.
- `src/components/ui/table.tsx` — Table components used by TasksTable.
- `src/components/motion-wrapper.tsx` — MotionDiv wrapper for entrance animations.

### Data Models
- `prisma/schema.prisma` — Profile, Post, Review, ReviewResponse, ProfileDescription models. Check for `pushedAt` field on ProfileDescription and onboarding completion tracking.

### Phase 14 Score Library
- `src/lib/optimization-score.ts` — Score function, may be relevant if stats grid shows optimization data.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `TasksTable` component: Already implements due date, business name, task type badge, action button, approve/delete dialogs. Extend with new task type.
- `BusinessSelector`: Fully functional dropdown with search, profile list, cookie-based selection. No changes needed.
- `getSelectedProfileId()`: Server-side cookie reader. Already used in dashboard for filtering.
- `Skeleton` component: Available for Suspense fallbacks.
- `MotionDiv`: Entrance animation wrapper used on dashboard page and stat cards.

### Established Patterns
- **Data fetching**: Server component with `Promise.all` for parallel Prisma queries, data passed to client components as props.
- **Business filtering**: `profileFilter` object constructed from `getSelectedProfileId()`, spread into Prisma `where` clauses.
- **Styling**: Tailwind CSS with zinc neutrals, brand-* color tokens, Card/Badge/Table shadcn components.
- **Animation**: MotionDiv with `opacity: 0, y: 10→0` entrance, staggered delays on grid items.

### Integration Points
- Dashboard page imports from `tasks-table.tsx` — TasksTable component and TaskItem type
- Layout renders BusinessSelector in topbar — already integrated
- Automations feed currently queries Post and ReviewResponse models — needs to add ProfileDescription

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. The existing dashboard is well-structured and the upgrades are incremental enhancements to existing patterns.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 16-dashboard-upgrades*
*Context gathered: 2026-04-02*
