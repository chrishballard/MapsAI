# MapsAI

## What This Is

MapsAI is an internal AI-powered tool for Vineyard Growth that manages 100-200 Google Business Profiles end-to-end — from initial onboarding and SEO optimization through ongoing posts, reviews, and reporting. Replaces Page by Merchant ($10k/month) at ~$150-200/month.

## Core Value

Every client's GBP is fully managed end-to-end — from initial optimization through ongoing posts, reviews, and reporting — without manual work or expensive third-party tools.

## Requirements

### Validated

- ✓ AUTH: Team login with email/password — v1.0
- ✓ GBP: OAuth connection, profile sync, multi-account support — v1.0
- ✓ POSTS: AI post generation, approval workflow, auto-publishing via BullMQ — v1.0
- ✓ REVIEWS: Review sync, AI response generation, approval/auto-publish — v1.0
- ✓ REPORTS: GBP metrics sync, keyword tracking, PDF report generation — v1.0
- ✓ DASH: Dashboard with live stats, profile detail pages, sidebar nav — v1.0
- ✓ SETTINGS: Prompt templates, connected accounts management — v1.0
- ✓ DEPLOY: Unified worker, Docker deployment config — v1.0
- ✓ ONBRD: Guided onboarding wizard with 7-step flow, progress persistence — v1.1
- ✓ KWRD: AI keyword suggestions (up to 10), target cities (up to 3) — v1.1
- ✓ DESC: AI SEO business descriptions with approve-then-push to GBP — v1.1
- ✓ SRVC: AI service descriptions with category discovery and fetch-merge-push — v1.1
- ✓ ATTR: Dynamic GBP attribute management (bool, enum, repeated enum, URL) — v1.1
- ✓ PROF: Configurable post frequency, used by scheduling system — v1.1
- ✓ REOPT: On-demand re-optimization with live-vs-suggested comparison — v1.1
- ✓ CARD: Business cards view with score badges, search, responsive grid — v1.2 (Phase 15)
- ✓ DASH: Dashboard upgrades — automations feed, expanded tasks, Suspense streaming — v1.2 (Phase 16)

### Active

(Defined in REQUIREMENTS.md for v1.2)

### Out of Scope

- Client-facing portal / paywall — deferred to future SaaS milestone
- Q&A management — API deprecated (Nov 2025)
- Photo/media optimization — manual for now
- Logo upload — deferred (complex media API)
- Social links via API — GBP API does not support writes
- Competitor tracking — not core to management
- Multi-platform support (Yelp, Facebook) — GBP only
- White-labeling — internal tool
- Mobile app — web-first
- Keyword search volume/difficulty data — AI suggestions are enough

## Current Milestone: v1.2 Profile Optimization & UI Enhancements

**Goal:** Upgrade the platform's UI with optimization scoring, richer business cards, dashboard activity feeds, review analytics, and enhanced reporting — bringing parity with Paige by Merchynt's best UX patterns.

**Target features:**
- Profile Optimization Page — optimization score gauge, GBP audit cards, approve/ignore workflow, bulk actions
- Dashboard Upgrades — recent automations feed, My Tasks table, welcome banner, business filter
- Business Cards View — 4-column card grid with logos, ratings, map thumbnails
- Review Metrics Dashboard — review trends, rating distribution, QR code review requests, AI tips
- Reports Enhancement — competitor card, Views on Google charts, website clicks, completed actions log

## Context

- **v1.0 MVP** shipped: ongoing management (posts, reviews, reports)
- **v1.1 Onboarding** shipped: guided optimization wizard, AI keywords/descriptions/services, re-optimization
- **v1.2 in progress**: Phase 16 (Dashboard Upgrades) complete — Suspense streaming, automations feed, expanded tasks. Next: Phase 17 (Profile Optimization Page)
- ~135 TypeScript files
- GBP API access application submitted (pending approval for write operations)
- No sidebar link to onboarding page yet (users navigate directly)

## Constraints

- **GBP API**: OAuth per account, posts publish immediately, 1-3 day metrics lag
- **GBP API**: Q&A deprecated, no video support in posts, no social link writes
- **GBP API**: 10 edits/min/profile rate limit — consolidate writes
- **Scale**: 100-200 profiles, onboarding is one-time per profile but re-optimization is on-demand
- **AI Cost**: Claude Sonnet for generation keeps costs at ~$3/month for 200 profiles

## Tech Stack

- **Runtime**: Node.js / TypeScript
- **Framework**: Next.js 14+ (App Router)
- **Database**: PostgreSQL (Prisma ORM)
- **Queue**: BullMQ + Redis
- **AI**: Claude API (@anthropic-ai/sdk, claude-sonnet-4-5)
- **PDF**: @react-pdf/renderer
- **Auth**: NextAuth.js
- **Styling**: Tailwind CSS
- **Hosting**: Railway

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Next.js + TypeScript | Full-stack, single codebase | ✓ Good |
| PostgreSQL + Prisma | Relational scheduling data, type-safe queries | ✓ Good |
| BullMQ + Redis | Reliable job scheduling with retries | ✓ Good |
| Claude Sonnet for AI generation | Cost-efficient (~$3/month for 200 profiles) | ✓ Good |
| Draft-first workflow | Posts and reviews start as drafts for team approval | ✓ Good |
| Railway for hosting | Native Postgres/Redis, background workers | ✓ Good |
| AI keyword suggestions (no volume data) | Simpler, avoids third-party keyword API dependency | ✓ Good |
| Direct GBP API calls for user-initiated writes | No queue needed for interactive onboarding actions | ✓ Good |
| Fetch-merge-push for services | Preserves existing GBP services not being optimized | ✓ Good |
| Dynamic attribute fetching per category | No hardcoded attribute lists to maintain | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-02 — Phase 15 complete: business cards with score badges, search, optimized queries*
