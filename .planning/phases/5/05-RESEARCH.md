# Phase 5: Review Sync & AI Responses - Research

**Researched:** 2026-03-04
**Domain:** Google Business Profile Reviews API, BullMQ job scheduling, Claude AI response generation
**Confidence:** HIGH

## Summary

This phase implements a complete review management pipeline: periodic syncing of reviews from the GBP API, AI-generated response drafts via Claude, an approval workflow, and publishing replies back through the GBP API. The existing codebase already has the Prisma models (Review, ReviewResponse with status enum), BullMQ infrastructure, Claude API client with structured outputs, and Google OAuth with token refresh -- all of which can be directly reused.

The GBP Reviews API (v4) provides straightforward endpoints for listing reviews and posting replies. The key architectural challenge is the periodic sync worker using BullMQ's `upsertJobScheduler` (repeatable jobs), which differs from the existing delayed-job pattern used for post publishing. The AI response generation follows the same structured output pattern already used in `post-generator.ts`.

**Primary recommendation:** Build the review sync as a BullMQ repeatable job using `upsertJobScheduler` with a 30-minute interval. Use the existing `anthropic.messages.parse` pattern with Zod schemas for generating review responses. Mirror the existing post approval UI patterns for the review approval flow.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| R4.1 | Poll for new reviews across all connected profiles (periodic sync) | BullMQ `upsertJobScheduler` with `every` option; GBP `reviews.list` endpoint with `orderBy: updateTime desc` and pagination |
| R4.2 | Display new reviews in dashboard with rating, text, reviewer info | Review model already exists in Prisma; follows existing posts page pattern with filters |
| R4.3 | Auto-generate review response drafts using Claude API | Existing `anthropic.messages.parse` with `zodOutputFormat` pattern from post-generator.ts |
| R4.4 | Response considers: review sentiment, star rating, business context | System prompt includes business context; star rating and comment text drive sentiment-aware generation |
| R4.5 | Option to auto-publish responses or queue for human approval | Profile.autoApproveReviews field already exists; check after draft generation |
| R4.6 | Publish approved responses via GBP API | `reviews.updateReply` PUT endpoint with `{ comment: string }` body |
| R4.7 | Track response status: pending, drafted, approved, published | ReviewResponseStatus enum already defined: PENDING, DRAFTED, APPROVED, PUBLISHED, FAILED |
</phase_requirements>

## Standard Stack

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| bullmq | ^5.70.2 | Review sync repeatable job + response publish job | Already used for post publishing; `upsertJobScheduler` for repeatable patterns |
| googleapis | ^171.4.0 | GBP Reviews API (list + reply) via oauth2Client.request() | Already used for post creation in google-posts.ts |
| @anthropic-ai/sdk | ^0.78.0 | Claude AI review response generation | Already used with structured outputs in post-generator.ts |
| zod | ^4.3.6 | Schema validation for Claude structured output | Already used for post generation schemas |
| prisma | ^7.4.2 | Review and ReviewResponse models (already defined) | Already the project ORM |

### Supporting (Already Installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | ^0.577.0 | Review UI icons (Star, MessageSquare, Check, etc.) | Dashboard review cards |
| next-auth | ^4.24.13 | API route authentication | All review API endpoints |

### No New Dependencies Needed
All required functionality is covered by existing packages. No new installations required.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── queue/
│   │   ├── connection.ts          # (existing) Redis connection
│   │   ├── publish-queue.ts       # (existing) Post publish queue
│   │   ├── review-sync-queue.ts   # NEW: Review sync repeatable job scheduler
│   │   └── review-publish-queue.ts # NEW: Review response publish queue
│   ├── google.ts                  # (existing) OAuth client + token refresh
│   ├── google-posts.ts            # (existing) GBP post creation
│   ├── google-reviews.ts          # NEW: GBP review fetching + reply publishing
│   ├── claude.ts                  # (existing) Anthropic client singleton
│   ├── post-generator.ts          # (existing) Post generation with Claude
│   └── review-responder.ts        # NEW: Review response generation with Claude
├── app/
│   ├── api/
│   │   └── reviews/
│   │       ├── sync/route.ts      # NEW: Manual trigger for review sync
│   │       ├── [id]/
│   │       │   ├── approve/route.ts  # NEW: Approve a drafted response
│   │       │   ├── generate/route.ts # NEW: Generate AI response for a review
│   │       │   └── route.ts          # NEW: GET single review, PATCH response
│   │       ├── approve/route.ts   # NEW: Bulk approve responses
│   │       └── route.ts           # NEW: GET reviews list with filters
│   └── dashboard/
│       └── reviews/
│           ├── page.tsx           # REPLACE: Full reviews dashboard
│           ├── review-card.tsx    # NEW: Individual review card component
│           ├── review-actions.tsx # NEW: Approve/edit/regenerate actions
│           └── review-filters.tsx # NEW: Filter by profile/status/rating
└── workers/
    ├── review-sync.worker.ts      # NEW: BullMQ worker for periodic review sync
    └── review-publish.worker.ts   # NEW: BullMQ worker for publishing responses
