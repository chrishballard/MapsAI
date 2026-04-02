# Phase 16: Dashboard Upgrades - Research

**Researched:** 2026-04-02
**Domain:** Next.js App Router server components, React Suspense, Prisma query composition
**Confidence:** HIGH

## Summary

Phase 16 is an incremental upgrade to `src/app/dashboard/page.tsx`. The three changes are well-bounded: expand the automations feed (10 → 20 items, add description pushes), extend the tasks table (add onboarding task type), and split the monolithic server component into three async sub-components wrapped in React Suspense with skeleton fallbacks. No new routes, no new npm packages, no schema migrations.

The codebase is already structured exactly as needed: `getSelectedProfileId()` feeds a `profileFilter` object that is spread into Prisma `where` clauses, `Skeleton` and `MotionDiv` exist, and `TasksTable` is already a client component. The onboarding filter can be resolved cleanly via `Profile.isOnboarded` flag or by joining `OnboardingProgress.isComplete` — both exist in the schema. The primary unknowns are Suspense boundary placement (server component tree vs. streaming) and which field on Profile/OnboardingProgress definitively signals "needs onboarding."

**Primary recommendation:** Split `DashboardPage` into three async sub-components (`StatsGrid`, `AutomationsFeed`, `TasksSection`), query description pushes via `ProfileDescription` where `pushedAt IS NOT NULL`, and detect onboarding need via `Profile.isOnboarded = false`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Expand feed from 10 to 20 items, merging posts (published/approved/scheduled), review responses (published/approved), and description pushes (status PUSHED) — sorted by timestamp descending.
- **D-02:** Add ProfileDescription push events by querying `ProfileDescription` where `pushedAt IS NOT NULL`, mapped to automation items with label "Pushed description" and profile name.
- **D-03:** Each automation row gets a per-item "See details" text link (not just the header "View All"). Links route to: posts→`/dashboard/posts`, reviews→`/dashboard/reviews`, descriptions→`/dashboard/profiles/[profileId]`.
- **D-04:** Add "profiles needing onboarding" as a task type alongside existing approve_post and approve_review_reply. Show profiles where onboarding is incomplete with "Start Onboarding" action linking to `/dashboard/onboarding/[id]`.
- **D-05:** Task type labels: "Approve Post", "Approve Review Reply", "Start Onboarding". Each shows due date, business name, task type badge, and action button.
- **D-06:** BusinessSelector already exists in topbar and dashboard page already uses `getSelectedProfileId()` with `profileFilter`. Verify all new/updated widgets (automations feed, tasks table, stats) respect the filter. No new UI needed — just ensure filter coverage is complete.
- **D-07:** Split the monolithic dashboard server component into 3 async server sub-components: StatsGrid, AutomationsFeed, TasksSection. Each wrapped in React Suspense with Skeleton fallbacks.
- **D-08:** AI Insights panel stays inline (uses data already available from other queries or can be co-located with stats). Get Started CTA stays inline.
- **D-09:** Use existing `skeleton.tsx` component for loading fallbacks. Each skeleton matches the visual shape of its loaded counterpart (stat cards, feed rows, table rows).

### Claude's Discretion
- Exact Prisma query shapes for description push events and onboarding status detection
- Skeleton component layout details (number of placeholder rows, dimensions)
- Whether to extract stats/automations/tasks into separate files or named exports in same file
- MotionDiv animation timing for new components
- Whether onboarding completeness is determined by a flag on Profile or by checking wizard step completion

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DASH-01 | User can see a recent automations feed showing last 20 automated actions (posts published, reviews responded, descriptions pushed) with timestamps and "See details" links | Prisma merge-sort pattern identified; `ProfileDescription.pushedAt` field confirmed in schema |
| DASH-02 | User can see a My Tasks table showing pending items (approve posts, review responses, profiles needing onboarding) with due date, business, task type, and action button | `TasksTable` already handles approve_post/approve_review_reply; `Profile.isOnboarded` flag confirmed for onboarding detection; `onboarding/[profileId]` route exists |
| DASH-03 | User can filter all dashboard data by selecting a specific business profile from the header dropdown | `getSelectedProfileId()` + `profileFilter` pattern already used throughout; description and onboarding queries need same treatment verified |
</phase_requirements>

