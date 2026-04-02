---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Profile Optimization & UI Enhancements
status: defining_requirements
last_updated: "2026-04-02"
last_activity: 2026-04-02 -- Milestone v1.2 started
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# MapsAI -- Project State

## Current Position

**Milestone:** v1.2 -- Profile Optimization & UI Enhancements
**Phase:** Not started (defining requirements)
**Plan:** —
**Status:** Defining requirements
**Progress:** [░░░░░░░░░░] 0%

Last activity: 2026-04-02 -- Milestone v1.2 started

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-02)

**Core value:** Every client's GBP is fully managed end-to-end -- from initial optimization through ongoing posts, reviews, and reporting.
**Current focus:** Milestone v1.2 -- Profile Optimization & UI Enhancements

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

### From Milestone v1.1 (Onboarding & Optimization) -- All Complete
- Phase 8-13 complete: wizard shell, keywords, descriptions, services, attributes, re-optimization
- Keywords are the foundation: descriptions, services, and posts all depend on them
- GBP writes should be direct API calls (not BullMQ) since user is waiting during onboarding
- 10 edits/min/profile hard rate limit -- consolidate writes
- Service updates replace entire list -- must fetch-merge-push
- Attributes vary by category -- always fetch dynamically
- Zero new npm packages needed for core features
- Same googleapis client already in codebase handles all GBP writes

## Known Risks
- Service description API replaces entire service list (must fetch-merge-push)
- 10 edits/min/profile rate limit affects write sequencing
- Google can auto-overwrite API-pushed optimizations (drift)
- GBP v4 Media API being deprecated piecemeal

---
*State initialized: 2026-04-02*
