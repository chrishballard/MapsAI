# Phase 4: Post Approval & Publishing - Research

**Researched:** 2026-03-04
**Domain:** GBP Local Posts API, BullMQ job queue, scheduling logic, retry patterns
**Confidence:** HIGH

## Summary

Phase 4 adds post approval, scheduling, and automated publishing via the Google Business Profile API. The core workflow is: approve drafts (individual or bulk) -> auto-schedule across the month at weekly cadence -> BullMQ delayed jobs fire at scheduled times -> publish worker calls GBP API -> track status and retry failures.

The GBP Local Posts API (v4) is the endpoint for creating posts. It lives at `mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/localPosts` and requires the `business.manage` OAuth scope (already configured in the codebase). The `googleapis` npm package does not expose a typed client for the v4 My Business localPosts -- you must use `oauth2Client.request()` directly with the raw URL. The existing `createGoogleClient()` and `refreshTokenIfNeeded()` utilities in `src/lib/google.ts` handle token refresh and can be reused directly.

BullMQ v5 with Redis is the standard Node.js job queue for this use case. It supports delayed jobs (fire at a specific timestamp), exponential backoff retries, and runs as a separate worker process alongside the Next.js app. Railway provides a one-click Redis add-on with auto-provisioned `REDIS_URL`.

**Primary recommendation:** Use BullMQ v5 with delayed jobs (not cron/repeatable) to schedule each post at its specific publish time. Run the worker as a separate process in the same Docker container using a custom entrypoint script. Use `oauth2Client.request()` for the GBP localPosts v4 API since no typed client exists in the googleapis package.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| R3.2 | Approve individual posts or bulk-approve all drafts for a profile/month | API routes for PATCH (individual) and batch approve; update Post.status from DRAFT to APPROVED |
| R3.3 | On approval, auto-schedule posts evenly across the month (weekly cadence) | Scheduling algorithm distributes posts across remaining weeks; sets scheduledAt and status=SCHEDULED; creates BullMQ delayed jobs |
| R3.4 | Scheduled posts publish automatically via GBP API at their scheduled time | BullMQ delayed job fires at scheduledAt; publish worker calls GBP v4 localPosts.create; updates status to PUBLISHED with googlePostId |
| R3.5 | Track publish status and handle failures with retry logic | BullMQ attempts + exponential backoff; on final failure set status=FAILED with errorMessage; UI shows status badges |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| bullmq | ^5.70 | Job queue for scheduled publishing | Industry standard Node.js queue; delayed jobs, retries, backoff built-in |
| ioredis | (peer dep of bullmq) | Redis client | BullMQ uses ioredis internally; auto-installed as dependency |
| googleapis | ^171.4.0 (already installed) | GBP API calls | Already in project; provides OAuth2Client for raw API requests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Redis (Railway add-on) | 7.x | Job queue backing store | Required for BullMQ; Railway provides one-click setup |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| BullMQ | node-cron + setTimeout | No persistence, no retry, no visibility -- unsuitable for production |
| BullMQ | Agenda.js | MongoDB-backed; adds another database dependency; BullMQ is more modern |
| Delayed jobs per post | Repeatable cron job that polls DB | Simpler setup but adds latency (polling interval) and wastes resources checking for ready posts |

**Installation:**
```bash
npm install bullmq
```

Note: `ioredis` is a dependency of `bullmq` and installs automatically.

## Architecture Patterns

### Recommended Project Structure
```
src/
  lib/
    google.ts              # Existing: OAuth client, token refresh
    google-posts.ts        # NEW: GBP localPosts API calls
    queue/
      connection.ts        # Redis connection config (shared)
      publish-queue.ts     # Queue instance for post publishing
  app/
    api/
      posts/
        [id]/
          approve/
            route.ts       # POST: approve single post
        approve/
          route.ts         # POST: bulk approve posts
        route.ts           # Existing: GET list posts
workers/
  publish-worker.ts        # Standalone worker process entry point
scripts/
  start-worker.sh          # Script to run worker process
```

