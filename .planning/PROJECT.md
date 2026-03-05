# MapsAI — Project Context

## Vision
MapsAI is an internal AI-powered tool that replaces Page by Merchant ($10k/month) for managing 100-200 Google Business Profiles. It auto-generates posts, responds to reviews, and produces analytics reports — saving Vineyard Growth ~$120k/year.

## Problem
Vineyard Growth spends $10,000/month on Page by Merchant for GBP management across 100-200 client profiles. The core features used are post generation, review responses, and reporting — all achievable with Google's free APIs + Claude AI at ~$150-200/month.

## Users
- **Primary**: Vineyard Growth internal team (3-5 people)
- **Future**: Potential SaaS offering to existing audience (paywall after 3-4 months if successful)

## Core Workflow
1. Team onboards a client's GBP to MapsAI (OAuth connection)
2. AI generates monthly post drafts for each profile
3. Team reviews and approves drafts at start of month
4. Approved posts auto-publish on weekly schedule
5. New reviews trigger AI-drafted responses (auto-approved or queued for review)
6. Monthly PDF reports generated from GBP analytics

## Tech Stack
- **Runtime**: Node.js / TypeScript
- **Framework**: Next.js 14+ (App Router)
- **Database**: PostgreSQL (Prisma ORM)
- **Queue**: BullMQ + Redis
- **AI**: Claude API (@anthropic-ai/sdk)
- **PDF**: @react-pdf/renderer
- **Auth**: NextAuth.js
- **Styling**: Tailwind CSS
- **Hosting**: Railway

## Scale
- 100-200 GBP profiles
- ~4 posts per profile per month = 400-800 posts/month
- Reviews vary, estimate 500-2000 reviews/month across all profiles
- Monthly reports for each profile

## Constraints
- Google Business Profile API requires OAuth per account (one-time per profile owner)
- Posts publish immediately via API — scheduling is app-side
- Performance metrics may have 1-3 day lag from Google
- Q&A API was deprecated (Nov 2025) — skip this feature
- No video support in posts via API

## Success Criteria
- Replace Page by Merchant entirely within 1 month
- All 100+ profiles generating posts and responding to reviews
- Monthly PDF reports for each profile
- Total cost under $500/month (vs $10,000)
