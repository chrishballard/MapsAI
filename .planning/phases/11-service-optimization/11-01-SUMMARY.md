# Plan 11-01 Summary: Backend APIs for Service Optimization

**Status:** Complete
**Duration:** ~2 minutes
**Tasks:** 3/3

## One-liner
AI batch service description generation with fetch-merge-push to GBP, preserving existing services during write

## What was built
- `src/lib/service-generator.ts` -- AI batch service description generation using Claude claude-sonnet-4-5-20250929 with structured output via zod; single call generates all descriptions (200-300 chars each) with keyword/city injection
- `src/lib/google-business-info.ts` -- Extended with 3 new functions: fetchStructuredServices (available services for category), fetchCurrentServices (raw list for merge), pushServicesToGBP (patch merged list)
- `src/app/api/onboarding/services/route.ts` -- Service CRUD: GET fetches saved + available GBP services in parallel, POST batch-upserts with unique constraint on [profileId, serviceName]
- `src/app/api/onboarding/services/generate/route.ts` -- AI batch generation endpoint, fetches profile keywords and cities from DB, max 20 services per call
- `src/app/api/onboarding/services/push/route.ts` -- Fetch-merge-push workflow: fetches current GBP services, merges with approved local services, pushes combined list preserving unoptimized services

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 75cbf7a | AI batch service description generator |
| 2 | 0a18ee5 | GBP service read/write functions |
| 3 | 9d694c6 | Services API routes (CRUD, generate, push) |

## Key decisions
- Single Claude API call for all service descriptions (batch pattern from keyword-generator.ts) -- faster and cheaper than per-service calls, plus Claude writes more differentiated descriptions with full context
- Push returns 200 even on GBP push failure so client can show "saved locally but not pushed" state (same pattern as description push)
- Pre-push snapshot logged to console with [SERVICE_SNAPSHOT] prefix (rollback UI deferred to future phase)
- Merge logic: structured services matched by serviceTypeId, free-form services always appended
- On upsert, isPushed resets to false when content changes (forces re-push)

## Key files

### Created
- `src/lib/service-generator.ts`
- `src/app/api/onboarding/services/route.ts`
- `src/app/api/onboarding/services/generate/route.ts`
- `src/app/api/onboarding/services/push/route.ts`

### Modified
- `src/lib/google-business-info.ts` (added fetchStructuredServices, fetchCurrentServices, pushServicesToGBP)

## Deviations from Plan
None -- plan executed exactly as written.

## Integration notes
- Plan 11-02 consumes all 3 API routes from the frontend services wizard step
- google-business-info.ts now exports 5 functions (2 description + 3 service) -- reusable for Phase 12 (Attributes)
- Service generator depends on profileKeyword and profileCity data from Phase 9
- ProfileService model (Phase 8 migration) provides the data layer with isApproved/isPushed tracking
