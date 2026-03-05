# Google Cloud Setup Guide for MapsAI

## Prerequisites
- A Google account with access to Google Business Profiles
- Admin access to the business profiles you want to manage

## Step 1: Create a Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click the project dropdown at the top, then **New Project**
3. Name it "MapsAI" (or similar), click **Create**
4. Select the new project from the dropdown

## Step 2: Enable Required APIs
1. Go to **APIs & Services > Library**
2. Search for and enable each of these:
   - **My Business Account Management API**
   - **My Business Business Information API**
   - **Business Profile Performance API**
   - **My Business Verifications API** (optional)

## Step 3: Configure OAuth Consent Screen
1. Go to **APIs & Services > OAuth consent screen**
2. Select **External** user type, click **Create**
3. Fill in:
   - App name: "MapsAI"
   - User support email: your email
   - Developer contact email: your email
4. Click **Save and Continue**
5. On Scopes page, click **Add or Remove Scopes**
6. Add: `https://www.googleapis.com/auth/business.manage`
7. Click **Save and Continue**
8. Add your Google account as a test user
9. Click **Save and Continue**

## Step 4: Create OAuth 2.0 Credentials
1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. Application type: **Web application**
4. Name: "MapsAI Web Client"
5. Under **Authorized redirect URIs**, add:
   - `http://localhost:3000/api/auth/google/callback`
   - (For production, add your deployed URL too)
6. Click **Create**
7. Copy the **Client ID** and **Client Secret**

## Step 5: Configure Environment Variables
Add to your `.env` file:

```
GOOGLE_CLIENT_ID=your-client-id-here
GOOGLE_CLIENT_SECRET=your-client-secret-here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

## Step 6: Verify Setup
1. Start MapsAI: `npm run dev`
2. Go to the dashboard and click **Connect Google Account**
3. You should be redirected to Google's consent screen
4. After authorizing, your business profiles should appear

## Troubleshooting
- **"Access blocked" error**: Make sure your Google account is added as a test user in the OAuth consent screen
- **"API not enabled" error**: Double-check that all APIs from Step 2 are enabled
- **No profiles showing**: Ensure the Google account has admin access to the business profiles
- **Token refresh issues**: Try disconnecting and reconnecting the account