### Pattern 1: GBP Local Posts API via oauth2Client.request()
**What:** The v4 My Business API for localPosts has no typed client in the googleapis package. Use the OAuth2Client's raw request method.
**When to use:** All GBP post creation/management calls.
**Example:**
```typescript
// src/lib/google-posts.ts
import { createGoogleClient } from "./google";
import { prisma } from "./prisma";

interface CreatePostParams {
  googleAccountId: string;
  accountResourceName: string; // "accounts/123"
  locationName: string;        // "locations/456"
  summary: string;
  topicType: "STANDARD" | "EVENT" | "OFFER";
  callToAction?: {
    actionType: "BOOK" | "ORDER" | "SHOP" | "LEARN_MORE" | "SIGN_UP" | "CALL";
    url?: string;
  };
  event?: {
    title: string;
    schedule: {
      startDate: { year: number; month: number; day: number };
      startTime: { hours: number; minutes: number; seconds: number; nanos: number };
      endDate: { year: number; month: number; day: number };
      endTime: { hours: number; minutes: number; seconds: number; nanos: number };
    };
  };
  offer?: {
    couponCode?: string;
    redeemOnlineUrl?: string;
    termsConditions?: string;
  };
}

export async function createGBPPost(params: CreatePostParams) {
  const oauth2Client = await createGoogleClient(params.googleAccountId);

  const parent = `${params.accountResourceName}/${params.locationName}`;
  const url = `https://mybusiness.googleapis.com/v4/${parent}/localPosts`;

  const requestBody: Record<string, unknown> = {
    languageCode: "en-US",
    summary: params.summary,
    topicType: params.topicType,
  };

  if (params.callToAction) {
    requestBody.callToAction = params.callToAction;
  }
  if (params.event) {
    requestBody.event = params.event;
  }
  if (params.offer) {
    requestBody.offer = params.offer;
  }

  const response = await oauth2Client.request({
    url,
    method: "POST",
    data: requestBody,
  });

  return response.data;
}
```

### Pattern 2: BullMQ Queue + Delayed Jobs
**What:** Add a job to the queue with a delay calculated from the target publish time. The job sits in a "delayed" set and automatically moves to "waiting" when the time arrives.
**When to use:** Every time a post is scheduled (after approval).
**Example:**
```typescript
// src/lib/queue/connection.ts
import { ConnectionOptions } from "bullmq";

export const redisConnection: ConnectionOptions = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null, // Required for BullMQ workers
};

// Alternative: parse REDIS_URL if using Railway
// import { URL } from "url";
// const redisUrl = new URL(process.env.REDIS_URL!);
// export const redisConnection: ConnectionOptions = {
//   host: redisUrl.hostname,
//   port: parseInt(redisUrl.port),
//   password: redisUrl.password || undefined,
//   maxRetriesPerRequest: null,
// };
```

```typescript
// src/lib/queue/publish-queue.ts
import { Queue } from "bullmq";
import { redisConnection } from "./connection";

export interface PublishJobData {
  postId: string;
}

export const publishQueue = new Queue<PublishJobData>("post-publish", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 60000, // 1 minute initial, then 2min, 4min
    },
    removeOnComplete: 100, // Keep last 100 completed
    removeOnFail: 200,     // Keep last 200 failed for debugging
  },
});

export async function schedulePostPublish(postId: string, publishAt: Date) {
  const delay = publishAt.getTime() - Date.now();
  if (delay < 0) {
    // If scheduled time is in the past, publish immediately
    return publishQueue.add("publish", { postId }, { delay: 0 });
  }
  return publishQueue.add("publish", { postId }, { delay });
}
```

### Pattern 3: Separate Worker Process
**What:** Run the BullMQ worker as a separate Node.js process, not inside Next.js server.
**When to use:** Always in production. Workers must run independently to process jobs reliably.
**Example:**
```typescript
// workers/publish-worker.ts
import { Worker, Job } from "bullmq";
import { redisConnection } from "../src/lib/queue/connection";
import { PublishJobData } from "../src/lib/queue/publish-queue";
import { prisma } from "../src/lib/prisma";
import { createGBPPost } from "../src/lib/google-posts";