```

### Pattern 1: BullMQ Repeatable Job Scheduler (Review Sync)
**What:** Use `upsertJobScheduler` to create a repeatable job that fires every 30 minutes to sync reviews from GBP API.
**When to use:** For the periodic review polling requirement (R4.1).
**Example:**
```typescript
// Source: https://docs.bullmq.io/guide/job-schedulers
import { Queue } from "bullmq";
import { redisConnection } from "./connection";

export const reviewSyncQueue = new Queue("review-sync", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
  },
});

// Call this once at app startup or in an init route
export async function initReviewSyncScheduler() {
  await reviewSyncQueue.upsertJobScheduler(
    "review-sync-scheduler",
    { every: 30 * 60 * 1000 }, // 30 minutes
    {
      name: "sync-reviews",
      data: {},
    }
  );
}
```

### Pattern 2: GBP Reviews API Calls (Following google-posts.ts Pattern)
**What:** Use the same `oauth2Client.request()` pattern as `google-posts.ts` for fetching reviews and posting replies.
**When to use:** For review list and reply operations (R4.1, R4.6).
**Example:**
```typescript
// Source: https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list
import { createGoogleClient } from "./google";

interface GBPReview {
  name: string;           // accounts/{id}/locations/{id}/reviews/{id}
  reviewId: string;
  reviewer: {
    displayName: string;
    profilePhotoUrl?: string;
    isAnonymous: boolean;
  };
  starRating: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE";
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: {
    comment: string;
    updateTime: string;
  };
}

interface ListReviewsResponse {
  reviews?: GBPReview[];
  averageRating?: number;
  totalReviewCount?: number;
  nextPageToken?: string;
}

const STAR_RATING_MAP: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
};

export async function fetchReviews(
  googleAccountId: string,
  accountResourceName: string,
  locationName: string,
  pageToken?: string
): Promise<ListReviewsResponse> {
  const oauth2Client = await createGoogleClient(googleAccountId);
  const parent = `${accountResourceName}/${locationName}`;
  const url = `https://mybusiness.googleapis.com/v4/${parent}/reviews`;

  const params: Record<string, string> = {
    pageSize: "50",
    orderBy: "updateTime desc",
  };
  if (pageToken) params.pageToken = pageToken;

  const response = await oauth2Client.request<ListReviewsResponse>({
    url,
    method: "GET",
    params,
  });

  return response.data;
}

export async function publishReviewReply(
  googleAccountId: string,
  reviewResourceName: string,
  comment: string
): Promise<void> {
  const oauth2Client = await createGoogleClient(googleAccountId);
  const url = `https://mybusiness.googleapis.com/v4/${reviewResourceName}/reply`;

  await oauth2Client.request({
    url,
    method: "PUT",
    data: { comment },
  });
}
```

### Pattern 3: Claude AI Response Generation (Following post-generator.ts Pattern)
**What:** Use the existing `anthropic.messages.parse` with `zodOutputFormat` for structured review response output.
**When to use:** For AI review response generation (R4.3, R4.4).
**Example:**
```typescript
// Following src/lib/post-generator.ts pattern
import { anthropic } from "./claude";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const ReviewResponseSchema = z.object({
  response: z.string().describe("The review response text, max 4096 bytes"),
  sentiment: z.enum(["positive", "neutral", "negative"]).describe("Detected sentiment"),
  tone: z.string().describe("Brief description of the tone used"),
});

type ReviewResponseOutput = z.infer<typeof ReviewResponseSchema>;

interface GenerateReviewResponseInput {
  businessName: string;
  businessCategory: string | null;
  reviewerName: string | null;
  starRating: number;
  reviewComment: string | null;
}

