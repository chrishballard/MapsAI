# Phase 2: GBP OAuth & Profile Management

## Goal
Connect Google accounts via OAuth 2.0 and import all business profiles into MapsAI.

## Success Criteria
- "Connect Google Account" button initiates OAuth flow
- After OAuth, all GBP locations are fetched and stored in the database
- Profiles page shows all connected profiles with name, address, category, status
- Tokens are stored securely and auto-refresh when expired
- Can connect multiple Google accounts
- Can disconnect an account (removes profiles)

## Requirements Covered
- R1.1: OAuth 2.0 flow to connect a GBP account
- R1.2: Store and refresh OAuth tokens securely
- R1.3: List all locations under a connected account
- R1.4: Support connecting multiple accounts
- R1.5: Display connection status per profile in dashboard

## Prerequisites
- Google Cloud project with Business Profile API enabled
- OAuth 2.0 credentials (client ID + secret)
- User will need to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env

---

## Tasks

### Wave 1: Google OAuth Setup (no dependencies)

#### Task 2.1: Install Google API Dependencies
```
Prompt: Install the googleapis package for Google API interactions.

Commands:
npm install googleapis

Verify: package.json includes googleapis
```

#### Task 2.2: Google Cloud Setup Guide
```
Prompt: Create a setup guide document for configuring Google Cloud credentials.

Create: src/app/dashboard/settings/google-setup.md (will be shown in settings UI)

Content should cover:
1. Go to Google Cloud Console (console.cloud.google.com)
2. Create a new project or select existing
3. Enable APIs: "Google My Business API" and "Business Profile Performance API"
4. Configure OAuth consent screen (External, add business.manage scope)
5. Create OAuth 2.0 credentials (Web application type)
6. Add authorized redirect URI: http://localhost:3000/api/auth/google/callback
7. Copy Client ID and Client Secret to .env

Files:
- docs/google-cloud-setup.md

Verify: Document is clear and complete
```

### Wave 2: OAuth Flow Backend (depends on 2.1)

#### Task 2.3: Google OAuth API Routes
```
Prompt: Create API routes for the Google OAuth flow.

The flow:
1. User clicks "Connect Google Account"
2. GET /api/auth/google → redirects to Google consent screen
3. Google redirects back to /api/auth/google/callback with auth code
4. We exchange code for access + refresh tokens
5. Store tokens in GoogleAccount table
6. Fetch and store all locations
7. Redirect back to /dashboard/profiles

Implementation details:
- Use googleapis OAuth2Client for token exchange
- Scope: https://www.googleapis.com/auth/business.manage
- Store accessToken, refreshToken, tokenExpiry in GoogleAccount
- Get Google user email from token info to identify the account

Files:
- src/app/api/auth/google/route.ts (initiate OAuth)
- src/app/api/auth/google/callback/route.ts (handle callback)

Verify: OAuth flow redirects properly (will need real credentials to fully test)
```

#### Task 2.4: Google API Client Helper
```
Prompt: Create a helper module for authenticated Google API calls.

Features:
1. Create authenticated OAuth2 client from stored tokens
2. Auto-refresh expired tokens (update DB when refreshed)
3. Helper to get My Business API client
4. Helper to get Performance API client

The helper should:
- Accept a GoogleAccount record
- Check if accessToken is expired (compare tokenExpiry to now)
- If expired, use refreshToken to get new accessToken
- Update the GoogleAccount record with new token + expiry
- Return configured googleapis client

Files:
- src/lib/google.ts

Verify: Module exports createGoogleClient, refreshTokenIfNeeded functions
```

### Wave 3: Location Sync (depends on 2.3, 2.4)

#### Task 2.5: Location Sync Service
```
Prompt: Create a service to fetch and sync GBP locations from Google.

Steps:
1. Use authenticated Google client to call My Business API
2. GET accounts → list all accounts
3. For each account, GET accounts/{id}/locations → list all locations
4. For each location, extract: name, locationName, address, phone, category, websiteUrl, placeId
5. Upsert into Profile table (match on locationName which is the unique Google resource name)
6. Mark profiles as connected

API calls:
- mybusiness.accounts.list()
- mybusiness.accounts.locations.list({ parent: accountName })

Handle pagination (locations may return nextPageToken).

Files:
- src/lib/google-locations.ts

Verify: Function accepts GoogleAccount, returns synced Profile[]
```

