# Competitor Analysis — GBP Management Tools

## Page by Merchant (Current Tool)

### What It Does
- AI agent for Google Business Profile management
- Auto-generates and publishes GBP posts (with optional human approval)
- Responds to reviews automatically with AI
- Tracks GBP analytics and generates reports
- Multi-location management

### Pricing
- Enterprise pricing, ~$10,000/month for 100-200 profiles (per user report)
- Per-location pricing model at scale

### What to Replicate (Must-Have)
1. AI-generated post drafts with approval workflow
2. Scheduled post publishing (queue approved posts)
3. AI review response drafts + auto-publish option
4. GBP analytics tracking and PDF reporting
5. Multi-location dashboard

### What to Skip (Nice-to-Have for Later)
- Q&A management (Google deprecated the API)
- Photo optimization suggestions
- Competitor analysis features
- White-label client portal

## Other Competitors

### Birdeye (~$299-499/location/month)
- Review management focus
- Multi-platform (Google, Yelp, Facebook)
- Survey and feedback tools
- Overkill for GBP-only needs

### Yext (~$199-999/month)
- Listings management across many platforms
- Knowledge graph approach
- Heavier, more enterprise
- Not GBP-focused enough

### Podium (~$399+/month)
- Review/messaging platform
- Strong in review generation
- Less focus on posting and analytics

### LocalViking (~$33/location/month)
- GBP-specific tool
- Post scheduling
- Rank tracking (grid)
- More manual, less AI

## Key Takeaway
The market charges $50-200+ per location per month for these features. Building in-house for 100-200 locations at $10k/month means we need to beat ~$50-100/location/month. The core APIs are free (just Google Cloud costs), and AI costs via Claude are ~$0.01-0.10 per post/response. The ROI is massive.

## Cost Projection for MapsAI
- Hosting (Railway): ~$50/month
- Redis: ~$10/month
- Claude API (200 profiles x 4 posts/month + reviews): ~$50-100/month
- Google Cloud (API calls): Free tier likely sufficient
- **Total: ~$150-200/month vs $10,000/month = 98% savings**