## Standard Stack

### Core (no new packages — all already installed)
| Library | Version (installed) | Purpose | Why Standard |
|---------|---------------------|---------|--------------|
| next | 14+ (App Router) | Server components, Suspense streaming | Project foundation |
| react | 18+ | Suspense, async server components | Project foundation |
| @prisma/client | Installed | ORM queries | Project foundation |
| motion/react | Installed | MotionDiv entrance animations | Established pattern in project |

### UI Components (all exist in project)
| Component | File | Purpose |
|-----------|------|---------|
| Skeleton | `src/components/ui/skeleton.tsx` | Suspense fallbacks — `animate-pulse rounded-md bg-muted` |
| Card, CardHeader, CardContent | `src/components/ui/card.tsx` | Widget containers |
| Badge | `src/components/ui/badge.tsx` | Task type badges |
| Table, TableBody, etc. | `src/components/ui/table.tsx` | TasksTable structure |
| MotionDiv | `src/components/motion-wrapper.tsx` | Entrance animations |

**Installation:** No new packages needed.

## Architecture Patterns

### Recommended Project Structure

No new files required. The upgrade touches two files and may extract sub-components:

```
src/app/dashboard/
├── page.tsx            — Refactored: thin shell + 3 Suspense boundaries + inline AI panel + CTA
├── tasks-table.tsx     — Extended: new "start_onboarding" task type added
├── stats-grid.tsx      — NEW (or named export from page.tsx): async server component
├── automations-feed.tsx — NEW (or named export from page.tsx): async server component
└── tasks-section.tsx   — NEW (or named export from page.tsx): async server component
```

Decision on file vs. named export is Claude's discretion. Separate files are preferred for readability given all three have non-trivial query logic.

### Pattern 1: Async Sub-Component with Suspense Boundary

**What:** An async server component performs its own Prisma queries. The parent wraps it in `<Suspense fallback={<SkeletonShape />}>`. Next.js streams each boundary independently.

**When to use:** Any async server component where the query might be slow enough to delay the full page paint. Separating StatsGrid, AutomationsFeed, and TasksSection means each streams in independently.

```typescript
// In page.tsx (the shell)
import { Suspense } from "react";

export default async function DashboardPage() {
  return (
    <MotionDiv initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      {/* Header stays synchronous */}
      <DashboardHeader />

      <Suspense fallback={<StatsGridSkeleton />}>
        <StatsGrid />
      </Suspense>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Suspense fallback={<AutomationsFeedSkeleton />}>
            <AutomationsFeed />
          </Suspense>
          <Suspense fallback={<TasksSectionSkeleton />}>
            <TasksSection />
          </Suspense>
        </div>
        {/* AI Insights panel — inline, uses pendingReviews/postsThisMonth from StatsGrid or co-located query */}
        <AIInsightsPanel />
      </div>
    </MotionDiv>
  );
}
```

**Important:** `DashboardHeader` needs `selectedProfile` name for the h1. This single `getSelectedProfileId()` call + one `profile.findUnique` can remain synchronous in the shell — it's fast and needed for the title. All heavy multi-table queries move into sub-components.

### Pattern 2: Automations Feed — Merge-Sort 3 Sources

Current code merges posts + reviewResponses and slices to 10. The extension adds ProfileDescription pushes.

