# MapsAI

## What This Is

MapsAI is an internal AI-powered tool for Vineyard Growth that manages 100-200 Google Business Profiles. It handles post generation, review responses, analytics reporting, and profile optimization — replacing Page by Merchant ($10k/month) at ~$150-200/month.

## Core Value

Every client's GBP is fully managed end-to-end — from initial optimization through ongoing posts, reviews, and reporting — without manual work or expensive third-party tools.

## Requirements

### Validated

<!-- Shipped and confirmed valuable (Milestone 1 MVP) -->

- [x] AUTH: Team login with email/password
- [x] GBP: OAuth connection, profile sync, multi-account support
- [x] POSTS: AI post generation, approval workflow, auto-publishing via BullMQ
- [x] REVIEWS: Review sync, AI response generation, approval/auto-publish
- [x] REPORTS: GBP metrics sync, keyword tracking, PDF report generation
- [x] DASH: Dashboard with live stats, profile detail pages, sidebar nav
- [x] SETTINGS: Prompt templates, connected accounts management
- [x] DEPLOY: Unified worker, Docker deployment config

### Active

<!-- Milestone v1.1: Onboarding & Optimization -->

- [ ] Guided onboarding wizard for new business profiles
- [ ] AI-suggested target keywords per profile (up to 10)
- [ ] Target cities per profile (up to 3)
- [ ] AI-generated SEO business description (approve → push to GBP)
- [ ] AI-optimized service descriptions (approve individually/bulk → push to GBP)
- [ ] GBP attributes management
- [ ] Social profile links management
- [ ] Logo upload during onboarding
- [ ] Configurable post frequency per profile
- [ ] Re-optimization from profile page (re-run description/services anytime)
- [ ] Keywords and cities feed into post generation and all AI content

### Out of Scope

- Client-facing portal / paywall — deferred to future SaaS milestone
- Q&A management — API deprecated (Nov 2025)
- Photo/media optimization — manual for now
- Competitor tracking — not core to management
- Multi-platform support (Yelp, Facebook) — GBP only
- White-labeling — internal tool
- Mobile app — web-first
- Optimization score/gauge — wizard is sufficient
- Keyword search volume/difficulty data — AI suggestions are enough

## Context

- Existing MVP handles ongoing management (posts, reviews, reports)
- Missing the initial onboarding/optimization step that PBM provides
- Keywords are the connective thread: they inform descriptions, services, and ongoing posts
- Target cities geo-modify keyword strategy for local SEO
- GBP API supports updating descriptions, services, and attributes programmatically
- Onboarding wizard replaces PBM's "Add Business" → "Optimize Profile" → "Automate Everything" flow

## Constraints

- **GBP API**: OAuth per account, posts publish immediately, 1-3 day metrics lag
- **GBP API**: Q&A deprecated, no video support in posts
- **GBP API**: Service descriptions and attributes require specific API endpoints
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
| AI keyword suggestions (no volume data) | Simpler, avoids third-party keyword API dependency | — Pending |

## Current Milestone: v1.1 Onboarding & Optimization

**Goal:** Add guided onboarding wizard and AI-powered profile optimization so new client GBPs are fully set up and SEO-optimized from day one.

**Target features:**
- Multi-step onboarding wizard (select profile → configure → optimize → automate)
- AI keyword suggestions and target city configuration
- AI-generated business descriptions and service descriptions pushed to GBP
- Attributes and social profile management
- Re-optimization capability from profile page
- Keywords/cities integrated into existing post generation

---
*Last updated: 2026-03-04 after Milestone v1.1 started*
