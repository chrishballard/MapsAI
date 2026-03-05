---
phase: 05-review-sync-ai-responses
plan: 01
subsystem: reviews
tags: [reviews, ai, gbp-api, bullmq, dashboard]
dependency_graph:
  requires: [google-oauth, claude-api, bullmq-redis, prisma-models]
  provides: [review-sync-pipeline, ai-review-responses, review-dashboard, review-approval-workflow]
  affects: [dashboard-navigation, worker-processes]
tech_stack:
  added: []
  patterns: [repeatable-bullmq-scheduler, sentiment-aware-ai-responses, upsert-pattern]
key_files:
  created:
    - src/lib/google-reviews.ts
    - src/lib/review-responder.ts
    - src/lib/queue/review-sync-queue.ts
    - src/lib/queue/review-publish-queue.ts
    - workers/review-sync-worker.ts
    - workers/review-publish-worker.ts
    - src/app/api/reviews/route.ts
    - src/app/api/reviews/sync/route.ts
    - src/app/api/reviews/[id]/approve/route.ts
    - src/app/api/reviews/approve/route.ts
    - src/app/api/reviews/[id]/generate/route.ts
    - src/app/dashboard/reviews/review-filters.tsx
    - src/app/dashboard/reviews/review-actions.tsx
  modified:
    - src/app/dashboard/reviews/page.tsx
decisions:
  - Sentiment-aware system prompt with rating-specific guidelines for Claude responses
  - Review sync worker concurrency 1 to avoid GBP API rate limits
  - Review publish worker concurrency 5 for faster publishing throughput
  - UpsertJobScheduler pattern for repeatable 30-min review sync
metrics:
  duration: 174s
  completed: 2026-03-05T05:09:49Z
  tasks_completed: 2
  tasks_total: 2
---

# Phase 5 Plan 1: Review Sync & AI Responses Summary

GBP review sync pipeline with Claude AI response generation, approval workflow, and dashboard UI using BullMQ repeatable schedulers.

## What Was Built

### Task 1: GBP Reviews API, AI Response Generation, and Workers
- **google-reviews.ts**: Fetch reviews from GBP API with pagination, publish review replies via PUT
- **review-responder.ts**: Claude AI generates sentiment-aware responses using zodOutputFormat with structured output (response text, sentiment, tone)
- **review-sync-queue.ts**: BullMQ queue with 30-minute repeatable scheduler via upsertJobScheduler
- **review-publish-queue.ts**: BullMQ queue for immediate publishing of approved responses
- **review-sync-worker.ts**: Fetches all connected profiles, paginates reviews, creates Review records, generates AI response drafts, auto-approves when profile setting enabled
- **review-publish-worker.ts**: Publishes approved responses to Google as review replies, handles failures with status tracking

### Task 2: API Endpoints and Dashboard UI
- **GET /api/reviews**: Filtered list with profile, rating, responseStatus filters
- **POST /api/reviews/sync**: Manual sync trigger + scheduler initialization
- **POST /api/reviews/:id/approve**: Individual approval with publish queue
- **POST /api/reviews/approve**: Bulk approval for all drafted responses on a profile
- **POST /api/reviews/:id/generate**: Create or regenerate AI response draft
- **Reviews dashboard**: Star ratings, reviewer info, AI response drafts in bordered boxes, status badges (gray/blue/green/red), filter controls, approve/regenerate action buttons
- **Review filters**: Profile, rating (1-5), response status dropdowns updating URL searchParams
- **Review actions**: Approve and regenerate buttons with loading states, sync button, bulk approve

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 6daeb65 | GBP reviews API, AI response generation, and worker processes |
| 2 | 5efe415 | Reviews API endpoints and dashboard UI |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- TypeScript compilation: PASSED (zero errors)
- Next.js build: PASSED (all routes compiled)
- All API routes visible in build output: /api/reviews, /api/reviews/[id]/approve, /api/reviews/[id]/generate, /api/reviews/approve, /api/reviews/sync
- Dashboard route compiled: /dashboard/reviews

## Self-Check: PASSED

- All 14 files verified present on disk
- Both commits (6daeb65, 5efe415) verified in git log
