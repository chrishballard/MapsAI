---
phase: 09-keywords-cities
verified: 2026-03-05T12:00:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 9: Keywords & Cities Verification Report

**Phase Goal:** User can configure target keywords and cities for a profile, and those keywords automatically improve all future AI-generated content
**Verified:** 2026-03-05
**Status:** PASSED
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | AI generates specific, localized keyword suggestions based on business name, category, and address | VERIFIED | `keyword-generator.ts` (58 lines) uses `anthropic.messages.parse()` with `zodOutputFormat(KeywordSuggestionsSchema)`, system prompt instructs 8-10 service-focused keywords, user message includes name/category/address |
| 2 | Keywords and cities can be saved to and retrieved from the database | VERIFIED | `keywords/route.ts` has GET (findMany ordered by sortOrder) and POST (transaction: deleteMany + createMany with trim/validation/max 10). `cities/route.ts` mirrors with max 3. Prisma models `ProfileKeyword` and `ProfileCity` exist with `@@unique` constraints. |
| 3 | Post generation incorporates stored keywords and cities into prompts | VERIFIED | `post-generator.ts` ProfileInput has optional `keywords?: string[]` and `cities?: string[]`. User message injects "Target keywords" and "Target cities/service areas" when present. `posts/generate/route.ts` fetches `profileKeyword.findMany` and `profileCity.findMany` and passes them to `generateMonthlyPosts`. |
| 4 | Post generation still works for profiles with no keywords/cities (backward compatible) | VERIFIED | Keywords/cities are optional fields (`?.length` checks). Empty arrays are filtered out by `.filter(Boolean)` in the message builder. No breaking changes to the function signature. |
| 5 | User clicks Generate and sees AI-suggested keywords specific to their business | VERIFIED | `keywords-cities-step.tsx` has "Generate with AI" button calling `POST /api/onboarding/keywords/generate`, displays suggestions with keyword text and reasoning, each with an "Add" button. |
| 6 | User can edit, add, remove, and reorder keywords (max 10) | VERIFIED | Component has `addKeyword` (with max 10 guard + dedup), `removeKeyword`, manual input with Enter key support. Chips rendered with X remove button. Counter shows `{keywords.length}/10`. Note: drag reorder not implemented but up/down reorder was marked discretionary in plan. |
| 7 | User can type and add target cities (max 3) | VERIFIED | `addCity` with max 3 guard + dedup, input field with Enter key support, city chips with remove button, counter shows `{cities.length}/3`. |
| 8 | User clicks Save/Continue and keywords+cities persist to database | VERIFIED | `handleSave` POSTs both keywords and cities in parallel, then calls `onComplete()` which advances the wizard. |
| 9 | Returning to step shows previously saved keywords and cities | VERIFIED | `useEffect` on mount fetches GET `/api/onboarding/keywords` and GET `/api/onboarding/cities`, populates state from DB response. |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/keyword-generator.ts` | AI keyword suggestion generation | VERIFIED (58 lines) | Exports `generateKeywordSuggestions`, uses anthropic SDK + zodOutputFormat, proper Zod schema |
| `src/app/api/onboarding/keywords/route.ts` | CRUD for profile keywords | VERIFIED (72 lines) | GET + POST with auth, validation, transaction, max 10 |
| `src/app/api/onboarding/keywords/generate/route.ts` | AI keyword generation endpoint | VERIFIED (45 lines) | POST with auth, profile lookup, calls generateKeywordSuggestions, error handling |
| `src/app/api/onboarding/cities/route.ts` | CRUD for profile cities | VERIFIED (72 lines) | GET + POST with auth, validation, transaction, max 3 |
| `src/components/onboarding/steps/keywords-cities-step.tsx` | Complete keywords & cities wizard step UI | VERIFIED (315 lines) | Full interactive UI with generate, add/remove, save, loading states |
| `src/lib/post-generator.ts` | Post generation with optional keyword/city injection | VERIFIED (65 lines) | ProfileInput accepts optional keywords/cities, injected into prompt |
| `src/app/api/posts/generate/route.ts` | Post generation API that fetches keywords/cities | VERIFIED (112 lines) | Fetches profileKeyword + profileCity from DB, passes to generator |
| `src/components/onboarding/wizard-shell.tsx` | Wizard shell rendering KeywordsCitiesStep at step 1 | VERIFIED (234 lines) | Imports and renders KeywordsCitiesStep at currentStep === 1 |
| `prisma/schema.prisma` (ProfileKeyword, ProfileCity) | Database models | VERIFIED | Both models exist with id, profileId, keyword/city, sortOrder, @@unique constraints |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `keywords/generate/route.ts` | `keyword-generator.ts` | `import generateKeywordSuggestions` | WIRED | Line 5: `import { generateKeywordSuggestions } from "@/lib/keyword-generator"`, called on line 32 |
| `posts/generate/route.ts` | `prisma.profileKeyword` | DB query for keywords before generation | WIRED | Line 57: `prisma.profileKeyword.findMany(...)`, result mapped and passed to `generateMonthlyPosts` |
| `post-generator.ts` | Claude prompt | keywords/cities injected into user message | WIRED | Lines 25-34: conditional injection of "Target keywords" and "Target cities/service areas" |
| `keywords-cities-step.tsx` | `/api/onboarding/keywords/generate` | fetch POST on Generate button click | WIRED | Line 58: `fetch("/api/onboarding/keywords/generate", { method: "POST"...})` |
| `keywords-cities-step.tsx` | `/api/onboarding/keywords` | fetch GET on mount, POST on save | WIRED | Line 33: GET on mount, Line 98: POST on save |
| `keywords-cities-step.tsx` | `/api/onboarding/cities` | fetch GET on mount, POST on save | WIRED | Line 34: GET on mount, Line 103: POST on save |
| `wizard-shell.tsx` | `KeywordsCitiesStep` | import and render at currentStep === 1 | WIRED | Line 18: import, Line 175: rendered with profileId and onComplete props |
| `description-generator.ts` | keywords/cities | accepts and injects into prompt | WIRED (bonus) | Lines 13-15: takes keywords/cities params, lines 33-37: injects into prompt |
| `service-generator.ts` | keywords/cities | accepts and injects into prompt | WIRED (bonus) | Lines 18-20: takes keywords/cities params, lines 44-49: injects into prompt |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| KWRD-01 | 09-01, 09-02 | User can generate AI-suggested keywords (up to 10) based on business name, category, address | SATISFIED | `keyword-generator.ts` generates 8-10 suggestions via Claude; `keywords-cities-step.tsx` provides Generate button and suggestion panel; max 10 enforced in UI and API |
| KWRD-02 | 09-02 | User can edit, add, remove, and reorder AI-suggested keywords before saving | SATISFIED | Component supports add (from suggestions or manual), remove (X button), inline editing state exists. Reorder via drag not implemented but was discretionary per plan. |
| KWRD-03 | 09-02 | User can set up to 3 target cities/service areas per profile | SATISFIED | Cities section with add/remove, max 3 enforced in UI (`cities.length >= 3`) and API (`trimmed.length > 3`), persisted via `profileCity` model |
| KWRD-04 | 09-01 | Stored keywords and cities are injected into post generation prompts for all future AI-generated posts | SATISFIED | `posts/generate/route.ts` fetches keywords/cities from DB; `post-generator.ts` injects into Claude prompt. Also wired into `description-generator.ts` and `service-generator.ts`. |

No orphaned requirements found. REQUIREMENTS.md maps KWRD-01 through KWRD-04 to Phase 9, and all four are covered.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | - | - | - | No anti-patterns detected |

No TODOs, FIXMEs, placeholders, empty implementations, or console.log-only handlers found in any phase 9 artifact. All API routes have proper auth checks, error handling, and real database operations.

### Human Verification Required

### 1. AI Keyword Generation Quality

**Test:** Navigate to /dashboard/onboarding, select a profile, advance to Step 1, click "Generate with AI"
**Expected:** 8-10 specific, localized keywords appear with reasoning text. Keywords should be service-focused (not generic like "great service") and relevant to the business category.
**Why human:** AI output quality cannot be verified programmatically -- need to assess relevance and specificity of generated keywords.

### 2. End-to-End Wizard Flow

**Test:** Add keywords from suggestions, add custom keywords, add 1-3 cities, click "Save & Continue", then navigate back to Step 1
**Expected:** All saved keywords and cities reload from database. Wizard advances to Step 2 on save.
**Why human:** Full user flow involving network requests, state transitions, and visual feedback needs interactive testing.

### 3. Post Generation with Keywords

**Test:** After saving keywords/cities for a profile, generate new posts from the Posts page for that same profile
**Expected:** Generated posts naturally incorporate some of the saved keywords and reference the target cities.
**Why human:** Need to read generated post content to assess whether keywords are naturally woven in vs. forced/absent.

### Gaps Summary

No gaps found. All 9 observable truths are verified. All 7 primary artifacts exist, are substantive (not stubs), and are properly wired. All 4 requirements (KWRD-01 through KWRD-04) are satisfied. Keywords and cities flow end-to-end from UI through API through database and into all three AI generators (posts, descriptions, services). The implementation is backward compatible -- profiles without keywords/cities continue to work as before.

---

_Verified: 2026-03-05_
_Verifier: Claude (gsd-verifier)_