const worker = new Worker<PublishJobData>(
  "post-publish",
  async (job: Job<PublishJobData>) => {
    const { postId } = job.data;

    const post = await prisma.post.findUniqueOrThrow({
      where: { id: postId },
      include: {
        profile: {
          include: { googleAccount: true },
        },
      },
    });

    if (post.status === "PUBLISHED") {
      console.log(`Post ${postId} already published, skipping`);
      return;
    }

    // Map PostType enum to GBP topicType
    const topicTypeMap: Record<string, string> = {
      WHATS_NEW: "STANDARD",
      EVENT: "EVENT",
      OFFER: "OFFER",
    };

    const result = await createGBPPost({
      googleAccountId: post.profile.googleAccountId,
      accountResourceName: post.profile.accountResourceName,
      locationName: post.profile.locationName,
      summary: post.content,
      topicType: topicTypeMap[post.type] as "STANDARD" | "EVENT" | "OFFER",
      callToAction: post.callToAction
        ? { actionType: "LEARN_MORE", url: post.callToAction }
        : undefined,
    });

    await prisma.post.update({
      where: { id: postId },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        googlePostId: result.name || null,
      },
    });

    console.log(`Published post ${postId} as ${result.name}`);
  },
  {
    connection: { ...redisConnection, maxRetriesPerRequest: null },
    concurrency: 5,
  }
);

worker.on("failed", async (job, err) => {
  if (!job) return;
  console.error(`Post publish job ${job.id} failed:`, err.message);

  // On final failure, update post status
  if (job.attemptsMade >= (job.opts.attempts || 3)) {
    await prisma.post.update({
      where: { id: job.data.postId },
      data: {
        status: "FAILED",
        errorMessage: err.message,
      },
    });
  }
});

worker.on("completed", (job) => {
  console.log(`Post publish job ${job.id} completed`);
});

console.log("Publish worker started, waiting for jobs...");
```

### Pattern 4: Scheduling Algorithm (Weekly Cadence)
**What:** Distribute approved posts evenly across remaining weeks of the month.
**When to use:** On bulk approval or individual approval.
**Example:**
```typescript
// src/lib/scheduling.ts

/**
 * Distribute posts evenly across remaining weeks of the target month.
 * Posts are scheduled for Tuesdays at 10:00 AM local time (best engagement).
 */
export function calculateScheduleDates(
  postCount: number,
  targetMonth: number, // 0-11
  targetYear: number,
  timezone: string = "America/New_York"
): Date[] {
  const dates: Date[] = [];
  const now = new Date();

  // Find all Tuesdays in the target month
  const tuesdays: Date[] = [];
  const date = new Date(targetYear, targetMonth, 1);
  while (date.getMonth() === targetMonth) {
    if (date.getDay() === 2) { // Tuesday
      const tuesday = new Date(date);
      tuesday.setHours(10, 0, 0, 0); // 10:00 AM
      if (tuesday > now) {
        tuesdays.push(tuesday);
      }
    }
    date.setDate(date.getDate() + 1);
  }

  // Distribute posts evenly across available Tuesdays
  if (tuesdays.length === 0) return dates;

  for (let i = 0; i < postCount; i++) {
    const tuesdayIndex = i % tuesdays.length;
    dates.push(tuesdays[tuesdayIndex]);
  }

  return dates.sort((a, b) => a.getTime() - b.getTime());
}
```

### Anti-Patterns to Avoid
- **Running BullMQ worker inside Next.js API routes:** Workers must be persistent processes. Next.js serverless/edge functions can cold-start and don't maintain long-running connections. Always run workers as separate processes.
- **Using `setInterval`/`setTimeout` for scheduling:** No persistence across restarts, no retry logic, no visibility into job state. Use BullMQ delayed jobs.
- **Using ioredis `keyPrefix` option:** BullMQ has its own prefix mechanism. Using ioredis keyPrefix will break BullMQ.
- **Polling the database for scheduled posts:** Wasteful and adds latency. BullMQ delayed jobs are event-driven and fire precisely when needed.
- **Not setting `maxRetriesPerRequest: null` on worker connections:** BullMQ workers require this setting. Without it, the worker will throw errors on Redis reconnection.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Job queue | Custom database polling + cron | BullMQ + Redis | Persistence, retries, backoff, delayed jobs, monitoring -- all built-in |
| Retry logic | Custom try/catch with setTimeout | BullMQ `attempts` + `backoff` options | Handles exponential backoff, max attempts, failure tracking automatically |
| Token refresh | Manual expiry checking per API call | Existing `createGoogleClient()` in `src/lib/google.ts` | Already implements 5-minute buffer refresh logic |
| Scheduled execution | node-cron or setInterval | BullMQ delayed jobs | Persists across restarts, exact timestamp targeting, scales horizontally |

**Key insight:** BullMQ's delayed job feature is purpose-built for "run this job at time X" use cases. Each approved post becomes a single delayed job with `delay = scheduledAt - now`. No polling, no cron, no custom scheduling infrastructure needed.

## Common Pitfalls

### Pitfall 1: GBP API Parent Path Construction
**What goes wrong:** API calls fail with 404 because the parent path is malformed.
**Why it happens:** The localPosts v4 API requires `accounts/{accountId}/locations/{locationId}` but the Profile model stores `locationName` as just `locations/{id}`. The GBP account resource name (e.g., `accounts/123`) is not currently stored in the database.
**How to avoid:** Add an `accountResourceName` field to the Profile model (or GoogleAccount model) during the location sync. The `mybusinessaccountmanagement.accounts.list()` response provides `account.name` which is the required format.
**Warning signs:** 404 or "resource not found" errors from the GBP API.

### Pitfall 2: GBP topicType Mapping
**What goes wrong:** API rejects posts because `WHATS_NEW` is not a valid topicType.
**Why it happens:** The Post model uses `WHATS_NEW` as the enum value, but the GBP API uses `STANDARD` for the same post type.
**How to avoid:** Map `WHATS_NEW` -> `STANDARD` before sending to the API. `EVENT` and `OFFER` map directly.
**Warning signs:** 400 errors with "invalid topicType" from GBP API.

### Pitfall 3: Redis Connection String Parsing
**What goes wrong:** BullMQ fails to connect to Redis on Railway.
**Why it happens:** Railway provides a `REDIS_URL` string like `redis://default:password@host:port` but BullMQ/ioredis expects separate host/port/password options (or the URL parsed).
**How to avoid:** Parse `REDIS_URL` with the Node.js `URL` class or use ioredis's URL connection support. Test Redis connectivity before starting the worker.
**Warning signs:** `ECONNREFUSED` or `ENOTFOUND` errors on startup.

