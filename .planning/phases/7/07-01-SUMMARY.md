---
phase: 07-polish-production-readiness
plan: 01
subsystem: dashboard-settings-deployment
tags: [dashboard, profiles, settings, workers, docker]
dependency_graph:
  requires: [prisma-models, bullmq-workers, next-auth]
  provides: [live-dashboard, profile-detail, prompt-template-crud, unified-worker, docker-deployment]
  affects: [dashboard, settings, profiles, deployment]
tech_stack:
  added: []
  patterns: [server-components-with-prisma, client-component-mutations, unified-worker-entry]
key_files:
  created:
    - src/app/dashboard/profiles/[id]/page.tsx
    - src/app/api/prompt-templates/route.ts
    - src/app/api/prompt-templates/[id]/route.ts
    - src/app/dashboard/settings/prompt-templates.tsx
    - workers/index.ts
    - scripts/start.sh
  modified:
    - src/app/dashboard/page.tsx
    - src/app/dashboard/profiles/page.tsx
    - src/app/dashboard/settings/page.tsx
    - Dockerfile
decisions:
  - Unified worker imports existing standalone worker files which auto-start on import
  - Dockerfile copies full node_modules for worker tsx support alongside standalone Next.js
metrics:
  duration: 234s
  completed: 2026-03-05T05:34:47Z
  tasks_completed: 2
  tasks_total: 2
---

# Phase 7 Plan 01: Polish and Production Readiness Summary

Live dashboard stats from Prisma, profile detail pages with posts/reviews/metrics, prompt template CRUD settings, unified worker process, and Docker deployment config.

## What Was Built

### Task 1: Dashboard Home with Live Stats and Profile Detail Page
- **Dashboard page** now queries Prisma for real aggregate stats: total profiles, posts this month, pending reviews (DRAFTED status), and reports generated
- **Recent Activity** section added below stats showing last 5 posts and last 5 reviews with profile names, dates, and status badges
- **Profile detail page** (`/dashboard/profiles/[id]`) created as server component with: header (name, category, address, connection status, google email), stats row (total posts, drafts, reviews, avg rating), last 10 posts in card grid, last 10 reviews with AI responses and star ratings, monthly metrics summary (impressions, clicks, calls, directions)
- **Profiles list** updated with clickable profile names linking to detail pages

### Task 2: Settings Prompt Templates and Unified Worker
- **Prompt template API**: GET/POST at `/api/prompt-templates`, PATCH/DELETE at `/api/prompt-templates/[id]`, all with auth checks
- **PromptTemplates client component**: list/add/edit/delete prompt templates with inline editing, category badges, profile associations
- **Settings page** updated to fetch and display prompt templates below existing Google Accounts section
- **Unified worker entry** (`workers/index.ts`): imports all 4 worker files, logs startup, handles SIGTERM/SIGINT graceful shutdown
- **Start script** (`scripts/start.sh`): runs workers and Next.js in parallel, kills both if either exits
- **Dockerfile** updated: added canvas system deps, copies workers/scripts/src for tsx execution, uses start.sh as CMD

## Deviations from Plan

None -- plan executed exactly as written.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | 7376c1e | feat(07-01): live dashboard stats and profile detail page |
| 2 | bb38558 | feat(07-01): prompt template settings, unified worker, and Docker deployment |

## Verification

- `npm run build` succeeds with all routes compiled
- All new pages appear in build output: `/dashboard/profiles/[id]`, `/dashboard/settings`
- TypeScript compilation passes (build includes type checking)
