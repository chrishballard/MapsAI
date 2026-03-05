# MapsAI — Roadmap (Milestone 1: MVP)

## Phase 1: Project Scaffolding & Auth
**Goal**: Standing Next.js app with database, auth, and basic layout
**Requirements**: R6.1, R6.4 (partial)
**Success**: Can log in, see empty dashboard with navigation

- Next.js 14 project setup with TypeScript
- Tailwind CSS + shadcn/ui components
- PostgreSQL database + Prisma schema (initial models)
- NextAuth.js with credentials provider
- Basic layout: sidebar nav, main content area
- Railway deployment config

## Phase 2: GBP OAuth & Profile Management
**Goal**: Connect Google accounts and list all business profiles
**Requirements**: R1.1–R1.5, R6.2 (partial)
**Success**: Can OAuth into Google, see all locations listed in dashboard

- Google Cloud project setup instructions
- OAuth 2.0 flow (connect account button)
- Token storage and refresh logic
- Fetch and store locations from GBP API
- Profiles list page with connection status
- Prisma models: Account, Profile, OAuthToken

## Phase 3: AI Post Generation & Drafts
**Goal**: Generate and store post drafts using Claude AI
**Requirements**: R2.1–R2.5, R3.1
**Success**: Can generate a month of post drafts for a profile and view them

- Claude API integration (@anthropic-ai/sdk)
- Post generation prompt engineering (by business type/category)
- Generate 4 weekly posts per profile
- Batch generation for multiple profiles
- Posts dashboard: list drafts by profile, status filter
- Prisma models: Post (with status enum)

## Phase 4: Post Approval & Publishing
**Goal**: Approve drafts and auto-publish on schedule
**Requirements**: R3.2–R3.5
**Success**: Approved posts publish automatically via GBP API on schedule

- Post approval UI (individual + bulk approve)
- Scheduling logic: distribute approved posts across month
- BullMQ + Redis setup for job queue
- Publish worker: posts to GBP API at scheduled time
- Retry logic for failed publishes
- Status tracking in UI

## Phase 5: Review Sync & AI Responses
**Goal**: Fetch reviews, generate AI responses, publish them
**Requirements**: R4.1–R4.7
**Success**: New reviews appear in dashboard with AI-drafted responses, can approve and publish

- Review sync worker (periodic polling via BullMQ repeatable job)
- Store reviews in database
- Reviews dashboard: list by profile, filter by status/rating
- Claude AI response generation (sentiment-aware)
- Approval flow (approve individually or bulk)
- Publish response via GBP API
- Auto-approve setting per profile
- Prisma models: Review, ReviewResponse

## Phase 6: Analytics & PDF Reporting
**Goal**: Track GBP performance metrics and generate PDF reports
**Requirements**: R5.1–R5.6
**Success**: Can view metrics in dashboard and download PDF reports

- Metrics sync worker (daily pull from Performance API)
- Search keyword sync (monthly)
- Analytics dashboard: charts, key metrics per profile
- PDF report template with @react-pdf/renderer
- Report generation endpoint (single + bulk)
- Download UI for reports
- Prisma models: DailyMetric, MonthlyKeyword, Report

## Phase 7: Polish & Production Readiness
**Goal**: Production-ready tool for the full 100-200 profile workload
**Requirements**: R6.2, R6.3, R6.5
**Success**: Team can manage all profiles end-to-end without Page by Merchant

- Dashboard home with aggregate stats
- Profile detail page (unified view of posts, reviews, metrics)
- Settings page (connected accounts, AI prompt templates, team)
- Error handling and monitoring
- Rate limiting and API quota management
- Documentation for team onboarding
- Load testing with 200 profiles

---

## Timeline Estimate
- Phase 1: Day 1 (morning)
- Phase 2: Day 1 (afternoon)
- Phase 3: Day 1 (evening)
- Phase 4: Day 2 (morning)
- Phase 5: Day 2 (afternoon)
- Phase 6: Day 2 (evening)
- Phase 7: Day 3 (polish)

**Weekend target is aggressive but achievable** for core functionality. Full polish and 200-profile load testing may extend into the following week.