### Pitfall 4: Worker Process Not Running in Production
**What goes wrong:** Posts get scheduled but never publish.
**Why it happens:** The BullMQ worker is not started as a separate process in the deployment configuration.
**How to avoid:** Update `Dockerfile` or Railway config to start both the Next.js server and the worker process. Use a process manager or a simple shell script that starts both.
**Warning signs:** Jobs sitting in "delayed" or "waiting" state indefinitely.

### Pitfall 5: OAuth Token Expiry During Batch Publishing
**What goes wrong:** First few posts publish fine, then remaining ones fail with 401.
**Why it happens:** Access token expires mid-batch (tokens last ~1 hour). The `refreshTokenIfNeeded` function checks expiry but if many posts publish at the same scheduled time, concurrent calls may race on token refresh.
**How to avoid:** The existing `createGoogleClient()` calls `refreshTokenIfNeeded()` which has a 5-minute buffer. For concurrent publishes, consider a simple mutex/lock per GoogleAccount to serialize token refreshes, or set worker concurrency to 1 per account.
**Warning signs:** Sporadic 401 errors on publish, especially during high-volume scheduling.

### Pitfall 6: Scheduling Posts for Past Dates
**What goes wrong:** Approved posts get negative delay values, causing immediate publish or errors.
**Why it happens:** Posts approved late in the month when some scheduled dates have already passed.
**How to avoid:** The scheduling algorithm must only use future dates. If no future Tuesdays remain in the month, schedule for the next month or publish immediately. Always check `delay > 0` before creating a delayed job.
**Warning signs:** Posts publishing immediately instead of on schedule.

## Code Examples

### Approval API Route (Individual)
```typescript
// src/app/api/posts/[id]/approve/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateScheduleDates } from "@/lib/scheduling";
import { schedulePostPublish } from "@/lib/queue/publish-queue";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const post = await prisma.post.findUnique({ where: { id } });

  if (!post || post.status !== "DRAFT") {
    return NextResponse.json({ error: "Post not found or not a draft" }, { status: 400 });
  }

  // Calculate schedule date (next available Tuesday)
  const now = new Date();
  const [scheduledAt] = calculateScheduleDates(1, now.getMonth(), now.getFullYear());

  if (!scheduledAt) {
    return NextResponse.json({ error: "No available schedule dates" }, { status: 400 });
  }

  // Update post status and schedule
  const updated = await prisma.post.update({
    where: { id },
    data: {
      status: "SCHEDULED",
      scheduledAt,
    },
  });

  // Create delayed job in BullMQ
  await schedulePostPublish(id, scheduledAt);

  return NextResponse.json({ post: updated });
}
```

