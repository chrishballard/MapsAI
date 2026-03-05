# MapsAI — Project State

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-03-04 — Milestone v1.1 started

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-04)

**Core value:** Every client's GBP is fully managed end-to-end — from initial optimization through ongoing posts, reviews, and reporting.
**Current focus:** Milestone v1.1 — Onboarding & Optimization

## Accumulated Context

### From Milestone 1 (MVP)
- Phase 1-7 complete: auth, GBP OAuth, posts, reviews, reports, polish
- Profiles already sync from Google via OAuth
- Post generation uses Claude with prompt templates
- BullMQ workers handle publishing, review sync, metrics sync
- Dashboard has profile detail pages, live stats
- Keywords stored per profile will feed into existing post generation
- GBP API integration established for posts, reviews, metrics

### Key Technical Decisions
- claude-sonnet-4-5 for AI generation (cost-efficient)
- Structured outputs with zodOutputFormat
- URL searchParams for filter state
- On-demand PDF generation
- Unified worker imports standalone files
- Dockerfile copies full node_modules for workers

## Known Risks
- GBP API for updating descriptions/services may have different rate limits than read operations
- Service descriptions API may require specific field formats
- Attributes API endpoint structure needs research
- Logo upload requires media handling (file storage or direct GBP media API)
