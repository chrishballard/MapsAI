---
phase: 03-ai-post-generation
plan: 01
subsystem: ai-post-generation
tags: [claude-api, structured-outputs, post-generation, dashboard-ui]
dependency_graph:
  requires: [prisma-schema, auth-system, google-profiles]
  provides: [post-generation-api, posts-dashboard, prompt-system]
  affects: [prisma-schema, dashboard-navigation]
tech_stack:
  added: ["@anthropic-ai/sdk", "zod"]
  patterns: [structured-outputs, zodOutputFormat, singleton-client, server-component-filters]
key_files:
  created:
    - src/lib/claude.ts
    - src/lib/prompts/types.ts
    - src/lib/prompts/defaults.ts
    - src/lib/post-generator.ts
    - src/app/api/posts/generate/route.ts
    - src/app/api/posts/route.ts
    - src/app/api/profiles/route.ts
    - src/app/dashboard/posts/post-filters.tsx
    - src/app/dashboard/posts/generate/page.tsx
  modified:
    - prisma/schema.prisma
    - src/app/dashboard/posts/page.tsx
    - package.json
decisions:
  - "Used anthropic.messages.parse() with zodOutputFormat for guaranteed typed JSON output"
  - "Created PostFilters as separate client component to keep posts page as server component"
  - "Added GET /api/profiles endpoint since none existed for the generate page"
  - "Used URL searchParams for filter state to support shareable/bookmarkable filtered views"
metrics:
  duration: "249s"
  completed: "2026-03-05T04:27:23Z"
  tasks_completed: 2
  tasks_total: 2
---

# Phase 3 Plan 1: AI Post Generation & Drafts Summary

Claude API integration with structured outputs, category-specific prompt templates, batch post generation API, and filterable posts dashboard with generation UI.

## What Was Built

### Task 1: Claude API Integration, Prompt System, and Post Generation API
**Commit:** 44eb905

- **Prisma schema** updated with `PromptTemplate` model (profile-specific or category-default prompts) and relation to `Profile`
- **Anthropic client singleton** (`src/lib/claude.ts`) following the same globalThis pattern as the Prisma client
- **Zod schemas** (`src/lib/prompts/types.ts`) defining `GeneratedPostSchema` (content max 300 chars, callToAction, suggestedType enum) and `BatchPostsSchema` (exactly 4 posts)
- **Prompt templates** (`src/lib/prompts/defaults.ts`) with a generic template plus 5 category-specific templates (restaurant, dentist, salon, auto_repair, law_firm) and a `getDefaultPrompt()` lookup function
- **Post generator** (`src/lib/post-generator.ts`) using `anthropic.messages.parse()` with `zodOutputFormat(BatchPostsSchema)` for guaranteed structured output from claude-sonnet-4-5
- **POST /api/posts/generate** endpoint: accepts `{ profileIds: string[] }`, processes sequentially, saves results as DRAFT posts, per-profile error isolation
- **GET /api/posts** endpoint: returns posts with optional profileId/status/type filters, includes profile name and category

### Task 2: Posts Dashboard UI and Generation Page
**Commit:** d7ef9d6

- **Posts dashboard** (`src/app/dashboard/posts/page.tsx`): server component with direct Prisma queries, responsive card grid (1/2/3 columns), color-coded type badges (blue WHATS_NEW, purple EVENT, green OFFER), status badges, content preview truncated at 150 chars, empty state with Generate Posts CTA
- **PostFilters** client component (`post-filters.tsx`): profile/status/type dropdown filters that update URL searchParams for shareable filtered views
- **Generate page** (`src/app/dashboard/posts/generate/page.tsx`): client component with profile selector checkboxes, Select All/Deselect All, loading state with profile name, success summary with post count, error handling, navigation back to posts list
- **GET /api/profiles** endpoint: returns connected profiles (id, name, category) for the generate page

## Deviations from Plan

### Auto-added Missing Functionality

**1. [Rule 2] Added GET /api/profiles endpoint**
- **Found during:** Task 2
- **Issue:** Generate page needed to fetch profiles client-side but no profiles listing endpoint existed
- **Fix:** Created `src/app/api/profiles/route.ts` with auth check, returns connected profiles
- **Commit:** d7ef9d6

**2. [Rule 2] Created PostFilters as separate client component**
- **Found during:** Task 2
- **Issue:** Posts page is a server component but filter dropdowns need client interactivity (onChange handlers, router.push)
- **Fix:** Extracted `PostFilters` into its own "use client" component, keeping the main page as a server component for direct Prisma access
- **Commit:** d7ef9d6

## Verification Results

- Prisma schema validates successfully
- Prisma client generated successfully
- TypeScript compiles with zero errors (`npx tsc --noEmit`)
- Next.js build completes successfully (`npm run build`)
- All routes registered: /api/posts, /api/posts/generate, /api/profiles, /dashboard/posts, /dashboard/posts/generate

## Notes

- Database was not running locally so `npx prisma db push` could not execute. Schema is validated and client is generated. The push must be run when the database is available.
- Task 3 (human-verify checkpoint) was skipped per instructions -- manual verification of the generation flow should be done with ANTHROPIC_API_KEY set and database running.
