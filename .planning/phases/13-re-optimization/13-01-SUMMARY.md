---
phase: 13-re-optimization
plan: "01"
subsystem: re-optimization-api
tags: [api, reoptimize, description, services, gbp]
dependency_graph:
  requires: [description-generator, service-generator, google-business-info]
  provides: [reoptimize-description-api, reoptimize-services-api]
  affects: [future-reopt-frontend]
tech_stack:
  added: []
  patterns: [fetch-merge-push, upsert-then-push, live-vs-saved-comparison]
key_files:
  created:
    - src/app/api/reoptimize/description/route.ts
    - src/app/api/reoptimize/description/push/route.ts
    - src/app/api/reoptimize/services/route.ts
    - src/app/api/reoptimize/services/push/route.ts
  modified: []
decisions:
  - Replicated onboarding endpoint patterns exactly for consistency
  - Services POST replaces full service set in DB (deleteMany + createMany) matching onboarding pattern
metrics:
  duration: 91s
  completed: "2026-03-06T02:36:21Z"
---

# Phase 13 Plan 01: Re-optimization API Endpoints Summary

Re-optimization API endpoints that return live GBP content alongside AI-generated suggestions, with push endpoints for applying approved changes using existing generators and GBP functions.

## What Was Built

### Task 1: Description Re-optimization Endpoints
- **GET /api/reoptimize/description** - Returns live GBP description (via `fetchCurrentDescription`), saved ProfileDescription from DB, and profile keywords for context
- **POST /api/reoptimize/description** - Generates new AI description using `generateDescription` from existing lib, loading keywords and cities from DB
- **POST /api/reoptimize/description/push** - Validates content (non-empty, max 750 chars), upserts ProfileDescription with isApproved: true, pushes to GBP via `pushDescriptionToGBP`, marks isPushed on success
- Commit: `ab699c7`

### Task 2: Services Re-optimization Endpoints
- **GET /api/reoptimize/services** - Returns live GBP structured services (via `fetchStructuredServices`), saved ProfileService records, and available services for the category
- **POST /api/reoptimize/services** - Validates serviceNames array (non-empty, max 20), generates AI descriptions via `generateServiceDescriptions`, saves to DB with deleteMany + createMany transaction
- **POST /api/reoptimize/services/push** - Fetches approved services from DB, logs pre-push snapshot, performs fetch-merge-push (structured services matched by serviceTypeId, custom services as freeFormServiceItem), updates DB on success
- Commit: `22b12e9`

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

1. **Replicated onboarding patterns exactly** - All endpoints follow the same auth, validation, error handling, and DB patterns as onboarding equivalents for codebase consistency.
2. **Services POST replaces full set** - Uses deleteMany + createMany in a transaction to replace the entire service set, matching the onboarding approach.

## Verification

- `npx tsc --noEmit` passes with zero errors
- All 4 route files exist under src/app/api/reoptimize/
- No new dependencies added - all imports from existing libraries
- Push endpoints use identical fetch-merge-push pattern as onboarding

## Self-Check: PASSED

- All 4 route files verified on disk
- Both commit hashes (ab699c7, 22b12e9) verified in git log