#### Task 2.6: Post-OAuth Location Sync
```
Prompt: After OAuth callback, automatically sync all locations.

Update the callback route (from Task 2.3) to:
1. After storing tokens in GoogleAccount
2. Call the location sync service
3. Store all fetched locations as Profiles
4. Redirect to /dashboard/profiles with success message

Files:
- src/app/api/auth/google/callback/route.ts (update)

Verify: After OAuth, profiles appear in database
```

### Wave 4: Profiles UI (depends on 2.5)

#### Task 2.7: Profiles List Page
```
Prompt: Replace the placeholder profiles page with a real listing.

Features:
1. Show all profiles from database in a table/card grid
2. Each profile shows: name, address, category, connection status (green/red badge)
3. "Connect Google Account" button at top (links to /api/auth/google)
4. Show which Google account each profile belongs to
5. Profile count in header
6. Empty state if no profiles connected

Table columns: Name, Address, Category, Google Account, Status

Files:
- src/app/dashboard/profiles/page.tsx (rewrite)

Verify: Page renders profiles from DB, shows connect button
```

#### Task 2.8: Disconnect Account Flow
```
Prompt: Add ability to disconnect a Google account.

Features:
1. In Settings page, show list of connected Google accounts
2. Each account shows: email, number of profiles, connected date
3. "Disconnect" button per account
4. On disconnect: delete GoogleAccount + cascade delete its Profiles
5. Confirmation dialog before disconnect
6. API route: DELETE /api/google-accounts/[id]

Files:
- src/app/api/google-accounts/[id]/route.ts
- src/app/dashboard/settings/page.tsx (update)

Verify: Can disconnect account, profiles are removed
```

#### Task 2.9: Manual Resync Button
```
Prompt: Add a "Resync Profiles" button to re-fetch locations from Google.

Features:
1. Button on profiles page: "Resync All Profiles"
2. Calls API route: POST /api/profiles/sync
3. For each connected GoogleAccount, re-run location sync
4. Updates existing profiles, adds new ones, marks missing ones as disconnected
5. Shows loading state during sync
6. Toast/notification on completion with count

Files:
- src/app/api/profiles/sync/route.ts
- src/app/dashboard/profiles/page.tsx (update with button)

Verify: Resync button triggers location fetch
```

### Wave 5: Dashboard Integration (depends on 2.7)

#### Task 2.10: Update Dashboard Stats
```
Prompt: Make the dashboard home page show real profile counts.

Update /dashboard:
1. Query Profile.count() for "Total Profiles" stat
2. Query Profile.count({ where: { isConnected: true } }) for connected count
3. Update the CTA to show "Connect More Profiles" if some exist
4. Keep other stats at 0 for now (posts, reviews, reports)

Files:
- src/app/dashboard/page.tsx (update)

Verify: Dashboard shows real profile count from DB
```

---

## Execution Order
1. **Wave 1** (parallel): Tasks 2.1, 2.2
2. **Wave 2** (parallel): Tasks 2.3, 2.4
3. **Wave 3** (parallel): Tasks 2.5, 2.6
4. **Wave 4** (parallel): Tasks 2.7, 2.8, 2.9
5. **Wave 5**: Task 2.10

## Commit Points
- After Wave 2: "feat: add Google OAuth flow for GBP connection"
- After Wave 3: "feat: sync GBP locations after OAuth"
- After Wave 4+5: "feat: profiles listing, disconnect, resync, and dashboard stats"

## Risk Mitigation
- OAuth won't work without real Google Cloud credentials — provide clear setup docs
- Google My Business API may require an approval form — check during setup
- If googleapis npm package doesn't support My Business API directly, use raw REST calls
- Token refresh failures should not crash the app — handle gracefully with reconnect prompt

## Google Cloud Setup Checklist (for user)
Before testing this phase:
1. [ ] Create Google Cloud project
2. [ ] Enable "Google My Business API"
3. [ ] Enable "Business Profile Performance API"
4. [ ] Configure OAuth consent screen
5. [ ] Create OAuth 2.0 Web credentials
6. [ ] Add redirect URI: http://localhost:3000/api/auth/google/callback
7. [ ] Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
