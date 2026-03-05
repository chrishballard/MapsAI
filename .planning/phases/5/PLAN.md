---
phase: 05-review-sync-ai-responses
plan: 01
type: execute
wave: 1
depends_on: [04-post-approval-publishing]
files_modified:
  - src/lib/google-reviews.ts
  - src/lib/review-responder.ts
  - src/lib/queue/review-sync-queue.ts
  - src/lib/queue/review-publish-queue.ts
  - src/app/api/reviews/route.ts
  - src/app/api/reviews/sync/route.ts
  - src/app/api/reviews/[id]/approve/route.ts
  - src/app/api/reviews/approve/route.ts
  - src/app/api/reviews/[id]/generate/route.ts
  - src/app/dashboard/reviews/page.tsx
  - src/app/dashboard/reviews/review-filters.tsx
  - src/app/dashboard/reviews/review-actions.tsx
  - workers/review-sync-worker.ts
  - workers/review-publish-worker.ts
autonomous: true
requirements: [R4.1, R4.2, R4.3, R4.4, R4.5, R4.6, R4.7]

must_haves:
  truths:
    - "Reviews are synced from GBP API via periodic BullMQ job (every 30 min)"
    - "New reviews automatically get AI-generated response drafts via Claude"
    - "Reviews dashboard shows all reviews with rating, text, reviewer, and response status"
    - "User can approve individual responses or bulk-approve"
    - "Approved responses are published to Google as review replies"
    - "Profiles with autoApproveReviews=true auto-publish without human review"
    - "Response status tracks through DRAFTED -> APPROVED -> PUBLISHED/FAILED"
  artifacts:
    - path: "src/lib/google-reviews.ts"
      provides: "GBP reviews API (fetch + reply)"
      exports: ["fetchReviews", "publishReviewReply", "STAR_RATING_MAP"]
    - path: "src/lib/review-responder.ts"
      provides: "Claude AI review response generation"
      exports: ["generateReviewResponse"]
    - path: "src/lib/queue/review-sync-queue.ts"
      provides: "Review sync repeatable job scheduler"
      exports: ["reviewSyncQueue", "initReviewSyncScheduler"]
    - path: "src/lib/queue/review-publish-queue.ts"
      provides: "Review response publish queue"
      exports: ["reviewPublishQueue", "scheduleReviewPublish"]
    - path: "src/app/api/reviews/route.ts"
      provides: "GET endpoint for listing reviews with filters"
      exports: ["GET"]
    - path: "src/app/api/reviews/sync/route.ts"
      provides: "POST endpoint for manual review sync trigger"
      exports: ["POST"]
    - path: "src/app/dashboard/reviews/page.tsx"
      provides: "Reviews dashboard with filters and actions"
  key_links:
    - from: "workers/review-sync-worker.ts"
      to: "src/lib/google-reviews.ts"
      via: "calls fetchReviews for each profile"
      pattern: "fetchReviews"
    - from: "workers/review-sync-worker.ts"
      to: "src/lib/review-responder.ts"
      via: "calls generateReviewResponse for new reviews"
      pattern: "generateReviewResponse"
    - from: "workers/review-publish-worker.ts"
      to: "src/lib/google-reviews.ts"
      via: "calls publishReviewReply"
      pattern: "publishReviewReply"
---

<objective>
Implement review syncing from GBP, AI-generated response drafts, approval workflow, and reply publishing.

Purpose: Reviews are critical for local SEO. This phase automates the tedious process of monitoring and responding to reviews across 100-200 profiles. New reviews are synced periodically, Claude generates sentiment-aware response drafts, and approved responses are published back to Google.

Output: Working review pipeline where reviews auto-sync every 30 minutes, get AI-drafted responses, can be approved (individually, in bulk, or auto-approved), and replies publish to Google via the GBP API.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/5/05-RESEARCH.md
@prisma/schema.prisma
@src/lib/prisma.ts
@src/lib/google.ts
@src/lib/google-posts.ts
@src/lib/claude.ts
@src/lib/post-generator.ts
@src/lib/queue/connection.ts
@src/lib/queue/publish-queue.ts
@workers/publish-worker.ts
@src/app/dashboard/reviews/page.tsx

