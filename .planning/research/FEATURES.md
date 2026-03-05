# Feature Landscape

**Domain:** Google Business Profile multi-location management tool
**Researched:** 2026-03-04

## Table Stakes

Features users expect from a GBP management tool. Missing = tool feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Multi-profile dashboard | Core purpose of the tool | Medium | List all 100-200 profiles with status indicators |
| Profile detail view | Need to see/edit individual profile data | Low | Display GBP data: name, address, hours, categories |
| Post creation & scheduling | Primary workflow | Medium | Create posts, set publish date, queue for publishing |
| Review monitoring | Reviews are critical for local SEO | Medium | Fetch new reviews, display with filters (rating, response status) |
| Review response management | Responding to reviews is the #1 GBP task | Medium | Draft responses (manual or AI), approve, publish |
| Basic reporting | Need to prove value of GBP management | High | Metrics: review count, avg rating, post frequency, response rate |
| Google OAuth login | Accessing GBP API requires Google auth | Medium | OAuth2 flow with proper scopes for Business Profile API |
| Bulk actions | Managing 100-200 profiles one-by-one is unacceptable | Medium | Select multiple profiles, apply action (e.g., create same post for all) |

## Differentiators

Features that set MapsAI apart. These are the AI-powered capabilities.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| AI post generation | Generate on-brand posts in seconds instead of writing manually | Medium | Claude Sonnet with business context (category, location, tone). Drafts require approval. |
| AI review responses | Auto-draft responses to reviews, especially negative ones | Medium | Different tone templates: professional, friendly, apologetic. Human approval required. |
| Smart scheduling | AI suggests optimal posting times based on business category | Low | Simple heuristic initially; can evolve to data-driven later |
| Batch AI generation | Generate a week/month of posts for multiple locations at once | High | Queue-based: submit batch, process async, notify when ready for review |
| Performance PDF reports | Professional branded reports showing GBP metrics over time | High | Puppeteer-based HTML-to-PDF with charts, tables, branding |
| Review sentiment analysis | Categorize reviews by sentiment and topic | Low | Claude can classify reviews during the fetch/process step |
| Template library | Reusable post templates per business category | Low | CRUD for templates with variable substitution (location name, etc.) |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Real-time review notifications | Overengineered for internal tool; GBP API doesn't support webhooks anyway | Poll for new reviews on a cron schedule (every 15-30 min) |
| Multi-user role system | Internal tool with small team; roles add complexity without value initially | Simple Google OAuth -- anyone with access can do everything |
| Custom report builder | Drag-and-drop report builders are massive engineering efforts | Pre-built report templates with date range selection |
| Direct GBP editing (hours, address, etc.) | High risk of accidental data corruption across 200 profiles | Read-only display of profile data; edits happen in Google directly |
| Social media cross-posting | Scope creep -- GBP is not Instagram/Facebook | Keep focused on GBP only |
| White-label / client-facing portal | Premature for internal tool phase | Defer until paywall phase; share PDF reports with clients instead |
| Mobile app | Internal tool used at a desk | Responsive web design is sufficient |

## Feature Dependencies

```
Google OAuth -> Profile Listing -> Profile Detail View
Profile Listing -> Post Creation -> Post Scheduling -> Bulk Post Generation
Profile Listing -> Review Monitoring -> AI Review Responses
Post Creation -> AI Post Generation -> Batch AI Generation
AI Post Generation -> Template Library (templates inform AI prompts)
Profile Listing -> Basic Reporting -> PDF Reports
Review Monitoring -> Review Sentiment Analysis
```

## MVP Recommendation

**Phase 1 MVP -- prove the concept works:**
1. Google OAuth + GBP API connection (table stakes, highest risk)
2. Profile listing dashboard (table stakes)
3. AI post generation with approval flow (core differentiator)
4. Review monitoring + AI response drafts (core differentiator)

**Defer to Phase 2:**
- Post scheduling and queue (automation layer)
- PDF reporting (polish)
- Bulk actions (scale feature)
- Template library (convenience)

**Rationale:** The MVP should prove that the GBP API integration works and that AI-generated content is good enough to publish. Scheduling and reporting are important but don't validate the core hypothesis.