export async function generateReviewResponse(
  input: GenerateReviewResponseInput
): Promise<ReviewResponseOutput> {
  const systemPrompt = `You are a professional business owner responding to Google Business Profile reviews.

Guidelines:
- Keep responses concise (2-4 sentences for positive, 3-5 for negative)
- Always thank the reviewer
- For positive reviews (4-5 stars): Be warm, grateful, mention specifics from their review
- For neutral reviews (3 stars): Acknowledge feedback, mention improvements
- For negative reviews (1-2 stars): Be empathetic, apologize, offer to resolve offline
- Never be defensive or argumentative
- Use the reviewer's name if available
- Reference the business name naturally
- Do NOT use excessive exclamation marks or emojis
- Sound authentic, not corporate or robotic
- Maximum 4096 bytes`;

  const userMessage = [
    `Business: ${input.businessName}`,
    input.businessCategory ? `Category: ${input.businessCategory}` : null,
    `Star Rating: ${input.starRating}/5`,
    `Reviewer: ${input.reviewerName || "Anonymous"}`,
    input.reviewComment
      ? `Review Text: "${input.reviewComment}"`
      : "Review Text: (no comment, rating only)",
    "",
    "Generate a professional, authentic response to this review.",
  ].filter(Boolean).join("\n");

  const message = await anthropic.messages.parse({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: zodOutputFormat(ReviewResponseSchema),
    },
  });

  const parsed = message.parsed_output;
  if (!parsed) {
    throw new Error("Failed to parse review response from Claude");
  }

  return parsed;
}
```

### Pattern 4: Auto-Approve Flow
**What:** After generating a response draft, check `profile.autoApproveReviews` and automatically publish if enabled.
**When to use:** For R4.5 auto-publish feature.
**Example:**
```typescript
// In the review sync worker, after generating a response:
async function handleNewReview(review: Review, profile: Profile) {
  // Generate AI response
  const aiResponse = await generateReviewResponse({
    businessName: profile.name,
    businessCategory: profile.category,
    reviewerName: review.reviewerName,
    starRating: review.rating,
    reviewComment: review.comment,
  });

  // Create response record
  const reviewResponse = await prisma.reviewResponse.create({
    data: {
      reviewId: review.id,
      content: aiResponse.response,
      status: profile.autoApproveReviews ? "APPROVED" : "DRAFTED",
    },
  });

  // If auto-approve, queue for publishing
  if (profile.autoApproveReviews) {
    await reviewPublishQueue.add(
      `publish-reply-${review.id}`,
      { reviewResponseId: reviewResponse.id },
      { delay: 0 }
    );
  }
}
```

### Anti-Patterns to Avoid
- **Polling too frequently:** GBP API has rate limits. Do NOT poll more than every 15 minutes per location. 30-minute intervals are recommended.
- **Not paginating:** Reviews endpoint returns max 50 per page. Always handle `nextPageToken` for locations with many reviews.
- **Storing star ratings as strings:** The GBP API returns `starRating` as an enum string ("ONE", "TWO", etc.). Convert to integer before storing in the database.
- **Generating responses for rating-only reviews without comment:** These still need responses but the prompt must handle the empty comment case.
- **Not deduplicating reviews:** Use `googleReviewId` (which maps to GBP `reviewId`) as the unique key. Always upsert, never blindly insert.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Periodic job scheduling | Custom setInterval/cron | BullMQ `upsertJobScheduler` | Handles process restarts, clustering, deduplication of schedulers |
| OAuth token refresh | Manual token management | Existing `createGoogleClient` | Already handles refresh with 5-min buffer |
| Structured AI output parsing | Manual JSON extraction from Claude | `anthropic.messages.parse` + `zodOutputFormat` | Already proven in post-generator.ts |
| Review deduplication | Custom diffing logic | Prisma `upsert` on `googleReviewId` unique constraint | Database handles race conditions |

## Common Pitfalls

### Pitfall 1: GBP API StarRating Enum vs Integer
**What goes wrong:** The GBP API returns star ratings as string enums ("ONE", "TWO", etc.) but the Prisma model stores them as `Int`.
**Why it happens:** Different data representations between GBP API and local database.
**How to avoid:** Create a mapping constant `{ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }` and convert during sync.
**Warning signs:** Reviews showing up with rating 0 or null.

### Pitfall 2: Review Resource Name Format
**What goes wrong:** The GBP API review resource name is `accounts/{accountId}/locations/{locationId}/reviews/{reviewId}`. The `reviewId` field is separate from the `name` field.
**Why it happens:** GBP API uses hierarchical resource names that include the full path.
**How to avoid:** Store the full `name` as `googleReviewId` so you can use it directly for the reply endpoint. The `reviewId` alone is NOT enough -- you need the full resource path for `updateReply`.
**Warning signs:** 404 errors when trying to publish replies.

### Pitfall 3: Reviews Without Comments
**What goes wrong:** Google allows rating-only reviews (no text). AI response generation fails or produces awkward responses.
**Why it happens:** Not all reviewers write comments; some just leave a star rating.
**How to avoid:** Handle null `comment` in the prompt. For rating-only reviews, generate shorter, generic responses acknowledging the rating.
**Warning signs:** Claude generating responses that reference non-existent review text.

### Pitfall 4: Reply Already Exists
**What goes wrong:** Trying to generate a response for a review that already has a reply (either from GBP directly or a previous sync).
**Why it happens:** The review was replied to outside the app, or a race condition during sync.
**How to avoid:** During sync, check if `reviewReply` exists in the GBP data. If so, skip response generation or mark as already replied.
**Warning signs:** Duplicate replies appearing on Google.

### Pitfall 5: BullMQ Scheduler Duplication
**What goes wrong:** Multiple instances of the repeatable job scheduler get created, causing duplicate syncs.
**Why it happens:** `upsertJobScheduler` is called on every server restart without a stable scheduler ID.
**How to avoid:** Use a fixed, deterministic scheduler ID like `"review-sync-scheduler"`. The `upsert` semantics handle deduplication as long as the ID is consistent.
**Warning signs:** Reviews being synced multiple times per interval.

### Pitfall 6: ReviewReply Max Size
**What goes wrong:** Generated response exceeds 4096 bytes (GBP limit for reply comments).
**Why it happens:** Claude generates a verbose response without explicit length constraint.
**How to avoid:** Set `max_tokens: 512` in the Claude API call and include max length in the system prompt. Validate byte length before publishing.
**Warning signs:** 400 errors from GBP API when publishing replies.

## Code Examples

### Review Sync Worker
```typescript
// src/workers/review-sync.worker.ts
import { Worker, Job } from "bullmq";
import { redisConnection } from "@/lib/queue/connection";
import { prisma } from "@/lib/prisma";
import { fetchReviews, STAR_RATING_MAP } from "@/lib/google-reviews";
import { generateReviewResponse } from "@/lib/review-responder";