<interfaces>
From src/lib/google.ts:
```typescript
export async function createGoogleClient(googleAccountId: string): Promise<OAuth2Client>;
// Authenticated client with auto token refresh
```

From src/lib/claude.ts:
```typescript
export const anthropic: Anthropic;
// Singleton, use anthropic.messages.parse() with zodOutputFormat
```

From src/lib/queue/connection.ts:
```typescript
export const redisConnection: ConnectionOptions;
// Shared Redis config for all queues and workers
```

From prisma/schema.prisma:
```prisma
model Review {
  id             String          @id @default(cuid())
  profileId      String
  profile        Profile         @relation(...)
  googleReviewId String          @unique
  reviewerName   String?
  rating         Int
  comment        String?
  reviewDate     DateTime
  response       ReviewResponse?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
}

enum ReviewResponseStatus { PENDING, DRAFTED, APPROVED, PUBLISHED, FAILED }

model ReviewResponse {
  id           String               @id @default(cuid())
  reviewId     String               @unique
  review       Review               @relation(...)
  content      String
  status       ReviewResponseStatus @default(DRAFTED)
  publishedAt  DateTime?
  errorMessage String?
  createdAt    DateTime             @default(now())
  updatedAt    DateTime             @updatedAt
}

model Profile {
  // ...
  autoApproveReviews Boolean @default(false)
  accountResourceName String?
  locationName    String
}
```

GBP Reviews API:
- List: GET https://mybusiness.googleapis.com/v4/{parent}/reviews?pageSize=50&orderBy=updateTime+desc
- Reply: PUT https://mybusiness.googleapis.com/v4/{reviewResourceName}/reply with { comment }
- StarRating enum: "ONE","TWO","THREE","FOUR","FIVE" -> map to int 1-5
- Store full review resource name (accounts/.../locations/.../reviews/...) as googleReviewId

BullMQ repeatable jobs:
- Use queue.upsertJobScheduler("scheduler-id", { every: ms }, { name, data })
- Different from delayed jobs used for post publishing
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: GBP reviews API, AI response generation, queues, and workers</name>
  <files>
    src/lib/google-reviews.ts,
    src/lib/review-responder.ts,
    src/lib/queue/review-sync-queue.ts,
    src/lib/queue/review-publish-queue.ts,
    workers/review-sync-worker.ts,
    workers/review-publish-worker.ts
  </files>
  <action>
    **1. Create src/lib/google-reviews.ts:**
    Follow the same `oauth2Client.request()` pattern as `src/lib/google-posts.ts`.

    - `STAR_RATING_MAP`: Record mapping "ONE"->1, "TWO"->2, etc.
    - `GBPReview` interface: name, reviewId, reviewer (displayName, isAnonymous), starRating, comment, createTime, updateTime, reviewReply?
    - `fetchReviews(googleAccountId, accountResourceName, locationName, pageToken?)`: GET reviews list with pageSize=50, orderBy=updateTime desc. Returns `{ reviews, nextPageToken, totalReviewCount, averageRating }`.
    - `publishReviewReply(googleAccountId, reviewResourceName, comment)`: PUT to `{reviewResourceName}/reply` with `{ comment }` body.

    **2. Create src/lib/review-responder.ts:**
    Follow the same `anthropic.messages.parse()` + `zodOutputFormat()` pattern as `src/lib/post-generator.ts`.

    - `ReviewResponseSchema`: Zod object with `response` (string), `sentiment` (enum: positive/neutral/negative), `tone` (string)
    - `generateReviewResponse(input)` where input has: businessName, businessCategory, reviewerName, starRating, reviewComment
    - System prompt: professional business owner responding to GBP reviews. Guidelines for positive (4-5 stars), neutral (3), negative (1-2). Max 4096 bytes. No excessive emojis. Authentic tone.
    - Model: claude-sonnet-4-5-20250929, max_tokens: 512
    - Handle null comments (rating-only reviews) in user message

    **3. Create src/lib/queue/review-sync-queue.ts:**
    - Queue name: `"review-sync"`
    - 3 attempts, exponential backoff at 30s
    - `initReviewSyncScheduler()`: calls `reviewSyncQueue.upsertJobScheduler("review-sync-scheduler", { every: 30 * 60 * 1000 }, { name: "sync-reviews", data: {} })`
    - Export queue and init function

    **4. Create src/lib/queue/review-publish-queue.ts:**
    - Queue name: `"review-publish"`
    - 3 attempts, exponential backoff at 60s
    - `scheduleReviewPublish(reviewResponseId)`: adds job with delay 0 (immediate)
    - Export `ReviewPublishJobData` interface: `{ reviewResponseId: string }`

    **5. Create workers/review-sync-worker.ts:**
    Standalone BullMQ worker for the `"review-sync"` queue:
    - Fetch all connected profiles with accountResourceName
    - For each profile, paginate through all reviews via fetchReviews
    - For each review:
      - Skip if already exists (check by googleReviewId using prisma.review.findUnique)
      - Skip if review already has a reply on Google (reviewReply exists)
      - Create Review record (map starRating string to int)
      - Generate AI response via generateReviewResponse
      - Create ReviewResponse with status DRAFTED (or APPROVED if profile.autoApproveReviews)
      - If auto-approve, add job to review-publish queue
    - Wrap each profile in try/catch so one failure doesn't block others
    - Concurrency: 1 (sequential sync to avoid rate limits)

    **6. Create workers/review-publish-worker.ts:**
    Standalone BullMQ worker for the `"review-publish"` queue:
    - Fetch ReviewResponse with review + profile + googleAccount relations
    - Skip if already PUBLISHED
    - Call publishReviewReply with the review's googleReviewId (full resource name) and response content
    - Update ReviewResponse: status=PUBLISHED, publishedAt=now()
    - On final failure: status=FAILED, errorMessage
    - Concurrency: 5
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>
    - GBP review fetching and reply publishing via oauth2Client.request()
    - Claude AI generates sentiment-aware review responses
    - Review sync queue with 30-min repeatable scheduler
    - Review publish queue for approved responses
    - Sync worker processes new reviews and generates AI drafts
    - Publish worker posts replies to Google
    - Auto-approve flow queues responses immediately when enabled
    - TypeScript compiles without errors
  </done>