```typescript
// In automations-feed.tsx
const selectedProfileId = await getSelectedProfileId();
const profileFilter = selectedProfileId ? { profileId: selectedProfileId } : {};

const [recentPosts, recentResponses, recentDescriptions] = await Promise.all([
  prisma.post.findMany({
    where: { ...profileFilter, status: { in: ["PUBLISHED", "APPROVED", "SCHEDULED"] } },
    take: 20,
    orderBy: { updatedAt: "desc" },
    include: { profile: { select: { name: true } } },
  }),
  prisma.reviewResponse.findMany({
    where: {
      status: { in: ["PUBLISHED", "APPROVED"] },
      ...(selectedProfileId ? { review: { profileId: selectedProfileId } } : {}),
    },
    take: 20,
    orderBy: { updatedAt: "desc" },
    include: { review: { select: { profileId: true, profile: { select: { name: true } } } } },
  }),
  prisma.profileDescription.findMany({
    where: { ...profileFilter, pushedAt: { not: null } },
    take: 20,
    orderBy: { pushedAt: "desc" },
    include: { profile: { select: { name: true } } },
  }),
]);
```

Note: `ReviewResponse` does not have a direct `profileId` field — the filter must go via `review: { profileId: selectedProfileId }`. This is already the pattern in the current code (line 100-103 of page.tsx) and must be preserved.

After mapping all three sources to a common `AutomationItem` type, sort descending by timestamp and `.slice(0, 20)`.

The `AutomationItem` type needs a `detailHref` field to support D-03 per-row "See details" links:

```typescript
type AutomationItem = {
  id: string;
  label: string;
  profileName: string;
  time: Date;
  type: "post" | "review_reply" | "description";
  detailHref: string;  // NEW: per-row destination
};
```

Description items route to `/dashboard/profiles/${profileId}`.

### Pattern 3: Onboarding Tasks — Profile.isOnboarded Flag

The schema has two mechanisms for detecting incomplete onboarding:
1. `Profile.isOnboarded: Boolean @default(false)` — simple flag, always present
2. `OnboardingProgress.isComplete: Boolean @default(false)` — exists only if onboarding was started

