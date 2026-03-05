---
phase: 04-post-approval-publishing
plan: 01
type: execute
wave: 1
depends_on: [03-ai-post-generation]
files_modified:
  - prisma/schema.prisma
  - src/lib/google-locations.ts
  - src/lib/google-posts.ts
  - src/lib/scheduling.ts
  - src/lib/queue/connection.ts
  - src/lib/queue/publish-queue.ts
  - src/app/api/posts/[id]/approve/route.ts
  - src/app/api/posts/approve/route.ts
  - src/app/api/posts/[id]/route.ts
  - src/app/dashboard/posts/page.tsx
  - workers/publish-worker.ts
  - package.json
autonomous: true
requirements: [R3.2, R3.3, R3.4, R3.5]

must_haves:
  truths:
    - "User can approve individual DRAFT posts via the UI"
    - "User can bulk-approve all drafts for a profile"
    - "Approved posts are auto-scheduled across the month at weekly cadence (Tuesdays 10 AM)"
    - "BullMQ delayed jobs fire at scheduled time and publish via GBP API"
    - "Failed publishes retry with exponential backoff (3 attempts)"
    - "Post status tracks through DRAFT -> SCHEDULED -> PUBLISHED/FAILED"
  artifacts:
    - path: "src/lib/google-posts.ts"
      provides: "GBP localPosts API integration"
      exports: ["createGBPPost"]
    - path: "src/lib/scheduling.ts"
      provides: "Schedule date calculation"
      exports: ["calculateScheduleDates"]
    - path: "src/lib/queue/connection.ts"
      provides: "Redis connection config"
      exports: ["redisConnection"]
    - path: "src/lib/queue/publish-queue.ts"
      provides: "BullMQ queue and scheduling"
      exports: ["publishQueue", "schedulePostPublish"]
    - path: "src/app/api/posts/[id]/approve/route.ts"
      provides: "POST endpoint for individual approval"
      exports: ["POST"]
    - path: "src/app/api/posts/approve/route.ts"
      provides: "POST endpoint for bulk approval"
      exports: ["POST"]
    - path: "workers/publish-worker.ts"
      provides: "BullMQ worker process for publishing"
  key_links:
    - from: "src/app/dashboard/posts/page.tsx"
      to: "/api/posts/[id]/approve"
      via: "fetch POST on approve button click"
      pattern: "fetch.*api/posts.*approve"
    - from: "src/app/api/posts/[id]/approve/route.ts"
      to: "src/lib/queue/publish-queue.ts"
      via: "schedulePostPublish after status update"
      pattern: "schedulePostPublish"
    - from: "workers/publish-worker.ts"
      to: "src/lib/google-posts.ts"
      via: "calls createGBPPost"
      pattern: "createGBPPost"
---

<objective>
Implement post approval, scheduling, and automated publishing via the Google Business Profile API.

Purpose: Users need to move generated drafts through an approval workflow and have them automatically publish to Google. This phase adds individual and bulk approval, weekly scheduling logic, BullMQ job queue for timed publishing, and the GBP API integration to actually create posts.

Output: Working approval flow where a user approves drafts (individually or in bulk), posts get auto-scheduled across the month (Tuesdays at 10 AM), and a BullMQ worker publishes them to Google at the scheduled time with retry logic for failures.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/4/04-RESEARCH.md
@prisma/schema.prisma
@src/lib/prisma.ts
@src/lib/google.ts
@src/lib/google-locations.ts
@src/app/api/posts/route.ts
@src/app/api/posts/generate/route.ts
@src/app/dashboard/posts/page.tsx

<interfaces>
<!-- Existing patterns the executor needs to follow -->

From src/lib/prisma.ts:
```typescript
export const prisma: PrismaClient;
// Singleton pattern with globalThis caching
```

From src/lib/auth.ts:
```typescript
export const authOptions: NextAuthOptions;
// Used via getServerSession(authOptions) in API routes
```

From src/lib/google.ts:
```typescript
export function createGoogleClient(googleAccountId: string): Promise<OAuth2Client>;
// Creates authenticated OAuth2Client with auto token refresh
// Used for making raw GBP API requests via oauth2Client.request()
```

From prisma/schema.prisma (Post model):
```prisma
model Post {
  id           String     @id @default(cuid())
  profileId    String
  profile      Profile    @relation(...)
  type         PostType   @default(WHATS_NEW)
  content      String
  callToAction String?
  mediaUrl     String?
  status       PostStatus @default(DRAFT)
  scheduledAt  DateTime?
  publishedAt  DateTime?
  googlePostId String?
  errorMessage String?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
}
```

From src/lib/google-locations.ts:
```typescript
// syncLocationsForAccount accesses account.name (resource name like "accounts/123")
// This is available from mybusinessaccountmanagement.accounts.list()
// Currently NOT stored on Profile -- need to add accountResourceName field
```

GBP API key mapping:
- PostType.WHATS_NEW -> GBP topicType "STANDARD"
- PostType.EVENT -> GBP topicType "EVENT"
- PostType.OFFER -> GBP topicType "OFFER"