</task>

<task type="auto">
  <name>Task 2: Reviews API endpoints and dashboard UI</name>
  <files>
    src/app/api/reviews/route.ts,
    src/app/api/reviews/sync/route.ts,
    src/app/api/reviews/[id]/approve/route.ts,
    src/app/api/reviews/approve/route.ts,
    src/app/api/reviews/[id]/generate/route.ts,
    src/app/dashboard/reviews/page.tsx,
    src/app/dashboard/reviews/review-filters.tsx,
    src/app/dashboard/reviews/review-actions.tsx
  </files>
  <action>
    **1. Create src/app/api/reviews/route.ts (list with filters):**
    - GET endpoint, auth check
    - Query params: profileId, rating (int), responseStatus (DRAFTED/APPROVED/PUBLISHED/FAILED)
    - Query prisma.review.findMany with filters, include profile (name, category) and response
    - Order by reviewDate desc
    - Return `{ reviews }`

    **2. Create src/app/api/reviews/sync/route.ts (manual sync trigger):**
    - POST endpoint, auth check
    - Add a job to the review-sync queue with delay 0 (triggers immediate sync)
    - Also call initReviewSyncScheduler() to ensure the repeatable schedule is active
    - Return `{ message: "Review sync triggered" }`

    **3. Create src/app/api/reviews/[id]/approve/route.ts (individual approval):**
    - POST endpoint, auth check
    - Fetch review with response
    - Verify response exists and status is DRAFTED
    - Update response status to APPROVED
    - Add job to review-publish queue
    - Return updated review with response

    **4. Create src/app/api/reviews/approve/route.ts (bulk approval):**
    - POST endpoint accepting `{ profileId: string }`, auth check
    - Find all reviews for profile where response.status = DRAFTED
    - Update all to APPROVED
    - Add publish jobs for each
    - Return `{ approved: count }`

    **5. Create src/app/api/reviews/[id]/generate/route.ts (regenerate response):**
    - POST endpoint, auth check
    - Fetch review with profile
    - Call generateReviewResponse
    - Upsert ReviewResponse (create if none, update if exists) with new content and status DRAFTED
    - Return updated review with response

    **6. Replace src/app/dashboard/reviews/page.tsx (reviews dashboard):**
    Server component (same pattern as posts page):
    - Fetch reviews with responses via direct Prisma query
    - Accept searchParams for profileId, rating, responseStatus filters
    - Show filter controls at top

    Display each review as a card:
    - Star rating (filled/empty stars using lucide Star icon)
    - Reviewer name (or "Anonymous")
    - Review date
    - Review text (or "Rating only - no comment")
    - Profile name badge
    - AI response section: show drafted response content in a bordered box
    - Response status badge (same color pattern as posts: gray=DRAFTED, blue=APPROVED, green=PUBLISHED, red=FAILED)
    - Action buttons via client component

    Header: "Reviews" title with count, "Sync Reviews" button (calls /api/reviews/sync), "Approve All" button

    Empty state: MessageSquare icon with "No reviews synced" message and "Sync Reviews" button

    **7. Create src/app/dashboard/reviews/review-filters.tsx:**
    Client component (same pattern as posts/post-filters.tsx):
    - Profile dropdown, rating dropdown (1-5 stars), response status dropdown
    - Filter changes update URL searchParams

    **8. Create src/app/dashboard/reviews/review-actions.tsx:**
    Client component for per-review actions:
    - "Approve" button (for DRAFTED responses) — calls POST /api/reviews/:id/approve
    - "Regenerate" button — calls POST /api/reviews/:id/generate
    - Use router.refresh() after actions
    - Loading states during API calls
  </action>
  <verify>
    <automated>npm run build 2>&1 | tail -10</automated>
  </verify>
  <done>
    - GET /api/reviews returns filtered review list with responses
    - POST /api/reviews/sync triggers manual review sync
    - POST /api/reviews/:id/approve approves and queues response for publishing
    - POST /api/reviews/approve bulk-approves for a profile
    - POST /api/reviews/:id/generate creates/regenerates AI response
    - Reviews dashboard shows review cards with ratings, text, AI responses, and status
    - Filter by profile, rating, and response status works
    - Approve and regenerate actions work from the UI
    - Build succeeds without errors
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Complete review management pipeline: GBP review syncing (periodic + manual), Claude AI response generation (sentiment-aware), approval workflow (individual + bulk + auto-approve), reply publishing via GBP API, and full reviews dashboard with filters and actions.
  </what-built>
  <how-to-verify>
    1. Start dev server: `npm run dev`
    2. Navigate to /dashboard/reviews — should show empty state with "Sync Reviews" button
    3. Click "Sync Reviews" to trigger a manual sync (will need connected Google profiles with real reviews to see data)
    4. If no real Google data: verify the API routes respond correctly and the UI renders without errors
    5. Test the filter controls (profile, rating, response status)
    6. Check that the review sync worker starts without errors: `npx tsx workers/review-sync-worker.ts`
    7. Check that the review publish worker starts: `npx tsx workers/review-publish-worker.ts`

    Note: Full end-to-end testing with real GBP data requires connected Google accounts with reviews. The UI and API structure can be verified without real data.
  </how-to-verify>
  <resume-signal>Type "approved" or describe any issues</resume-signal>
</task>

</tasks>

<verification>
- TypeScript compiles: `npx tsc --noEmit`
- App builds: `npm run build`
- API endpoints respond:
  - GET /api/reviews returns review list
  - POST /api/reviews/sync triggers sync
  - POST /api/reviews/:id/approve approves response
  - POST /api/reviews/approve bulk-approves
  - POST /api/reviews/:id/generate creates AI response
- Reviews dashboard renders with filter controls
- Workers start without errors
</verification>

<success_criteria>
- Review sync worker fetches reviews from GBP API and stores them
- AI generates sentiment-appropriate responses (warm for 5-star, empathetic for 1-star)
- Reviews dashboard displays all reviews with ratings, text, and response drafts
- Can filter reviews by profile, rating, and response status
- Can approve individual responses and see them queue for publishing
- Can bulk-approve all drafted responses for a profile
- Auto-approve setting on profile triggers immediate publish queue
- Response status lifecycle: DRAFTED -> APPROVED -> PUBLISHED/FAILED
- Build and TypeScript compilation succeed
</success_criteria>

<output>
After completion, create `.planning/phases/5/05-01-SUMMARY.md`
</output>
