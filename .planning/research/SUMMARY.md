# Research Summary: MapsAI

**Domain:** Google Business Profile management tool (multi-location SaaS)
**Researched:** 2026-03-04
**Overall confidence:** MEDIUM-HIGH (based on training data; web search unavailable for latest version verification)

## Executive Summary

MapsAI is an internal tool for managing 100-200 Google Business Profile (GBP) listings with AI-generated posts, automated review responses, and PDF reporting. The scale is modest (not thousands of profiles), which means the architecture can stay simple -- a monolithic Next.js app with a PostgreSQL database and BullMQ for background jobs.

The Google Business Profile API (formerly Google My Business API) provides endpoints for managing posts, reviews, and profile data. Google officially supports Node.js client libraries (`googleapis` npm package), making a JavaScript/TypeScript stack the natural choice. Python has equivalent support via `google-api-python-client`, but since the frontend will be React-based anyway, staying in a single language reduces complexity.

The AI component (Claude API for generating post drafts and review responses) is straightforward -- both Node.js and Python SDKs are well-maintained. The approval workflow (drafts before publishing) is a standard CRUD pattern with status fields. PDF reporting is well-served by Puppeteer for HTML-to-PDF conversion, which produces professional results with minimal effort.

The critical infrastructure decision is hosting. Background jobs (scheduled posts, review monitoring, report generation) require a persistent server process, which rules out pure serverless platforms. Railway provides the right balance of simplicity and capability for this use case.

## Key Findings

**Stack:** Next.js 14+ (App Router) + PostgreSQL + BullMQ + Redis, hosted on Railway
**Architecture:** Monolithic full-stack app with separate worker process for background jobs
**Critical pitfall:** Google Business Profile API has strict rate limits and requires a verified Google Cloud project with an API access approval process -- this is the biggest initial blocker

## Implications for Roadmap

Based on research, suggested phase structure:

1. **Foundation and GBP API Integration** - Get the hardest part working first
   - Addresses: GBP API auth, profile listing, basic CRUD
   - Avoids: Building UI before confirming API access works

2. **Dashboard and Profile Management** - Core UI and data model
   - Addresses: Profile list, detail views, data storage
   - Avoids: Premature optimization of background jobs

3. **AI Post Generation and Approval Flow** - Core value proposition
   - Addresses: Claude API integration, draft/approve/publish workflow
   - Avoids: Building scheduling before manual flow works

4. **Review Monitoring and AI Responses** - Second core feature
   - Addresses: Review fetching, AI response drafts, approval flow
   - Avoids: N/A -- builds on established patterns from Phase 3

5. **Scheduling and Background Jobs** - Automation layer
   - Addresses: BullMQ queues, cron scheduling, post queue
   - Avoids: Building automation before manual workflows are proven

6. **PDF Reporting** - Polish feature
   - Addresses: Report generation, HTML-to-PDF, scheduled reports
   - Avoids: N/A -- standalone feature

7. **Paywall and Multi-tenancy** - Future monetization
   - Addresses: Stripe integration, user management, access control
   - Avoids: Premature multi-tenancy complexity

**Phase ordering rationale:**
- GBP API integration first because it is the riskiest unknown (API access approval, OAuth setup, rate limits)
- AI features before scheduling because manual workflows validate the product before automation
- PDF reporting is independent and can be built anytime after Phase 2
- Paywall is explicitly deferred -- internal tool first

**Research flags for phases:**
- Phase 1: NEEDS deeper research -- GBP API access approval process, current API endpoints, rate limits
- Phase 5: May need research -- BullMQ patterns for reliable scheduled posting
- Phase 7: Will need research when the time comes -- Stripe integration, multi-tenancy patterns

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Well-established technologies, clear fit for requirements |
| Features | HIGH | Standard SaaS patterns, well-understood domain |
| Architecture | HIGH | Monolith is correct at this scale |
| Pitfalls | MEDIUM | GBP API specifics may have changed; rate limits need verification |
| Hosting | MEDIUM | Railway pricing and features should be verified at build time |

## Gaps to Address

- Google Business Profile API current status and access requirements (apply for API access early)
- Exact GBP API rate limits and quotas for 100-200 profiles
- Whether GBP API requires a Google Workspace account or works with regular Google accounts
- Claude API pricing estimates for the expected volume of post/review generation
