# Architecture Patterns

**Domain:** Google Business Profile management tool
**Researched:** 2026-03-04

## Recommended Architecture

**Monolithic full-stack app with a separate worker process.**

```
                    +------------------+
                    |   Railway Host   |
                    +------------------+
                           |
              +------------+------------+
              |                         |
    +---------v---------+    +----------v----------+
    |   Next.js App     |    |   BullMQ Worker     |
    |                   |    |                     |
    | - Dashboard UI    |    | - Post publishing   |
    | - API routes      |    | - Review polling    |
    | - Auth (next-auth)|    | - AI generation     |
    | - Job enqueuing   |    | - PDF generation    |
    +---------+---------+    +----------+----------+
              |                         |
              +------------+------------+
                           |
              +------------+------------+
              |                         |
    +---------v---------+    +----------v----------+
    |   PostgreSQL      |    |   Redis             |
    |                   |    |                     |
    | - Profiles        |    | - BullMQ queues     |
    | - Posts           |    | - API response cache|
    | - Reviews         |    | - Rate limit state  |
    | - Users           |    |                     |
    | - Reports         |    |                     |
    +-------------------+    +---------------------+
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| Next.js Web App | UI rendering, API routes, authentication, job enqueuing | PostgreSQL, Redis (enqueue jobs), Google OAuth |
| BullMQ Worker | Background job processing (publish posts, poll reviews, generate AI content, create PDFs) | PostgreSQL, Redis (consume jobs), Google Business Profile API, Claude API |
| PostgreSQL | Persistent data storage for all business entities | Web App, Worker |
| Redis | Job queue backend, short-lived caches, rate limiting | Web App (producer), Worker (consumer) |

### Data Flow

**Post Creation Flow:**
1. User creates post in dashboard (Next.js UI)
2. If AI-generated: API route calls Claude API, returns draft
3. User reviews/edits draft, clicks "Approve" or "Schedule"
4. API route saves post to PostgreSQL with `status: 'approved'` and `scheduled_at` timestamp
5. API route enqueues job to BullMQ `post-publish` queue with delay
6. Worker picks up job at scheduled time, calls GBP API to publish
7. Worker updates post status in PostgreSQL to `published` or `failed`

**Review Monitoring Flow:**
1. BullMQ repeating job runs every 15 minutes on `review-check` queue
2. Worker fetches recent reviews from GBP API for all profiles
3. Worker stores new reviews in PostgreSQL
4. For each new review, worker enqueues `review-respond` job
5. `review-respond` worker calls Claude API to generate response draft
6. Draft stored in PostgreSQL with `status: 'pending_approval'`
7. User sees pending responses in dashboard, approves/edits
8. On approval, API route enqueues `review-publish` job
9. Worker publishes response via GBP API

**PDF Report Flow:**
1. User requests report or cron job triggers it
2. Job enqueued to `report-generate` queue
3. Worker launches Puppeteer, navigates to internal report page with data
4. Puppeteer renders to PDF, worker saves file (or uploads to storage)
5. Report record updated in PostgreSQL with file URL

## Patterns to Follow

### Pattern 1: Queue-Based GBP API Access
**What:** ALL Google Business Profile API calls go through BullMQ queues, never from API routes directly.
**When:** Every interaction with the GBP API.
**Why:** Rate limiting, retry logic, and error tracking are centralized. If the API is down, jobs retry automatically. The dashboard stays responsive because API calls are async.

```typescript
// API route -- enqueue, don't call GBP directly
export async function POST(req: Request) {
  const { profileId, content, scheduledAt } = await req.json();

  const post = await prisma.post.create({
    data: { profileId, content, status: 'scheduled', scheduledAt }
  });

  await postPublishQueue.add('publish', { postId: post.id }, {
    delay: scheduledAt ? new Date(scheduledAt).getTime() - Date.now() : 0,
  });

  return Response.json(post);
}
```

### Pattern 2: Draft-First AI Content
**What:** AI-generated content is always saved as a draft requiring human approval before publishing.
**When:** Post generation, review responses.
**Why:** AI content quality varies. Publishing bad content to 200 business profiles is catastrophic. Human-in-the-loop is non-negotiable.

```typescript
// Status flow for all AI-generated content
type ContentStatus =
  | 'generating'      // AI is processing
  | 'draft'           // AI output ready for review
  | 'approved'        // Human approved, ready to publish/schedule
  | 'scheduled'       // Queued for future publishing
  | 'publishing'      // Currently being published via API
  | 'published'       // Successfully published
  | 'failed'          // Publishing failed (with error details)
  | 'rejected';       // Human rejected the draft
