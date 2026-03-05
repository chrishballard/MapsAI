# Google Business Profile API Research

## API Landscape (as of 2026)

Google split the old "Google My Business API" into several specialized APIs. Here's what's available and relevant to MapsAI:

### 1. Google My Business API v4 (Core)
- **Status**: Active (last updated 2026-02-24)
- **Base URL**: `https://mybusiness.googleapis.com/v4/`
- **Capabilities**:
  - Account and location management
  - Media management (photos)
  - Review management (read, reply, delete reply)
  - Local posts (create, update, delete, list)
  - Business information updates

### 2. Business Profile Performance API v1
- **Status**: Active
- **Base URL**: `https://businessprofileperformance.googleapis.com/v1/`
- **Capabilities**:
  - Daily metrics time series (impressions, clicks, calls, direction requests)
  - Monthly search keyword impressions
  - Multi-daily metrics in a single request via `FetchMultiDailyMetricsTimeSeries`
- **Available Metrics**:
  - `BUSINESS_IMPRESSIONS_DESKTOP_MAPS` / `MOBILE_MAPS` / `DESKTOP_SEARCH` / `MOBILE_SEARCH`
  - `WEBSITE_CLICKS`
  - `CALL_CLICKS`
  - `BUSINESS_DIRECTION_REQUESTS`
  - `BUSINESS_CONVERSATIONS`
  - Search keyword impressions (monthly)

### 3. My Business Q&A API
- **Status**: DEPRECATED (discontinued November 3, 2025)
- Replaced by Google's "Ask Maps" AI-powered feature
- NOT available for programmatic use

### 4. My Business Business Calls API
- **Status**: DEPRECATED (May 30, 2023)

---

## Key Endpoints for MapsAI

### Posts (Local Posts)
- `POST /v4/{parent}/localPosts` — Create a post
- `GET /v4/{parent}/localPosts` — List posts
- `PATCH /v4/{parent}/localPosts/{id}` — Update a post
- `DELETE /v4/{parent}/localPosts/{id}` — Delete a post
- **Post types**: What's New, Event, Offer
- **Limitations**: No product posts via API, no video support for "What's New"

### Reviews
- `GET /v4/{parent}/reviews` — List reviews
- `GET /v4/{parent}/reviews/{id}` — Get specific review
- `PUT /v4/{parent}/reviews/{id}/reply` — Reply to a review
- `DELETE /v4/{parent}/reviews/{id}/reply` — Delete a reply
- **Data available**: Comment text, rating (1-5), reviewer name, create/update time

### Analytics / Performance
- `GET /v1/locations/{id}:getDailyMetricsTimeSeries` — Daily metrics over date range
- `GET /v1/locations/{id}:fetchMultiDailyMetricsTimeSeries` — Multiple metrics in one call
- `GET /v1/locations/{id}/searchkeywords/impressions/monthly` — Monthly keyword data
- **Note**: Impressions are unique per user per day

### Locations
- `GET /v4/accounts/{id}/locations` — List all locations
- `GET /v4/accounts/{id}/locations/{id}` — Get location details
- `PATCH /v4/accounts/{id}/locations/{id}` — Update location info

---

## Authentication

### OAuth 2.0 Required
- **Scope**: `https://www.googleapis.com/auth/business.manage`
- This single scope covers all Business Profile API operations

### Setup Requirements
1. Create Google Cloud project
2. Enable Business Profile APIs (My Business API + Performance API)
3. Configure OAuth consent screen
4. Create OAuth 2.0 credentials (client ID + secret)
5. Each merchant must authorize once via OAuth consent dialog
6. Store refresh tokens for ongoing access

### Important Notes
- Merchants must sign in at least once to cache OAuth credentials
- Business profiles must be verified and public
- For managing 100-200 profiles, you'll need each profile owner to authorize once
- Consider: if Vineyard Growth manages these profiles, a single admin account may cover all locations

---

## Rate Limits & Quotas
- Standard Google API quotas apply
- Typical: 60 requests/minute for read operations
- Batch requests available to reduce quota usage
- For 100-200 profiles, daily polling of metrics is well within limits

---

## Key Considerations for MapsAI
1. **No scheduling in API** — Posts publish immediately; scheduling must be built in our app
2. **No Q&A anymore** — Feature was sunset, skip it
3. **OAuth per account** — Need to handle token refresh and storage securely
4. **Media uploads** — Posts can include images, uploaded separately
5. **Performance data lag** — Metrics may have 1-3 day delay from Google