GBP localPosts endpoint:
POST https://mybusiness.googleapis.com/v4/{parent}/localPosts
Where parent = accounts/{accountId}/locations/{locationId}
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Schema update, GBP posts API, scheduling logic, and BullMQ setup</name>
  <files>
    prisma/schema.prisma,
    src/lib/google-locations.ts,
    src/lib/google-posts.ts,
    src/lib/scheduling.ts,
    src/lib/queue/connection.ts,
    src/lib/queue/publish-queue.ts,
    workers/publish-worker.ts,
    package.json
  </files>
  <action>
    **Install dependencies:**
    ```bash
    npm install bullmq
    ```

    **1. Add accountResourceName to Profile in prisma/schema.prisma:**
    Add `accountResourceName String?` to the Profile model (needed for GBP localPosts API parent path construction).
    Run `npx prisma db push` to sync.

    **2. Update src/lib/google-locations.ts to store accountResourceName:**
    In the `syncLocationsForAccount` function, inside the `for (const account of accounts)` loop, pass `account.name` (e.g., "accounts/123") to the Profile upsert. Add `accountResourceName: account.name` to both `create` and `update` in the `prisma.profile.upsert()` call.

    **3. Create src/lib/google-posts.ts:**
    GBP localPosts API integration using `oauth2Client.request()` (no typed client exists for v4):
    ```typescript
    export async function createGBPPost(params: {
      googleAccountId: string;
      accountResourceName: string; // "accounts/123"
      locationName: string;        // "locations/456"
      summary: string;
      topicType: "STANDARD" | "EVENT" | "OFFER";
      callToAction?: { actionType: string; url?: string };
    })
    ```
    - Construct parent URL: `https://mybusiness.googleapis.com/v4/${accountResourceName}/${locationName}/localPosts`
    - Build request body with `languageCode: "en-US"`, `summary`, `topicType`, optional `callToAction`
    - Use `createGoogleClient(googleAccountId)` from `src/lib/google.ts` for auth
    - Return `response.data` (contains `name` field = googlePostId)

    **4. Create src/lib/scheduling.ts:**
    ```typescript
    export function calculateScheduleDates(postCount: number, targetMonth: number, targetYear: number): Date[]
    ```
    - Find all Tuesdays in the target month that are in the future
    - Distribute posts evenly across available Tuesdays
    - Set time to 10:00 AM (local time)
    - If no future Tuesdays, return empty array
    - Return sorted array of Date objects

    **5. Create src/lib/queue/connection.ts:**
    Redis connection config shared between queue and worker:
    - Parse `REDIS_URL` environment variable if available (for Railway)
    - Fall back to `localhost:6379` for development
    - Set `maxRetriesPerRequest: null` (required for BullMQ workers)

    **6. Create src/lib/queue/publish-queue.ts:**
    BullMQ queue instance and scheduling helper:
    - Queue name: `"post-publish"`
    - Default job options: 3 attempts, exponential backoff starting at 60s
    - `schedulePostPublish(postId: string, publishAt: Date)`: adds delayed job with `delay = publishAt.getTime() - Date.now()`. If delay is negative (past date), set delay to 0 for immediate execution.
    - Export `PublishJobData` interface: `{ postId: string }`

    **7. Create workers/publish-worker.ts:**
    Standalone BullMQ worker process:
    - Import shared connection config from `src/lib/queue/connection.ts`
    - Process `"post-publish"` jobs:
      1. Fetch post from DB with profile + googleAccount relations
      2. Skip if already PUBLISHED
      3. Map PostType enum to GBP topicType (WHATS_NEW -> STANDARD)
      4. Call `createGBPPost()` with profile's accountResourceName and locationName
      5. On success: update post to PUBLISHED with publishedAt and googlePostId
    - Handle failures: on final attempt (attemptsMade >= attempts), update post to FAILED with errorMessage
    - Set concurrency to 5
    - Add console.log for startup, completion, and failure events
  </action>
  <verify>
    <automated>npx prisma db push --accept-data-loss 2>&1 | tail -5 && npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>
    - Profile model has accountResourceName field
    - google-locations.ts saves accountResourceName during sync
    - createGBPPost() sends posts to GBP API via oauth2Client.request()
    - calculateScheduleDates() distributes posts across Tuesdays
    - Redis connection config handles REDIS_URL parsing
    - BullMQ queue with delayed jobs and exponential backoff
    - Worker process handles publish jobs and failure tracking
    - TypeScript compiles without errors
  </done>
</task>

