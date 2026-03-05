# Domain Pitfalls

**Domain:** Google Business Profile management tool
**Researched:** 2026-03-04

## Critical Pitfalls

Mistakes that cause rewrites or major issues.

### Pitfall 1: Google Business Profile API Access Approval
**What goes wrong:** The GBP API is not a standard open API. Google requires an application/approval process to access the Business Profile APIs. You cannot just enable it in Google Cloud Console and start making calls.
**Why it happens:** Developers assume Google APIs work like other APIs -- enable, get key, call. The GBP API has additional vetting.
**Consequences:** Weeks or months of delay before you can make any API calls. Entire project blocked at step 1.
**Prevention:** Apply for GBP API access IMMEDIATELY. Do this before writing any code. The application requires a description of your use case, expected API usage volume, and may require business verification.
**Detection:** You'll get 403 errors when trying to call the API even with valid OAuth tokens.
**Confidence:** MEDIUM -- the approval process existed as of early 2025; verify current requirements.

### Pitfall 2: OAuth Token Management at Scale
**What goes wrong:** OAuth access tokens expire after 1 hour. With 200 profiles across potentially multiple Google accounts, token refresh becomes a significant concern. Tokens stored insecurely leak access to all managed business profiles.
**Why it happens:** Developers test with a single account and single token. At 200 profiles, you may have multiple Google accounts, each needing its own OAuth flow and token management.
**Consequences:** Stale tokens cause mass job failures. Insecure token storage is a security breach affecting client businesses.
**Prevention:**
- Encrypt refresh tokens at rest in PostgreSQL (use `crypto.createCipheriv`, not just base64)
- The `googleapis` Node.js client handles automatic token refresh IF you set the refresh token correctly
- Build a token health check that verifies all stored tokens are still valid (tokens can be revoked)
- Alert if any account's token fails refresh
**Detection:** Background jobs start failing with 401 errors. Dashboard shows stale data.

### Pitfall 3: GBP API Rate Limits Causing Cascading Failures
**What goes wrong:** Hitting rate limits on the GBP API causes all queued jobs to fail, which triggers retries, which hit rate limits harder, creating a death spiral.
**Why it happens:** BullMQ's default retry behavior is exponential backoff, but if you have 200 profiles all queued up, the retry storm can overwhelm the API.
**Consequences:** All scheduled posts fail to publish. Review monitoring stops. Users lose trust in the tool.
**Prevention:**
- Use BullMQ's built-in rate limiter: `limiter: { max: 10, duration: 1000 }` (adjust based on actual API limits)
- Separate queues per job type so report generation doesn't starve post publishing
- Implement circuit breaker: if N consecutive API calls fail with rate limit errors, pause the queue for M minutes
- Log all API errors with full context for debugging
**Detection:** Monitor BullMQ failed job counts. Alert if failed jobs exceed threshold.

### Pitfall 4: AI Content Quality Causing Brand Damage
**What goes wrong:** AI-generated posts or review responses contain inappropriate content, factual errors, or tone-deaf responses (especially to negative reviews). This gets published to 200 business profiles.
**Why it happens:** Over-trusting AI output. Removing the human approval step "to save time." Inadequate system prompts that don't capture brand voice.
**Consequences:** Embarrassing public posts on Google. Angry business owners. Loss of trust in the tool.
**Prevention:**
- NEVER auto-publish AI content. Always require human approval.
- Build robust system prompts that include: business category, location context, tone guidelines, prohibited topics
- Add a "reject" button that logs the reason for rejection (improves prompts over time)
- Implement a content filter that checks for obvious problems (profanity, competitor mentions, medical/legal claims)
**Detection:** Review rejection rate. If >30% of AI drafts are rejected, the prompts need work.

## Moderate Pitfalls

### Pitfall 5: Syncing GBP Data vs. Using as Source of Truth
**What goes wrong:** Treating the local PostgreSQL database as the source of truth for profile data, when Google is the actual source of truth. Local data drifts from reality.
**Prevention:**
- GBP is ALWAYS the source of truth for profile data (name, address, hours, etc.)
- Local database is a CACHE, not a copy. Sync on a schedule (every 1-4 hours).
- Show "last synced" timestamps in the UI so users know data freshness.
- Never allow editing GBP profile data through MapsAI (read-only for profile data; write-only for posts and review responses).