### Bulk Approval API Route
```typescript
// src/app/api/posts/approve/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateScheduleDates } from "@/lib/scheduling";
import { schedulePostPublish } from "@/lib/queue/publish-queue";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { profileId, month, year } = await request.json();

  // Find all draft posts for this profile/month
  const startOfMonth = new Date(year, month, 1);
  const endOfMonth = new Date(year, month + 1, 0);

  const drafts = await prisma.post.findMany({
    where: {
      profileId,
      status: "DRAFT",
      createdAt: { gte: startOfMonth, lte: endOfMonth },
    },
    orderBy: { createdAt: "asc" },
  });

  if (drafts.length === 0) {
    return NextResponse.json({ error: "No drafts to approve" }, { status: 400 });
  }

  // Calculate schedule dates for all posts
  const scheduleDates = calculateScheduleDates(drafts.length, month, year);

  // Update posts and create jobs
  const results = [];
  for (let i = 0; i < drafts.length; i++) {
    const scheduledAt = scheduleDates[i];
    if (!scheduledAt) continue;

    const updated = await prisma.post.update({
      where: { id: drafts[i].id },
      data: {
        status: "SCHEDULED",
        scheduledAt,
      },
    });

    await schedulePostPublish(drafts[i].id, scheduledAt);
    results.push(updated);
  }

  return NextResponse.json({ approved: results.length, posts: results });
}
```

### Docker/Railway Worker Entrypoint
```bash
#!/bin/sh
# scripts/start.sh - Run both Next.js and the publish worker

# Start the publish worker in background
node --import tsx workers/publish-worker.ts &
WORKER_PID=$!

# Start Next.js
npm run start &
NEXT_PID=$!

# Wait for either to exit
wait -n $WORKER_PID $NEXT_PID

# If one dies, kill the other
kill $WORKER_PID $NEXT_PID 2>/dev/null
exit 1
```

Update Dockerfile:
```dockerfile
# Add to existing Dockerfile
COPY scripts/start.sh /app/scripts/start.sh
RUN chmod +x /app/scripts/start.sh
CMD ["/app/scripts/start.sh"]
```

## GBP API Reference

### Post Types and Required Fields

| Post Type (internal) | GBP topicType | Required Fields | Optional Fields |
|---------------------|---------------|-----------------|-----------------|
| WHATS_NEW | STANDARD | summary, languageCode | media, callToAction |
| EVENT | EVENT | summary, languageCode, event.title, event.schedule | media, callToAction |
| OFFER | OFFER | summary, languageCode | offer.couponCode, offer.redeemOnlineUrl, offer.termsConditions, media |

### Call to Action Types
BOOK, ORDER, SHOP, LEARN_MORE, SIGN_UP, CALL

### Event Schedule Format
```json
{
  "startDate": { "year": 2026, "month": 3, "day": 15 },
  "startTime": { "hours": 9, "minutes": 0, "seconds": 0, "nanos": 0 },
  "endDate": { "year": 2026, "month": 3, "day": 15 },
  "endTime": { "hours": 17, "minutes": 0, "seconds": 0, "nanos": 0 }
}
```

### API Endpoint
```
POST https://mybusiness.googleapis.com/v4/{parent}/localPosts
```
Where parent = `accounts/{accountId}/locations/{locationId}`

### OAuth Scope
`https://www.googleapis.com/auth/business.manage` (already configured in `src/lib/google.ts`)

### Response
Returns the created LocalPost object with `name` field (resource name for the post, e.g., `accounts/123/locations/456/localPosts/789`).

## Schema Changes Required

### Add accountResourceName to Profile
The GBP localPosts API requires the full path `accounts/{id}/locations/{id}` but the current Profile model only stores `locationName` (format: `locations/{id}`). The GBP account resource name must be stored.

**Option A (recommended):** Add `accountResourceName` to the Profile model:
```prisma
model Profile {
  // ... existing fields
  accountResourceName String? // "accounts/123" - needed for GBP API calls
}
```
Then update `syncLocationsForAccount()` to save `account.name` into this field.

**Option B:** Add it to the GoogleAccount model (less ideal because one Google account can have multiple GBP accounts under it).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Bull (v3) | BullMQ (v5) | BullMQ has been the successor since 2021 | Better TypeScript support, no QueueScheduler needed in v5, cleaner API |
| QueueScheduler class required | Built into Worker in BullMQ v4+ | BullMQ v4 (2023) | No separate QueueScheduler process needed; workers handle delayed job promotion internally |
| google.mybusiness('v4') client | oauth2Client.request() raw calls | N/A - v4 never had a typed client in googleapis | Must construct URLs and request bodies manually |

