# Ultrareview — 2026-08-05

Cloud multi-agent review of the helper-extraction refactor (118 files, +2618/-3862).
Five findings. Two fixed on `fix/reoptimize-graceful-degradation`, one resolved by
committing untracked files, two deferred with known trigger conditions.

## Findings

### 1. Missing helper modules (build breaker) — RESOLVED
- **Reported:** `src/app/api/onboarding/complete/route.ts:1` (and ~40 other importers)
- **Review claim:** nine helper modules (`@/lib/api-validation`, `@/lib/auth/require-session`,
  `@/lib/queue/onboarding-sync-queue`, `@/lib/profile-services`, `@/lib/dates`,
  `@/lib/fetch-json`, `@/lib/sync/metrics`, `@/lib/sync/reviews`,
  `workers/onboarding-sync-worker`) imported but absent — build fails, all workers dead.
- **Reality:** the files existed locally but were **untracked**; the review bundle
  excluded them. The genuine hazard was committing the refactor without them.
- **Resolution:** entire refactor committed as `b5b1b0e`, the twelve untracked
  files (nine helpers + `src/lib/onboarding-sync.ts` + two prisma migrations)
  as `08f6ad5`. Clean-worktree gate: `npm ci` + `prisma generate` + `next build`
  from a bare checkout of main passed.

### 2. Reoptimize routes 500 on any GBP hiccup — FIXED (this branch)
- **Where:** `src/app/api/reoptimize/description/route.ts` GET,
  `src/app/api/reoptimize/services/route.ts` GET
- **Cause:** `fetchCurrentDescription` / `fetchStructuredServices`
  (`src/lib/google-business-info.ts`) lost their internal try/catch in the
  refactor; both GETs awaited them inside `Promise.all` under a blanket
  catch-→-500. Any revoked token, Google 5xx, or network blip hid the saved
  description/keywords/services stored in Postgres.
- **Fix:** ported the onboarding description route's `.then/.catch` envelope —
  live GBP value degrades to `null`, response carries `gbpError`, saved data
  stays usable. Regression test: `tests/api/reoptimize-gbp-degradation.test.ts`
  (verified failing pre-fix: 500 vs 200; passing post-fix).
- **Deliberately not changed:** `reoptimize/services` POST (generation needs
  live GBP truth to mark `isStructured` — degrading would silently save wrong
  data) and the push routes (pushing requires GBP; loud failure is correct).
  `onboarding/services` GET shares the same defect — tracked as finding 6.

### 3. README missing production-required env vars — FIXED (this branch)
- **Where:** `README.md` env table; guards live in `src/lib/queue/connection.ts:23-31`
  (REDIS_URL, throws at boot) and `src/lib/auth.ts:26-31` (ALLOWED_EMAILS,
  rejects all sign-ins).
- **Fix:** both documented as required-in-production with their failure modes.

### 4. schedulePostPublish silently drops a new publish time — DEFERRED
- **Where:** `src/lib/queue/publish-queue.ts:40-51`
- **Defect:** if a post already has a pending (delayed/waiting/active) publish
  job, BullMQ jobId dedup makes `publishQueue.add` a no-op — the new
  `publishAt` is discarded and the post publishes at the ORIGINAL time. Only
  completed/failed jobs are cleared first. The manual `/publish` route works
  around it with an explicit `remove()`; the approve routes don't.
- **Trigger condition:** surfaces the moment any reschedule flow ships — a
  "change date" UI, bulk reschedule, or an API caller re-approving with a new
  time while the old delayed job still exists. Today no UI flow hits it.
- **Suggested fix when touched:** `changeDelay()` for delayed/waiting jobs, or
  mirror the `/publish` route's remove-then-add.

### 5. Inherited PUBLISHING claim never released after hard kill — DEFERRED
- **Where:** `workers/publish-worker.ts:108-124`
- **Defect:** if a worker is hard-killed (OOM, SIGKILL, deploy eviction)
  between claiming PUBLISHING and calling Google, the redelivered job's
  inherited-claim path throws outside the try/catch that releases
  PUBLISHING→SCHEDULED. All retries land the same way; the post ends
  permanently FAILED with a misleading "not found on Google" error.
- **Trigger condition:** hard kill mid-publish, inside the window between the
  status claim and `markPublished` (includes two live Google calls, so seconds
  wide per publish).
- **Recovery:** Retry button (FAILED→DRAFT) then re-approve.
- **Suggested fix when touched:** release the inherited claim on the throw
  path, or add a stale-PUBLISHING sweeper to `post-sweep-worker.ts`.

### 6. Onboarding services GET shares the catch-→-500 shape — FIXED (2026-08-05)
(Found during fix verification, not by the original review.)
- **Where:** `src/app/api/onboarding/services/route.ts:37-60`
- **Defect:** same shape as finding 2 — `fetchStructuredServices` inside
  `Promise.all` under a blanket catch-→-500, hiding saved services in
  Postgres whenever GBP hiccups during onboarding.
- **Trigger condition:** any GBP failure (revoked token, Google 5xx, network
  blip) while a profile's onboarding wizard is on the services step.
- **Fix (0f9975e, branch fix/gbp-outage-ux):** ported the reoptimize
  routes' `.then/.catch` envelope — degraded response is 200 with saved
  services, `availableServices: null`, `gbpError` set; healthy path pins an
  explicit `gbpError: null`. Regression test:
  `tests/api/onboarding-services-gbp-degradation.test.ts` (verified failing
  pre-fix: 500 vs 200 + missing gbpError; passing post-fix). The related
  polish also landed: `reoptimize-section.tsx` and `description-step.tsx`
  now render `gbpError` as an inline "Couldn't reach Google — showing your
  saved copy" notice instead of the misleading "no description/services
  set" empty states. Remaining gap (non-blocking, from the branch's
  adversarial review): `services-step.tsx` still ignores `gbpError` during
  onboarding — no notice there, though saved services now load instead of
  the step dying on a 500.
