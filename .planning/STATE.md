# MapsAI — Project State

## Current Status
- **Milestone**: 1 (MVP)
- **Phase**: 2 (executed)
- **Next Action**: `/gsd:verify-work 2` or `/gsd:plan-phase 3`

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

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-04 | Next.js + TypeScript | Full-stack, single codebase, strong Google API support |
| 2026-03-04 | PostgreSQL + Prisma | Relational scheduling data, type-safe queries |
| 2026-03-04 | BullMQ + Redis | Reliable job scheduling with retries |
| 2026-03-04 | Claude API for AI | Already in Vineyard Growth ecosystem |
| 2026-03-04 | Railway for hosting | Native Postgres/Redis, background workers, affordable |
| 2026-03-04 | Draft-first workflow | Posts and reviews start as drafts for team approval |

## Known Risks
- Google OAuth setup requires manual Google Cloud Console configuration
- GBP API access may require Google approval for production use
- Performance metrics have 1-3 day lag
- Weekend timeline is aggressive — Phase 7 may slip
