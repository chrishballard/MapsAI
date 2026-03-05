# MapsAI -- Project State

## Current Position

**Milestone:** v1.1 -- Onboarding & Optimization
**Phase:** 8 -- Wizard Shell & Data Foundation
**Plan:** 1/2 complete (08-01 done, 08-02 next)
**Status:** Executing Phase 8
**Progress:** [______________________________] 0/6 phases

Last activity: 2026-03-05 -- Plan 08-01 complete (schema + onboarding APIs)

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-04)

**Core value:** Every client's GBP is fully managed end-to-end -- from initial optimization through ongoing posts, reviews, and reporting.
**Current focus:** Milestone v1.1 -- Onboarding & Optimization (guided onboarding wizard + AI profile optimization)

## Milestone v1.1 Phases

| Phase | Status |
|-------|--------|
| 8. Wizard Shell & Data Foundation | In progress (1/2 plans) |
| 9. Keywords & Cities | Not started |
| 10. Description Optimization | Not started |
| 11. Service Optimization | Not started |
| 12. Attributes & Profile Settings | Not started |
| 13. Re-optimization | Not started |

## Accumulated Context

### From Milestone 1 (MVP) -- All Complete
- Phase 1-7 complete: auth, GBP OAuth, posts, reviews, reports, polish
- Profiles already sync from Google via OAuth
- Post generation uses Claude with prompt templates (claude-sonnet-4-5)
- BullMQ workers handle publishing, review sync, metrics sync
- Dashboard has profile detail pages, live stats, sidebar nav
- GBP API integration established for posts, reviews, metrics
- Unified worker, Docker deployment on Railway

### Key Technical Decisions (Milestone 1)
- claude-sonnet-4-5 for AI generation (cost-efficient)
- Structured outputs with zodOutputFormat
- URL searchParams for filter state
- On-demand PDF generation
- Unified worker imports standalone files
- Dockerfile copies full node_modules for workers
- Draft-first workflow for all AI-generated content

### Milestone v1.1 Research Findings
- Keywords are the foundation: descriptions, services, and posts all depend on them
- GBP writes should be direct API calls (not BullMQ) since user is waiting during onboarding
- 10 edits/min/profile hard rate limit -- consolidate writes
- Service updates replace entire list -- must fetch-merge-push
- Attributes vary by category -- always fetch dynamically
- Social links and logo upload deferred (not in v1.1 scope)
- Zero new npm packages needed for core features
- Same googleapis client already in codebase handles all GBP writes

## Known Risks
- Service description API replaces entire service list (must fetch-merge-push)
- 10 edits/min/profile rate limit affects write sequencing
- Google can auto-overwrite API-pushed optimizations (drift)
- Service description character limit (~300 chars) not officially documented
- GBP v4 Media API being deprecated piecemeal (not needed for v1.1)

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases completed | 0/6 |
| Requirements delivered | 0/22 |
| Plans completed | 1/? |

## Session Continuity

**Next action:** Execute Plan 08-02 (Wizard UI)
**Key files:**
- .planning/ROADMAP.md -- phase structure and success criteria
- .planning/REQUIREMENTS.md -- requirement definitions and traceability
- .planning/research/SUMMARY.md -- technical research findings

---
*State initialized: 2026-03-04*
