---
phase: 11-service-optimization
verified: 2026-03-05T12:00:00Z
status: human_needed
score: 7/7
re_verification: false
human_verification:
  - test: "Navigate to /dashboard/onboarding, select a profile with keywords/cities, go to Step 3 (Services)"
    expected: "Available structured services displayed as a checklist based on business category from GBP"
    why_human: "Requires live GBP API call and visual verification of correct services"
  - test: "Select services and click Generate Descriptions"
    expected: "AI generates differentiated 200-300 char descriptions incorporating keywords/cities"
    why_human: "AI output quality and keyword incorporation require human judgment"
  - test: "Approve individual services, use Undo, then Approve All Remaining"
    expected: "Cards show green left border, counter updates, Undo reverts, Approve All batch-approves"
    why_human: "Visual/interactive UI behavior"
  - test: "Click Push All to Google"
    expected: "Spinner shown, green success banner appears, auto-advances after ~2.5 seconds"
    why_human: "Requires live GBP write and timing verification"
  - test: "Navigate back to Step 3 after push"
    expected: "Pushed services show blue left border, Pushed on {date} timestamps, textarea disabled"
    why_human: "Visual state verification"
  - test: "After push, verify existing GBP services NOT in optimization list are preserved"
    expected: "Pre-existing services still present in Google Business Profile dashboard"
    why_human: "Requires checking live GBP dashboard to confirm merge protection"
  - test: "Test Skip for Now on a different profile"
    expected: "Services saved locally, wizard advances without pushing to Google"
    why_human: "End-to-end flow verification"
---

# Phase 11: Service Optimization Verification Report