const worker = new Worker(
  "review-sync",
  async (job: Job) => {
    const profiles = await prisma.profile.findMany({
      where: { isConnected: true },
      include: { googleAccount: true },
    });

    for (const profile of profiles) {
      if (!profile.accountResourceName) continue;

      try {
        let pageToken: string | undefined;
        do {
          const data = await fetchReviews(
            profile.googleAccountId,
            profile.accountResourceName,
            profile.locationName,
            pageToken
          );

          for (const gbpReview of data.reviews ?? []) {
            // Upsert review -- skip if already exists
            const existing = await prisma.review.findUnique({
              where: { googleReviewId: gbpReview.name },
            });

            if (existing) continue; // Already synced

            // Skip reviews that already have a reply on Google
            if (gbpReview.reviewReply) continue;

            const review = await prisma.review.create({
              data: {
                profileId: profile.id,
                googleReviewId: gbpReview.name,
                reviewerName: gbpReview.reviewer.isAnonymous
                  ? null
                  : gbpReview.reviewer.displayName,
                rating: STAR_RATING_MAP[gbpReview.starRating] ?? 0,
                comment: gbpReview.comment ?? null,
                reviewDate: new Date(gbpReview.createTime),
              },
            });

            // Generate AI response
            const aiResponse = await generateReviewResponse({
              businessName: profile.name,
              businessCategory: profile.category,
              reviewerName: review.reviewerName,
              starRating: review.rating,
              reviewComment: review.comment,
            });

            await prisma.reviewResponse.create({
              data: {
                reviewId: review.id,
                content: aiResponse.response,
                status: profile.autoApproveReviews ? "APPROVED" : "DRAFTED",
              },
            });

            // Auto-publish if enabled
            if (profile.autoApproveReviews) {
              // Queue for publishing (separate job for retry handling)
              await reviewPublishQueue.add(
                `publish-reply-${review.id}`,
                { reviewResponseId: review.id }
              );
            }
          }

          pageToken = data.nextPageToken;
        } while (pageToken);
      } catch (error) {
        console.error(`Review sync failed for profile ${profile.id}:`, error);
        // Continue to next profile
      }
    }
  },
  { connection: redisConnection, concurrency: 1 }
);
```

### Publishing a Review Reply
```typescript
// Source: https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/updateReply
export async function publishReviewReply(
  googleAccountId: string,
  reviewResourceName: string, // Full path: accounts/{id}/locations/{id}/reviews/{id}
  comment: string
): Promise<void> {
  const oauth2Client = await createGoogleClient(googleAccountId);

  // PUT to .../reply with { comment } body
  await oauth2Client.request({
    url: `https://mybusiness.googleapis.com/v4/${reviewResourceName}/reply`,
    method: "PUT",
    data: { comment },
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| BullMQ `queue.add` with `repeat` option | `queue.upsertJobScheduler` | BullMQ v5+ | Cleaner API, upsert semantics prevent duplicate schedulers |
| Manual cron with node-cron | BullMQ repeatable jobs | N/A | Process restart resilience, Redis-backed persistence |
| GBP API v3 | GBP API v4 (mybusiness.googleapis.com/v4) | 2022+ | Current stable version, same as used in project |

## Open Questions

1. **GBP API Rate Limits for Reviews**
   - What we know: The API has rate limits but exact numbers for review endpoints are not publicly documented in detail.
   - What's unclear: Exact requests-per-minute limit for reviews.list per account.
   - Recommendation: Start with 30-minute sync intervals. Add exponential backoff on 429 responses. Monitor in production.

2. **Worker Process Hosting**
   - What we know: BullMQ workers need a long-running Node.js process. Next.js serverless functions time out.
   - What's unclear: How the existing post-publish worker is currently run (no worker file found in `src/workers/`).
   - Recommendation: Create a standalone worker entry point (`src/workers/index.ts`) that runs both the review-sync and review-publish workers. Run with `tsx src/workers/index.ts` as a separate process.

3. **Handling Updated Reviews**
   - What we know: Reviewers can edit their reviews after posting. The API returns `updateTime`.
   - What's unclear: Whether to re-generate AI responses when a review is edited.
   - Recommendation: On sync, check `updateTime` against stored `updatedAt`. If review text changed, update the stored review and regenerate the response (resetting status to DRAFTED).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Not yet configured (no test framework detected) |
| Config file | none -- see Wave 0 |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| R4.1 | Review sync fetches from GBP API, stores in DB | integration | `npx vitest run tests/review-sync.test.ts -t "sync"` | No - Wave 0 |
| R4.2 | Reviews API returns reviews with filters | unit | `npx vitest run tests/api/reviews.test.ts` | No - Wave 0 |
| R4.3 | Claude generates review response | unit | `npx vitest run tests/review-responder.test.ts` | No - Wave 0 |
| R4.4 | Response varies by sentiment/rating | unit | `npx vitest run tests/review-responder.test.ts -t "sentiment"` | No - Wave 0 |
| R4.5 | Auto-approve publishes without human review | integration | `npx vitest run tests/review-sync.test.ts -t "auto-approve"` | No - Wave 0 |
| R4.6 | Publish reply via GBP API | unit | `npx vitest run tests/google-reviews.test.ts -t "publish"` | No - Wave 0 |
| R4.7 | Status transitions tracked correctly | unit | `npx vitest run tests/api/reviews.test.ts -t "status"` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` -- test framework configuration (vitest recommended for Next.js + TypeScript)
- [ ] `tests/review-sync.test.ts` -- covers R4.1, R4.5
- [ ] `tests/review-responder.test.ts` -- covers R4.3, R4.4
- [ ] `tests/google-reviews.test.ts` -- covers R4.6
- [ ] `tests/api/reviews.test.ts` -- covers R4.2, R4.7
- [ ] Framework install: `npm install -D vitest @vitejs/plugin-react`

## Sources

### Primary (HIGH confidence)
- [GBP Reviews List API](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list) - Endpoint, params, response structure
- [GBP Reviews UpdateReply API](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/updateReply) - Reply endpoint, request format
- [GBP Review Resource](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews) - Review object fields, StarRating enum, ReviewReply structure
- [BullMQ Job Schedulers](https://docs.bullmq.io/guide/job-schedulers) - upsertJobScheduler API, every/cron options
- Existing codebase: `src/lib/google-posts.ts`, `src/lib/post-generator.ts`, `src/lib/queue/publish-queue.ts` - Established patterns

### Secondary (MEDIUM confidence)
- [BullMQ Repeatable Jobs](https://docs.bullmq.io/guide/jobs/repeatable) - Legacy repeatable pattern documentation
- [Claude Prompt Engineering](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-4-best-practices) - Best practices for prompt design

### Tertiary (LOW confidence)
- GBP API rate limits - Not officially documented per-endpoint; recommendation based on community experience

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already installed and used in the project
- Architecture: HIGH - Follows established patterns from post generation feature
- GBP Reviews API: HIGH - Verified against official Google documentation
- BullMQ schedulers: HIGH - Verified against official BullMQ documentation
- Pitfalls: MEDIUM - Based on API documentation and common integration issues
- AI prompt design: MEDIUM - Based on existing project pattern and general best practices

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable APIs, 30-day validity)