### Pitfall 6: Puppeteer in Production
**What goes wrong:** Puppeteer (headless Chrome) consumes significant memory (~200-300MB per instance). On a constrained hosting environment, PDF generation crashes the worker or the entire server.
**Prevention:**
- Run Puppeteer with `--no-sandbox --disable-gpu --disable-dev-shm-usage` flags
- Limit concurrent PDF generation jobs (BullMQ concurrency: 1 or 2 for the report queue)
- Set page timeouts to prevent hung Chrome processes
- Use `page.close()` and `browser.close()` in finally blocks to prevent memory leaks
- Consider using a persistent browser instance that generates multiple PDFs rather than launching Chrome per report
- Railway's containers support Puppeteer but you may need to configure the Dockerfile

### Pitfall 7: Scheduling Timezone Confusion
**What goes wrong:** Posts scheduled for "9am" publish at 9am UTC instead of the business's local timezone. Different businesses in different timezones get posts at wrong times.
**Prevention:**
- Store all scheduled times in UTC in the database
- Store each profile's timezone (from GBP data)
- Convert display times to the profile's timezone in the UI
- BullMQ delays should be calculated from UTC
- Use a library like `date-fns-tz` or `luxon` for timezone conversions (never manual offset math)

### Pitfall 8: Background Worker Crashes Silently
**What goes wrong:** The BullMQ worker process crashes (memory, unhandled error) and nobody notices. Posts stop publishing, reviews stop syncing, but the dashboard still works fine.
**Prevention:**
- Health check endpoint on the worker process
- BullMQ event listeners for `failed` and `stalled` events
- Dashboard widget showing queue health (pending jobs, failed jobs, last successful run)
- Railway supports health checks and auto-restart
- Log all job completions and failures

## Minor Pitfalls

### Pitfall 9: GBP Post Content Restrictions
**What goes wrong:** Google Business Profile posts have specific content restrictions (character limits, image requirements, prohibited content types). AI-generated content may violate these.
**Prevention:**
- Validate post content against GBP limits before saving drafts
- Current limits: ~1,500 characters for post body, specific image dimensions
- AI system prompts should specify these constraints
- Show character count in the editor

### Pitfall 10: Review Response Etiquette
**What goes wrong:** AI responds to reviews too quickly (looks automated) or uses the same template for every response (looks robotic).
**Prevention:**
- Add a random delay (1-4 hours) before publishing review responses
- Vary AI prompts to produce diverse response styles
- Never mention that a response is AI-generated
- Flag 1-star reviews for mandatory human review (not just AI draft)

### Pitfall 11: Overcomplicating the MVP
**What goes wrong:** Building user roles, white-labeling, Stripe integration, and multi-tenancy before validating that the GBP API integration and AI content generation actually work well.
**Prevention:**
- Phase 1 is ONLY: connect to GBP API, list profiles, generate one AI post, respond to one review
- No authentication beyond basic Google OAuth
- No billing, no roles, no multi-tenancy
- Validate the core value prop before building infrastructure

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| GBP API Setup | API access not approved | Apply immediately; have a fallback plan (manual API testing with REST) |
| OAuth Integration | Token storage insecurity | Use encryption from day 1; never store tokens in plain text |
| AI Post Generation | Poor prompt quality | Iterate on prompts with real business data; log and review outputs |
| Review Responses | Inappropriate responses to sensitive reviews | Flag low-rating reviews for human-only handling |
| Scheduling | Timezone bugs | Use UTC internally, convert at display layer only |
| PDF Reports | Puppeteer memory issues | Limit concurrency, use persistent browser instance |
| Background Jobs | Silent worker failures | Health checks, monitoring dashboard, alerting |
| Paywall Addition | Multi-tenancy retrofit | Design database schema with tenant isolation from the start (even if unused) |

## Sources

- Training data knowledge of Google API ecosystem, BullMQ patterns, production Node.js applications
- Common patterns from local SEO tool domain
- Confidence: HIGH for technical pitfalls, MEDIUM for GBP API-specific details (verify current API docs)
