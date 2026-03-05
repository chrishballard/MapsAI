# MapsAI — Requirements (Milestone 1: MVP)

## R1: Google Business Profile Connection
- R1.1: OAuth 2.0 flow to connect a GBP account
- R1.2: Store and refresh OAuth tokens securely
- R1.3: List all locations under a connected account
- R1.4: Support connecting multiple accounts (for managing 100-200 profiles)
- R1.5: Display connection status per profile in dashboard

## R2: AI Post Generation
- R2.1: Generate post drafts using Claude API based on business category, name, and context
- R2.2: Support "What's New", "Event", and "Offer" post types
- R2.3: Allow custom prompts/templates per business or category
- R2.4: Batch-generate posts for a full month (4 posts per profile)
- R2.5: Store drafts with status: draft, approved, scheduled, published, failed

## R3: Post Approval & Scheduling
- R3.1: Dashboard view of all pending drafts, filterable by profile
- R3.2: Approve individual posts or bulk-approve all drafts for a profile/month
- R3.3: On approval, auto-schedule posts evenly across the month (weekly cadence)
- R3.4: Scheduled posts publish automatically via GBP API at their scheduled time
- R3.5: Track publish status and handle failures with retry logic

## R4: Review Management
- R4.1: Poll for new reviews across all connected profiles (periodic sync)
- R4.2: Display new reviews in dashboard with rating, text, reviewer info
- R4.3: Auto-generate review response drafts using Claude API
- R4.4: Response considers: review sentiment, star rating, business context
- R4.5: Option to auto-publish responses or queue for human approval
- R4.6: Publish approved responses via GBP API
- R4.7: Track response status: pending, drafted, approved, published

## R5: Analytics & Reporting
- R5.1: Sync performance metrics from GBP Performance API (daily)
- R5.2: Store metrics: impressions (search/maps), clicks, calls, direction requests
- R5.3: Store monthly search keyword data
- R5.4: Generate PDF report per profile with:
  - Business info header
  - Key metrics summary (current month vs previous month)
  - Impressions trend chart
  - Top search keywords
  - Review summary (count, average rating, response rate)
  - Posts published in period
- R5.5: Bulk-generate reports for all profiles
- R5.6: Download individual or bulk PDF reports

## R6: Dashboard & Auth
- R6.1: Simple login (email/password) for internal team
- R6.2: Dashboard home: overview of all profiles with key stats
- R6.3: Profile detail page: posts, reviews, metrics for single profile
- R6.4: Navigation: Profiles, Posts, Reviews, Reports, Settings
- R6.5: Settings: manage connected accounts, default AI prompts, team members

## Non-Requirements (Explicitly Out of Scope for MVP)
- Client-facing portal / paywall
- Q&A management (API deprecated)
- Photo/media optimization
- Competitor tracking
- Multi-platform support (Yelp, Facebook, etc.)
- White-labeling
- Mobile app