**Recommended approach (Claude's discretion, choosing `Profile.isOnboarded`):** Query profiles directly where `isOnboarded = false`. This covers profiles that never started onboarding (no `OnboardingProgress` record at all) without a left join. It's the simplest and most inclusive filter.

```typescript
// In tasks-section.tsx — onboarding tasks query
const incompleteProfiles = await prisma.profile.findMany({
  where: {
    isOnboarded: false,
    ...(selectedProfileId ? { id: selectedProfileId } : {}),
  },
  select: { id: true, name: true, createdAt: true },
  orderBy: { createdAt: "asc" },
});
```

These map to tasks with `type: "start_onboarding"`, `dueDate: formatDueDate(profile.createdAt)`, and action link `/dashboard/onboarding/${profile.id}`.

The onboarding route is confirmed at `src/app/dashboard/onboarding/[profileId]/page.tsx` (the route param is `profileId`, not `id`).

### Pattern 4: TasksTable Extension

`TaskItem` interface must be extended with the new task type:

```typescript
// In tasks-table.tsx
export interface TaskItem {
  id: string;
  type: "approve_post" | "approve_review_reply" | "start_onboarding";  // EXTENDED
  profileName: string;
  dueDate: string;
  // ... existing optional fields unchanged
  // start_onboarding uses only: id, profileName, dueDate
}
```

`taskLabel()` switch needs a `"start_onboarding"` case returning `"Start Onboarding"`.

The action button for `start_onboarding` is a navigation Link (not an approve/delete API call), so `TasksTable` needs a branch: if `task.type === "start_onboarding"`, render a `<Link href={...}>Start Onboarding</Link>` button instead of calling `setSelectedTask(task)`. No dialog needed for this type.

### Pattern 5: Skeleton Fallback Shapes

The existing `Skeleton` component is `animate-pulse rounded-md bg-muted`. Build three skeleton components matching visual shapes:

```tsx
// StatsGridSkeleton — 4 card placeholders
function StatsGridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {[...Array(4)].map((_, i) => (
        <Skeleton key={i} className="h-32 w-full rounded-xl" />
      ))}
    </div>
  );
}

// AutomationsFeedSkeleton — card with 5 row placeholders
function AutomationsFeedSkeleton() {
  return (
    <Card>
      <CardHeader><Skeleton className="h-6 w-40" /></CardHeader>
      <CardContent className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </CardContent>
    </Card>
  );
}

// TasksSectionSkeleton — heading + table rows
function TasksSectionSkeleton() {
  return (
    <div>
      <Skeleton className="h-6 w-24 mb-4" />
      <Card>
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-none border-b last:border-b-0" />
        ))}
      </Card>
    </div>
  );
}
```

### Anti-Patterns to Avoid

- **Placing `getSelectedProfileId()` inside each sub-component independently:** Each async server component will call `cookies()`. This is fine in Next.js — `cookies()` is a cached request-scoped store. No performance penalty.
- **Passing `profileFilter` from parent to child via props:** Sub-components are server components; they cannot receive server-only values as props from the shell without making the shell also await everything (defeating Suspense). Each sub-component must call `getSelectedProfileId()` itself.
- **Using a client-side ReviewResponse `profileId` filter:** `ReviewResponse` has no direct `profileId`. The filter must nest via `review: { profileId: selectedProfileId }`. The current code does this correctly; any refactor must preserve this.
- **Forgetting the `describe` push sort key:** Description records should be sorted by `pushedAt` desc, not `updatedAt` (which may differ). The `time` field on the merged AutomationItem should be `pushedAt` for descriptions.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Loading state animation | Custom CSS keyframe pulser | `Skeleton` component (`src/components/ui/skeleton.tsx`) | Already exists, matches design system, `animate-pulse` is Tailwind-native |
| Business filter state | React context / global store | `getSelectedProfileId()` cookie reader | Already established pattern, works with `router.refresh()` on selection |
| Sort/merge of 3 arrays | Custom heapsort | JS `.sort()` after concat — O(n log n) on ≤60 items | Negligible cost at this data size |
| Entrance animations | Raw framer-motion | `MotionDiv` wrapper from `motion-wrapper.tsx` | Project abstraction already in place |

**Key insight:** Every building block this phase needs already exists in the codebase. The task is purely assembly and refactoring.

## Common Pitfalls

### Pitfall 1: Suspense boundary doesn't stream because parent awaits first
**What goes wrong:** If the shell `DashboardPage` awaits any async call before rendering children, Next.js will not start streaming until that await resolves — negating the Suspense benefit.
**Why it happens:** Mixing `await` at the shell level with Suspense children.
**How to avoid:** The shell should only perform synchronous or cookie reads (e.g., `getSelectedProfileId()` + one `findUnique` for `selectedProfile.name`). All Prisma aggregation queries move into sub-components.
**Warning signs:** Page feels like it still blocks on slowest query even after adding Suspense.

### Pitfall 2: ReviewResponse profileId filter — wrong nesting
**What goes wrong:** Writing `{ ...profileFilter, ... }` where `profileFilter = { profileId: selectedProfileId }` for a `ReviewResponse` query. `ReviewResponse` has no `profileId` column — Prisma will throw a type error or silently ignore.
**Why it happens:** Copy-paste from Post/Profile queries where `profileId` is a direct column.
**How to avoid:** Always use `review: { profileId: selectedProfileId }` for ReviewResponse filters.
**Warning signs:** TypeScript error on the query, or results not filtering correctly.

### Pitfall 3: `start_onboarding` tasks open the approve dialog
**What goes wrong:** `TasksTable` currently routes all row button clicks to `setSelectedTask(task)`, which opens the review/approve dialog. An onboarding task has no content to review.
**Why it happens:** The dialog handler doesn't branch on task type.
**How to avoid:** In the `TasksTable` action column, check `task.type === "start_onboarding"` and render a `<Link>` directly instead of `<Button onClick={() => setSelectedTask(task)}>`. The dialog should never open for onboarding tasks.
**Warning signs:** Clicking "Start Onboarding" opens a blank/broken dialog instead of navigating.

### Pitfall 4: Onboarding route param mismatch
**What goes wrong:** Linking to `/dashboard/onboarding/[id]` when the actual route segment is `[profileId]`.
**Why it happens:** Guessing route param name without checking the filesystem.
**How to avoid:** Confirmed — the route is `src/app/dashboard/onboarding/[profileId]/page.tsx`. Use `/dashboard/onboarding/${profile.id}` in the link. The folder name `[profileId]` is the segment name but the URL uses the actual ID value.
**Warning signs:** 404 on navigation to onboarding from task.

### Pitfall 5: Description automations sorted by `updatedAt` instead of `pushedAt`
**What goes wrong:** Descriptions appear out-of-order in the merged feed because `updatedAt` may have changed after the push (e.g., re-approval).
**Why it happens:** Following the posts/reviews pattern which uses `updatedAt`.
**How to avoid:** Sort descriptions by `pushedAt` in both the Prisma query (`orderBy: { pushedAt: "desc" }`) and use `pushedAt` as the `time` field in the merged `AutomationItem`.
**Warning signs:** "Pushed description" items appear at incorrect positions in the feed timeline.

## Code Examples

### AutomationItem Type Extension
```typescript
// Replace existing local type in automations-feed.tsx (or page.tsx)
type AutomationItem = {
  id: string;
  label: string;
  profileName: string;
  profileId: string;   // needed for description detailHref
  time: Date;
  type: "post" | "review_reply" | "description";
  detailHref: string;  // per-row navigation target (D-03)
};
```

### Description Push Query (D-02)
```typescript
prisma.profileDescription.findMany({
  where: {
    pushedAt: { not: null },
    ...(selectedProfileId ? { profileId: selectedProfileId } : {}),
  },
  take: 20,
  orderBy: { pushedAt: "desc" },
  include: { profile: { select: { id: true, name: true } } },
})
```

### Onboarding Incomplete Query (D-04)
```typescript
prisma.profile.findMany({
  where: {
    isOnboarded: false,
    ...(selectedProfileId ? { id: selectedProfileId } : {}),
  },
  select: { id: true, name: true, createdAt: true },
  orderBy: { createdAt: "asc" },
})
```

### TaskItem Interface Extension
```typescript
// tasks-table.tsx
export interface TaskItem {
  id: string;
  type: "approve_post" | "approve_review_reply" | "start_onboarding";
  profileName: string;
  dueDate: string;
  // approve_post fields
  postContent?: string;
  postType?: string;
  callToAction?: string;
  // approve_review_reply fields
  reviewerName?: string;
  rating?: number;
  comment?: string;
  responseContent?: string;
  // start_onboarding has no additional fields; uses id, profileName, dueDate
}
```

### taskLabel() Extension
```typescript
function taskLabel(type: TaskItem["type"]): string {
  switch (type) {
    case "approve_post":
      return "Approve Post";
    case "approve_review_reply":
      return "Approve Review Reply";
    case "start_onboarding":
      return "Start Onboarding";
  }
}
```

### Action Button Branch in TasksTable
```tsx
// In the Action <TableCell>:
{task.type === "start_onboarding" ? (
  <Link
    href={`/dashboard/onboarding/${task.id}`}
    className={buttonVariants({ variant: "outline", size: "sm" })}
  >
    Start
  </Link>
) : (
  <Button variant="outline" size="sm" onClick={() => setSelectedTask(task)}>
    Review
  </Button>
)}
```

### See Details Link per Automation Row (D-03)
```tsx
// Replace the MoreHorizontal ghost icon button:
<Link
  href={item.detailHref}
  className="text-xs font-medium text-brand-600 hover:text-brand-700 opacity-0 group-hover:opacity-100 transition-opacity"
>
  See details
</Link>
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Single monolithic `async` server component with all queries | Multiple async sub-components each wrapped in Suspense | Streaming: page header renders immediately, widgets load progressively |
| 10-item feed sliced from posts + reviews | 20-item feed from posts + reviews + descriptions, merge-sorted | More actionable feed, description pushes visible |
| Tasks: approve_post + approve_review_reply | + start_onboarding | Onboarding gaps surfaced on dashboard |

## Open Questions

1. **AI Insights panel data dependency after refactor**
   - What we know: Panel currently uses `pendingReviews` and `postsThisMonth` from the monolithic page. After splitting StatsGrid into its own async component, those values no longer exist in the shell.
   - What's unclear: Should AIInsightsPanel be its own async sub-component (with its own queries), or should it be co-located with StatsGrid and receive props?
   - Recommendation: Make AIInsightsPanel a small async sub-component co-located in the same file as StatsGrid, or query its 2 values directly inside it. The queries are trivial (2 counts). No need to pass data cross-boundary.

2. **DashboardHeader — selectedProfile name**
   - What we know: The h1 currently shows `selectedProfile.name` or "Dashboard". This requires one `prisma.profile.findUnique` in the shell before any streaming.
   - What's unclear: D-07 says to split into 3 sub-components; header is not explicitly mentioned.
   - Recommendation: Keep `getSelectedProfileId()` + `profile.findUnique` in the shell — it's a single fast lookup by primary key and the header must render before anything else anyway. This does not block sub-component streaming.

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — all changes are code/config within the existing Next.js + Prisma + PostgreSQL stack already in use).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (vitest.config.mts) |
| Config file | `vitest.config.mts` |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DASH-01 | `buildAutomationsItems()` merges posts + reviews + descriptions, sorts by time desc, slices to 20 | unit | `npm test -- tests/app/dashboard-automations.test.ts` | ❌ Wave 0 |
| DASH-02 | `buildTaskItems()` includes start_onboarding entries from incomplete profiles | unit | `npm test -- tests/app/dashboard-tasks.test.ts` | ❌ Wave 0 |
| DASH-03 | `profileFilter` applied consistently to all 3 data sources (tested via query shape, not live DB) | unit | same file as DASH-01/02 | ❌ Wave 0 |

Note: The `taskLabel()` and `AutomationItem` type changes are type-level — caught by TypeScript compilation. Functional tests cover the merge/sort logic and filter application.

### Sampling Rate
- **Per task commit:** `npm test`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/app/dashboard-automations.test.ts` — covers DASH-01, DASH-03 (merging 3 sources, sort, slice, profileFilter)
- [ ] `tests/app/dashboard-tasks.test.ts` — covers DASH-02 (onboarding task type added, taskLabel mapping)

## Sources

### Primary (HIGH confidence)
- `src/app/dashboard/page.tsx` — full read, current implementation verified
- `src/app/dashboard/tasks-table.tsx` — full read, TaskItem interface and dialog logic verified
- `prisma/schema.prisma` — full read; `ProfileDescription.pushedAt`, `Profile.isOnboarded`, `OnboardingProgress.isComplete` all confirmed present
- `src/lib/selected-profile.ts` — full read, cookie pattern confirmed
- `src/components/business-selector.tsx` — full read, `router.refresh()` pattern confirmed
- `src/components/ui/skeleton.tsx` — verified shape: `animate-pulse rounded-md bg-muted`
- `src/components/motion-wrapper.tsx` — verified: thin wrapper over `motion/react`
- `src/app/dashboard/onboarding/[profileId]/page.tsx` — filesystem confirmed, route param is `profileId`
- `vitest.config.mts` — full read, test infra confirmed (Vitest, `tests/**/*.test.ts`)

### Secondary (MEDIUM confidence)
- Next.js App Router docs: Suspense + async server components stream independently when parent shell does not await before rendering children — standard documented behavior

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are already installed in project, versions irrelevant
- Architecture: HIGH — patterns read directly from source code, no inference
- Pitfalls: HIGH — derived from direct code reading (query filter shapes, route param names)
- Suspense streaming behavior: MEDIUM — standard Next.js 14 documented behavior, not independently verified against Context7

**Research date:** 2026-04-02
**Valid until:** 2026-05-02 (stable Next.js/Prisma patterns)