<task type="auto">
  <name>Task 2: Approval API endpoints and posts dashboard UI updates</name>
  <files>
    src/app/api/posts/[id]/approve/route.ts,
    src/app/api/posts/approve/route.ts,
    src/app/api/posts/[id]/route.ts,
    src/app/dashboard/posts/page.tsx
  </files>
  <action>
    **1. Create src/app/api/posts/[id]/approve/route.ts (individual approval):**
    - POST endpoint, auth check
    - Fetch post, verify status is DRAFT
    - Calculate next available schedule date using `calculateScheduleDates(1, now.getMonth(), now.getFullYear())`
    - If no date available, try next month
    - Update post: status = "SCHEDULED", set scheduledAt
    - Call `schedulePostPublish(id, scheduledAt)` to create BullMQ delayed job
    - Return updated post

    **2. Create src/app/api/posts/approve/route.ts (bulk approval):**
    - POST endpoint accepting `{ profileId: string }`, auth check
    - Find all DRAFT posts for the given profileId
    - Calculate schedule dates for all posts: `calculateScheduleDates(drafts.length, now.getMonth(), now.getFullYear())`
    - Update each post to SCHEDULED with its scheduledAt
    - Create a BullMQ delayed job for each
    - Return `{ approved: count, posts: updatedPosts }`

    **3. Create src/app/api/posts/[id]/route.ts (post details/update):**
    - PATCH endpoint for updating a post (change status, content, etc.)
    - Auth check
    - Accept partial post fields in body
    - Return updated post
    - DELETE endpoint for deleting a draft post
    - Only allow deleting DRAFT posts

    **4. Update src/app/dashboard/posts/page.tsx to add approval actions:**
    The posts page is a server component, so add a client component for the approve buttons:
    - Create an inline client component or a separate `post-actions.tsx` file
    - Each DRAFT post card gets an "Approve" button
    - Add a "Approve All Drafts" button in the page header (or per-profile section) that calls bulk approve
    - SCHEDULED posts show their scheduledAt date
    - PUBLISHED posts show publishedAt date
    - FAILED posts show error message with a "Retry" option (re-approve sets back to DRAFT then re-schedules)
    - After approval action, use `router.refresh()` to update the page

    Style notes:
    - Approve button: green outline, Check icon from lucide-react
    - Bulk approve button: green solid bg, near the "Generate Posts" button
    - Scheduled date shown as "Scheduled for Mar 11, 2026" below the post content
    - Failed posts have red border/highlight with error tooltip
  </action>
  <verify>
    <automated>npm run build 2>&1 | tail -10</automated>
  </verify>
  <done>
    - POST /api/posts/:id/approve schedules individual post
    - POST /api/posts/approve bulk-approves all drafts for a profile
    - PATCH /api/posts/:id updates post fields
    - DELETE /api/posts/:id deletes draft posts
    - Posts dashboard shows approve buttons on DRAFT cards
    - Bulk approve button in page header
    - Scheduled/published/failed posts show relevant info
    - Build succeeds without errors
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Post approval and scheduling flow: individual and bulk approval API endpoints, weekly scheduling algorithm (Tuesdays at 10 AM), BullMQ delayed jobs for timed publishing, GBP localPosts API integration, and updated posts dashboard with approve/status UI.
  </what-built>
  <how-to-verify>
    1. Start dev server: `npm run dev`
    2. Navigate to /dashboard/posts -- should see existing draft posts with "Approve" buttons
    3. Click "Approve" on a single draft post -- should change to SCHEDULED with a date
    4. Use "Approve All" for a profile -- all its drafts should become SCHEDULED
    5. Verify scheduled dates are on future Tuesdays at 10 AM
    6. Check that posts moved to SCHEDULED status in the UI

    Note: Actual GBP publishing requires:
    - A real Google account connected with valid OAuth tokens
    - Redis running locally (`brew install redis && brew services start redis`) or REDIS_URL set
    - Worker process running: `npx tsx workers/publish-worker.ts`

    For now, verifying the approval flow and scheduling logic works is sufficient.
    The worker + GBP API publishing will be validated in production with real accounts.
  </how-to-verify>
  <resume-signal>Type "approved" or describe any issues with the approval flow, scheduling, or UI</resume-signal>
</task>

</tasks>

<verification>
- TypeScript compiles: `npx tsc --noEmit`
- App builds: `npm run build`
- Prisma schema valid: `npx prisma validate`
- API endpoints respond:
  - POST /api/posts/:id/approve schedules a single post
  - POST /api/posts/approve bulk-approves for a profile
  - PATCH /api/posts/:id updates a post
- Posts dashboard shows approval actions
- Schedule dates are on future Tuesdays
- BullMQ queue accepts delayed jobs (when Redis is available)
</verification>

<success_criteria>
- Can approve individual drafts and see them move to SCHEDULED status
- Can bulk-approve all drafts for a profile
- Scheduled posts are distributed across future Tuesdays at 10 AM
- BullMQ delayed jobs are created with correct delay timing
- Worker process publishes to GBP API with retry logic on failure
- Post status lifecycle is tracked: DRAFT -> SCHEDULED -> PUBLISHED/FAILED
- Posts dashboard UI reflects all status transitions with appropriate badges and info
- Build and TypeScript compilation succeed
</success_criteria>

<output>
After completion, create `.planning/phases/4/04-01-SUMMARY.md`
</output>