```

### Pattern 3: Profile-Scoped Operations
**What:** Every database query and API call is scoped to a specific profile (or explicit list of profiles).
**When:** All operations.
**Why:** Prevents accidental cross-profile data leaks. Makes bulk operations explicit.

```typescript
// Good: explicit profile scope
const reviews = await prisma.review.findMany({
  where: { profileId: selectedProfileId }
});

// Bad: implicit "all profiles" query
const reviews = await prisma.review.findMany(); // dangerous
```

### Pattern 4: GBP API Token Management
**What:** Store OAuth refresh tokens encrypted in PostgreSQL. Refresh access tokens automatically before they expire.
**When:** Any GBP API call.
**Why:** Access tokens expire after 1 hour. The worker must handle token refresh transparently.

```typescript
async function getGBPClient(accountId: string) {
  const account = await prisma.gbpAccount.findUnique({
    where: { id: accountId }
  });

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: decrypt(account.encryptedRefreshToken)
  });

  // googleapis handles access token refresh automatically
  return google.mybusinessbusinessinformation({ version: 'v1', auth: oauth2Client });
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Direct GBP API Calls from UI/API Routes
**What:** Calling Google Business Profile API directly from Next.js API routes.
**Why bad:** API calls can be slow (1-5 seconds). If the API rate limits you, the user sees an error. No retry logic. Dashboard becomes slow.
**Instead:** Enqueue all GBP API calls as BullMQ jobs. Return optimistic responses to the UI. Update via polling or WebSocket.

### Anti-Pattern 2: Storing GBP Data Only in Google
**What:** Not caching profile/review data locally, fetching from GBP API on every page load.
**Why bad:** Rate limits will be exhausted immediately with 200 profiles. Page loads become slow and unreliable.
**Instead:** Sync GBP data to PostgreSQL on a schedule. Dashboard reads from local database. Sync jobs update the data periodically.

### Anti-Pattern 3: Shared Queue for All Job Types
**What:** Putting all jobs (posts, reviews, reports, AI generation) in a single BullMQ queue.
**Why bad:** A slow PDF generation job blocks time-sensitive post publishing. Can't set different concurrency or rate limits per job type.
**Instead:** Separate queues per job type with independent concurrency settings.

### Anti-Pattern 4: Unbounded AI Generation
**What:** Allowing users to generate unlimited AI content without throttling.
**Why bad:** Claude API costs can spike unexpectedly. A bulk operation generating posts for 200 profiles uses ~200 API calls.
**Instead:** Implement per-user daily generation limits. Show estimated cost before batch operations. Log all AI API usage.

## Scalability Considerations

| Concern | At 200 profiles (current) | At 1,000 profiles | At 10,000 profiles |
|---------|--------------------------|--------------------|--------------------|
| Database | Single PostgreSQL instance | Same -- PostgreSQL handles this easily | Add read replicas, partition by account |
| Job Queue | Single worker process | Increase worker concurrency | Multiple worker instances, dedicated queues |
| GBP API Rate Limits | Likely within limits | Need careful rate limiting per queue | Need multiple Google Cloud projects or API key rotation |
| AI Costs | ~$5-20/month | ~$50-100/month | Significant -- need caching/templating to reduce calls |
| PDF Generation | On-demand is fine | Queue-based with concurrency limit | Dedicated PDF worker service |
| Hosting | Railway starter ($5-20/mo) | Railway pro ($20-50/mo) | Consider dedicated infrastructure |

## Database Schema (Key Tables)

```
gbp_accounts       -- Google OAuth credentials (encrypted refresh tokens)
profiles           -- Cached GBP profile data (synced periodically)
posts              -- Post content, status, scheduling info
post_approvals     -- Approval history with timestamps and user
reviews            -- Cached reviews from GBP API
review_responses   -- AI-generated response drafts and published responses
reports            -- Generated report metadata and file references
templates          -- Reusable post templates
users              -- Team members (via next-auth)
job_logs           -- Audit trail of background job results
```

## Sources

- Training data knowledge of Next.js, BullMQ, Prisma, googleapis patterns
- Architecture pattern is standard for Node.js apps with background processing
- Confidence: HIGH for architecture patterns, MEDIUM for exact GBP API endpoint names
