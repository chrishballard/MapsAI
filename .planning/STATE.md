# MapsAI — Project State

## Current Status
- **Milestone**: 1 (MVP)
- **Phase**: 6 (plan 01 complete)
- **Next Action**: Plan Phase 7
- **Last Session**: 2026-03-05T05:27:26Z
- **Stopped At**: Completed 06-01-PLAN.md (awaiting human verification checkpoint)

## Completed
- [x] Project initialization
- [x] Research: Google APIs
- [x] Research: Tech stack
- [x] Research: Competitor analysis
- [x] PROJECT.md created
- [x] REQUIREMENTS.md created
- [x] ROADMAP.md created
- [x] Phase 1 PLAN.md created
- [x] Phase 1 executed (scaffolding, auth, dashboard, deployment config)
- [x] Phase 2 PLAN.md created
- [x] Phase 2 executed (Google OAuth, profile sync, profiles UI, disconnect, resync, dashboard stats)
- [x] Phase 3 PLAN.md created
- [x] Phase 3 executed (Claude API integration, prompt templates, post generation API, posts dashboard)
- [x] Phase 5 PLAN.md created
- [x] Phase 5 executed (GBP review sync, AI response generation, approval workflow, reviews dashboard)
- [x] Phase 6 PLAN.md created
- [x] Phase 6 executed (GBP metrics sync, keyword tracking, PDF report generation, reports dashboard)

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-04 | Next.js + TypeScript | Full-stack, single codebase, strong Google API support |
| 2026-03-04 | PostgreSQL + Prisma | Relational scheduling data, type-safe queries |
| 2026-03-04 | BullMQ + Redis | Reliable job scheduling with retries |
| 2026-03-04 | Claude API for AI | Already in Vineyard Growth ecosystem |
| 2026-03-04 | Railway for hosting | Native Postgres/Redis, background workers, affordable |
| 2026-03-04 | Draft-first workflow | Posts and reviews start as drafts for team approval |
| 2026-03-04 | claude-sonnet-4-5 for post generation | Cost-efficient (~$3/month for 200 profiles) vs Opus at 15x cost |
| 2026-03-04 | Structured outputs with zodOutputFormat | Guaranteed typed JSON from Claude, no parsing bugs |
| 2026-03-05 | PostFilters as separate client component | Keep posts page as server component for direct Prisma access |
| 2026-03-05 | URL searchParams for filter state | Shareable/bookmarkable filtered views without client state |
| 2026-03-05 | Sentiment-aware review response system prompt | Rating-specific guidelines (warm for 5-star, empathetic for 1-star) |
| 2026-03-05 | Review sync worker concurrency 1 | Avoid GBP API rate limits during periodic sync |
| 2026-03-05 | UpsertJobScheduler for review sync | 30-min repeatable BullMQ scheduler, idempotent initialization |
| 2026-03-05 | Lazy dynamic import for chartjs-node-canvas | Turbopack cannot handle freshRequire pattern, use await import() |
| 2026-03-05 | On-demand PDF generation at download time | Simpler than file storage, always uses fresh data |
| 2026-03-05 | Rolling 7-day metrics sync window | GBP API has 1-3 day data lag, 7-day window catches delayed data |

## Known Risks
- Google OAuth setup requires manual Google Cloud Console configuration
- GBP API access may require Google approval for production use
- Performance metrics have 1-3 day lag
- Weekend timeline is aggressive — Phase 7 may slip
- ANTHROPIC_API_KEY must be set in environment for post generation