**Phase Goal:** User can discover, generate AI descriptions for, approve, and push optimized services to Google Business Profile
**Verified:** 2026-03-05T12:00:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Available structured services for a GBP category can be fetched from the Google API | VERIFIED | `fetchStructuredServices` in google-business-info.ts (lines 63-94) makes GET request with readMask=serviceItems, filters to structuredServiceItem, converts serviceTypeId to title case display names. GET /api/onboarding/services calls it in parallel with DB fetch (route.ts lines 37-64). |
| 2 | AI generates optimized descriptions for a batch of services in a single Claude call using stored keywords and cities | VERIFIED | `generateServiceDescriptions` in service-generator.ts uses anthropic.messages.parse() with zodOutputFormat, model claude-sonnet-4-5-20250929, max_tokens 4096. Prompt enforces 200-300 chars, keyword/city injection, third person, differentiation. Generate route fetches keywords and cities from DB before calling. |
| 3 | Services can be saved to and retrieved from the database with isApproved/isPushed tracking | VERIFIED | ProfileService model in schema.prisma has isApproved, isPushed, pushedAt fields with @@unique([profileId, serviceName]). POST /api/onboarding/services uses prisma.$transaction with upsert, resets isPushed on update. GET returns saved services ordered by createdAt. |
| 4 | Push fetches current GBP services, merges with approved services, and pushes the combined list | VERIFIED | Push route (push/route.ts) implements full 6-step workflow: fetch approved from DB, fetch current from GBP via fetchCurrentServices, log snapshot, merge (structured by serviceTypeId match, free-form appended), push via pushServicesToGBP, update DB on success. |
| 5 | Existing GBP services not being optimized are preserved after push (no data loss) | VERIFIED | Merge logic starts with `[...currentGBP.serviceItems]` as base (push/route.ts line 72). Structured services matched by serviceTypeId -- only matching entries are updated; unmatched are left as-is. Free-form services are appended. |
| 6 | A pre-push snapshot of the full GBP service list is stored before pushing | VERIFIED | Console.log with [SERVICE_SNAPSHOT] prefix at push/route.ts lines 62-69, includes profileId, timestamp, and full serviceItems array as JSON. |
| 7 | Push failure does not lose locally saved services | VERIFIED | Push route returns `{ success: false, error }` without status error code (line 136-139), services remain in DB with isApproved: true, isPushed: false. Frontend shows red error banner with Retry button (services-step.tsx lines 511-525). |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/service-generator.ts` | AI batch service description generation | VERIFIED | 81 lines; exports generateServiceDescriptions; uses anthropic SDK + zodOutputFormat; validates output completeness |
| `src/lib/google-business-info.ts` | GBP service read/write with fetch-merge-push logic | VERIFIED | Now 284 lines; exports fetchStructuredServices, fetchCurrentServices, pushServicesToGBP (plus 2 existing description functions and 2 attribute functions) |
| `src/app/api/onboarding/services/route.ts` | CRUD for profile services | VERIFIED | 138 lines; exports GET (parallel DB + GBP fetch, keyword fallback) and POST (transactional batch upsert with validation) |
| `src/app/api/onboarding/services/generate/route.ts` | AI batch service description generation endpoint | VERIFIED | 74 lines; exports POST; validates serviceNames (non-empty, max 20); fetches keywords+cities from DB; calls generateServiceDescriptions; try/catch with 500 error |
| `src/app/api/onboarding/services/push/route.ts` | Fetch-merge-push approved services to GBP | VERIFIED | 140 lines; exports POST; implements full 6-step fetch-merge-push with snapshot, structured/free-form merge, DB update on success |
| `src/components/onboarding/steps/services-step.tsx` | Complete services wizard step UI | VERIFIED | 682 lines (exceeds 300 min_lines); two-phase UI (selection + cards); all state management, handlers, and UI elements present |
| `src/components/onboarding/wizard-shell.tsx` | Wizard shell rendering ServicesStep at step 3 | VERIFIED | Line 184-188: currentStep === 3 renders ServicesStep with profileId and onComplete props; import at line 20 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| services/generate/route.ts | service-generator.ts | import generateServiceDescriptions | WIRED | Line 5: `import { generateServiceDescriptions } from "@/lib/service-generator"`, called at line 57 |
| services/push/route.ts | google-business-info.ts | import fetchCurrentServices, pushServicesToGBP | WIRED | Lines 5-8: both imported; fetchCurrentServices called line 56, pushServicesToGBP called line 110 |
| services/route.ts | prisma.profileService | CRUD operations | WIRED | GET: findMany (line 38); POST: $transaction with upsert (lines 99-130), findMany after (line 132) |
| services-step.tsx | /api/onboarding/services | fetch GET on mount | WIRED | Line 63: `fetch(/api/onboarding/services?profileId=${profileId})`, response parsed and state set |
| services-step.tsx | /api/onboarding/services/generate | fetch POST for AI generation | WIRED | Line 155: fetch POST to /api/onboarding/services/generate with profileId and serviceNames |
| services-step.tsx | /api/onboarding/services/push | fetch POST for push | WIRED | Line 264: fetch POST to /api/onboarding/services/push with profileId |
| wizard-shell.tsx | services-step.tsx | import and render at step 3 | WIRED | Line 20: import ServicesStep; Line 184-188: rendered at currentStep === 3 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-----------|-------------|--------|----------|
| SRVC-01 | 11-01, 11-02 | System fetches available structured services for the profile's GBP category | SATISFIED | fetchStructuredServices reads from GBP API; GET route returns them; frontend displays as checklist |
| SRVC-02 | 11-01, 11-02 | User can generate AI-optimized descriptions for each service incorporating target keywords | SATISFIED | generateServiceDescriptions uses Claude with keyword/city injection; frontend triggers via Generate Descriptions button |
| SRVC-03 | 11-01, 11-02 | User can approve service descriptions individually or in bulk before pushing to GBP | SATISFIED | Individual approve/undo per card; Approve All Remaining button; isApproved tracking in DB |
| SRVC-04 | 11-01, 11-02 | Services push uses fetch-then-merge to preserve existing services not being optimized | SATISFIED | Push route fetches current GBP services, merges approved services (structured by serviceTypeId, free-form appended), pushes combined list |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| services-step.tsx | 70 | eslint-disable @typescript-eslint/no-explicit-any | Info | Single use for API response mapping; acceptable for untyped API response |

No TODOs, FIXMEs, placeholders, or empty implementations found across any phase 11 files.

### Human Verification Required

### 1. Live Service Discovery from GBP

**Test:** Navigate to /dashboard/onboarding, select a profile with keywords/cities saved, go to Step 3 (Services)
**Expected:** Available structured services displayed as a checklist based on business category from GBP
**Why human:** Requires live GBP API call and visual verification of correct services for the category

### 2. AI Description Quality

**Test:** Select services and click Generate Descriptions
**Expected:** AI generates differentiated 200-300 char descriptions incorporating keywords/cities; no repetitive phrasing across descriptions
**Why human:** AI output quality, keyword incorporation, and differentiation require human judgment

### 3. Card-Based Approve/Push Workflow

**Test:** Approve individual services, use Undo, then Approve All Remaining; click Push All to Google
**Expected:** Cards show green/blue left borders, counter updates correctly, spinner during push, green success banner, auto-advance after ~2.5s
**Why human:** Visual/interactive UI behavior and timing

### 4. Merge Protection Verification

**Test:** After pushing, check Google Business Profile dashboard for the profile
**Expected:** Pre-existing services NOT in the optimization list are still present (no data loss from merge)
**Why human:** Requires checking live GBP dashboard to confirm fetch-merge-push preserved existing services

### 5. Return Visit State

**Test:** Navigate back to Step 3 after a successful push
**Expected:** Pushed services show blue left border, "Pushed on {date}" timestamps, textarea disabled, Continue button visible
**Why human:** Visual state verification on return visit

### 6. Skip for Now

**Test:** Start a different profile, navigate to Step 3, click Skip for Now
**Expected:** Services saved locally (if any were generated), wizard advances without pushing to Google
**Why human:** End-to-end flow verification

### 7. Error Recovery

**Test:** Simulate push failure (e.g., revoke OAuth token temporarily)
**Expected:** Red error banner with error message and Retry button; services remain saved locally with isApproved: true
**Why human:** Requires inducing a real API failure to verify error path

### Gaps Summary

No automated gaps found. All 7 observable truths are verified at the code level -- artifacts exist, are substantive, and are properly wired together. All 4 SRVC requirements (SRVC-01 through SRVC-04) have implementation evidence.

The phase requires human verification to confirm: (1) live GBP API integration works correctly, (2) AI description quality meets expectations, (3) merge protection actually preserves existing services in the real GBP dashboard, and (4) the full UI workflow feels correct.

---

_Verified: 2026-03-05T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