**Important BullMQ v5 note:** In BullMQ v5, the `QueueScheduler` is no longer needed. Workers automatically handle delayed job promotion. This simplifies deployment (only need worker + queue, no scheduler process).

## Open Questions

1. **GBP Account Resource Name Storage**
   - What we know: The localPosts API needs `accounts/{id}/locations/{id}` as parent. The Profile model has `locationName` (e.g., `locations/456`) but not the account resource name.
   - What's unclear: Whether to store it on Profile or GoogleAccount, and whether existing synced profiles need a migration to backfill this.
   - Recommendation: Add `accountResourceName` to Profile model. Update `syncLocationsForAccount()` to save it during sync. Add a migration that triggers a re-sync for existing profiles.

2. **OFFER and EVENT Post Publishing**
   - What we know: OFFER posts need optional coupon/URL/terms. EVENT posts need title + schedule with start/end date/time.
   - What's unclear: The current Post model doesn't store event or offer metadata (title, dates, coupon code).
   - Recommendation: For MVP, focus on WHATS_NEW/STANDARD posts which only need summary + optional CTA. Add event/offer metadata fields to the Post model in a follow-up or handle at approval time. Most auto-generated posts will be WHATS_NEW type anyway.

3. **Timezone Handling for Scheduling**
   - What we know: Posts should publish at a good local time for the business (e.g., 10 AM).
   - What's unclear: Whether to use the business's timezone (from GBP profile address) or a fixed timezone.
   - Recommendation: Default to America/New_York for MVP. Add timezone per profile later if needed. Store all scheduledAt in UTC; apply timezone offset when calculating schedule dates.

4. **Worker Process Management on Railway**
   - What we know: Railway runs Docker containers. We need both Next.js and the BullMQ worker running.
   - What's unclear: Whether to use a single container with a process manager or two separate Railway services.
   - Recommendation: Single container with a shell script that starts both processes. Simpler and cheaper. Two services adds complexity and cost. The worker is lightweight (no HTTP server).

## Sources

### Primary (HIGH confidence)
- [GBP localPosts resource](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts) - Post types, fields, resource structure
- [GBP localPosts.create](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts/create) - API endpoint, auth scopes
- [GBP Posts Data guide](https://developers.google.com/my-business/content/posts-data) - Request body examples for each post type
- [BullMQ official docs](https://docs.bullmq.io) - Queue, Worker, delayed jobs, connections, retries
- [BullMQ delayed jobs](https://docs.bullmq.io/guide/jobs/delayed) - Delay calculation, timestamp targeting
- [BullMQ job schedulers](https://docs.bullmq.io/guide/job-schedulers) - Repeatable/cron patterns (not used but referenced)
- [BullMQ connections](https://docs.bullmq.io/guide/connections) - ioredis options, maxRetriesPerRequest requirement

### Secondary (MEDIUM confidence)
- [Better Stack BullMQ guide](https://betterstack.com/community/guides/scaling-nodejs/bullmq-scheduled-tasks/) - Queue setup, worker patterns, retry config
- [Railway Redis docs](https://docs.railway.com/guides/redis) - Redis add-on setup, REDIS_URL provisioning
- [googleapis/google-api-nodejs-client#3007](https://github.com/googleapis/google-api-nodejs-client/issues/3007) - Confirmed raw request pattern for localPosts

### Tertiary (LOW confidence)
- Worker deployment patterns (Railway + Docker) based on community patterns; should be validated during implementation

## Metadata

**Confidence breakdown:**
- GBP API: HIGH - Official Google docs verified, request/response formats documented with examples
- BullMQ setup: HIGH - Official docs verified, delayed jobs well-documented, v5 current
- Architecture (worker process): MEDIUM - Based on community patterns and BullMQ docs, but Railway-specific deployment needs testing
- Scheduling algorithm: HIGH - Simple date math, no external dependencies
- Schema changes: HIGH - Clear gap identified (missing accountResourceName), straightforward fix
- Pitfalls: HIGH - Common issues well-documented in BullMQ docs and GBP API issues

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable domain; GBP API v4 is mature, BullMQ v5 is stable)
