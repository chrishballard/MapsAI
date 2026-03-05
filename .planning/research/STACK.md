# Technology Stack

**Project:** MapsAI - Milestone v1.1 (Onboarding & Optimization)
**Researched:** 2026-03-04
**Scope:** Stack additions/changes for GBP write operations, media upload, wizard UI, and AI keyword generation

## Existing Stack (DO NOT CHANGE)

Already validated and shipping. Listed for reference only:

| Technology | Version | Status |
|------------|---------|--------|
| Next.js (App Router) | 16.1.6 | Shipping |
| TypeScript | 5.x | Shipping |
| PostgreSQL + Prisma | 7.4.2 | Shipping |
| BullMQ + Redis | 5.70.2 | Shipping |
| @anthropic-ai/sdk | 0.78.0 | Shipping |
| googleapis | 171.4.0 | Shipping |
| NextAuth.js | 4.24.13 | Shipping |
| Tailwind CSS | 4.x | Shipping |
| Zod | 4.3.6 | Shipping |
| Lucide React | 0.577.0 | Shipping |
| @react-pdf/renderer | 4.3.2 | Shipping |

## New Stack Additions

### No New Dependencies Required

The milestone's core features are achievable with zero new npm packages. Here is why:

**GBP API write operations** use `googleapis` (already installed at v171.4.0) via `google.mybusinessbusinessinformation({ version: 'v1' })` -- the same client already used for location reads in `src/lib/google-locations.ts`. Write operations (patch descriptions, services, attributes) are different methods on the same client.

**Media/logo upload** uses the v4 API endpoint (`accounts.locations.media`) which is still active (not deprecated). The `googleapis` package exposes this via `google.mybusiness({ version: 'v4' })` for the media create/upload methods, or direct HTTP requests via the OAuth2 client (pattern already used in `src/lib/google-posts.ts`).

**Multi-step wizard** is a UI pattern, not a library. React `useState` for step tracking + existing Zod for per-step validation + existing Tailwind for styling. No form library needed for the wizard's scope (a few text fields per step, not a complex nested form).

**AI keyword generation** uses the existing `@anthropic-ai/sdk` with Claude Sonnet. No third-party keyword API needed -- the PROJECT.md explicitly defers keyword volume data.

**File upload handling** uses Next.js built-in `Request.formData()` in API routes. No multer or formidable needed -- Next.js App Router handles multipart form data natively.

### One Recommended Addition: sharp

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| sharp | ^0.33.x | Server-side image processing | Resize/validate logos before GBP upload. GBP requires logos at 720x720px, JPG/PNG, 10KB-5MB. sharp is already a transitive dependency of Next.js (used by `next/image`) so it adds near-zero bundle weight. |

```bash
npm install sharp
```

**Why sharp:**
- GBP logo requirements: 720x720px square, JPG or PNG, 10KB-5MB
- Users will upload arbitrary images -- resizing server-side prevents API rejection
- Already bundled with Next.js as an optional dependency for `next/image` optimization
- No alternative needed -- sharp is the universal standard for Node.js image processing

## GBP API Integration Details

### API Endpoints for Write Operations

All write operations use the OAuth scope `https://www.googleapis.com/auth/business.manage` which is already configured in `src/lib/google.ts`.

#### 1. Update Business Description

**API:** `mybusinessbusinessinformation.v1` (already used for reads)
**Method:** `locations.patch`
**Endpoint:** `PATCH https://mybusinessbusinessinformation.googleapis.com/v1/locations/{locationId}?updateMask=profile.description`

```typescript
// Uses existing google client pattern from src/lib/google-locations.ts
const mybusinessbusinessinformation = google.mybusinessbusinessinformation({
  version: "v1",
  auth: oauth2Client,
});

await mybusinessbusinessinformation.locations.patch({
  name: `locations/${locationId}`,
  updateMask: "profile.description",
  requestBody: {
    profile: {
      description: "AI-generated SEO description here",
    },
  },
});
```

**Confidence:** HIGH -- same API client used for existing location reads. `locations.patch` is documented at [locations/patch reference](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/patch).

#### 2. Update Services

**API:** `mybusinessbusinessinformation.v1`
**Method:** `locations.patch` with `updateMask=serviceItems`
**Constraint:** Must replace the entire service list -- individual service updates are not supported.

```typescript
await mybusinessbusinessinformation.locations.patch({
  name: `locations/${locationId}`,
  updateMask: "serviceItems",
  requestBody: {
    serviceItems: [
      {
        freeFormServiceItem: {
          category: { displayName: "Plumbing", categoryId: "gcid:plumber" },
          label: { displayName: "Drain cleaning", description: "AI-optimized description" },
        },
      },
    ],
  },
});
```

Two service item formats exist:
- **StructuredServiceItem** -- uses Google's predefined `serviceTypeId` (query available services via `categories.batchGet` with `view=FULL`)
- **FreeFormServiceItem** -- custom label with description text (more flexible, use this for AI-generated descriptions)

**Confidence:** HIGH -- documented at [services guide](https://developers.google.com/my-business/content/services).

#### 3. Update Attributes

**API:** `mybusinessbusinessinformation.v1`
**Method:** `locations.updateAttributes`
**Endpoint:** `PATCH https://mybusinessbusinessinformation.googleapis.com/v1/locations/{locationId}/attributes?attributeMask=attr1,attr2`

```typescript
// First: discover available attributes for the business category
const available = await mybusinessbusinessinformation.attributes.list({
  parent: `locations/${locationId}`,
});

// Then: update specific attributes
await mybusinessbusinessinformation.locations.updateAttributes({
  name: `locations/${locationId}/attributes`,
  attributeMask: "has_wheelchair_accessible_entrance,wi_fi",
  requestBody: {
    attributes: [
      { name: "locations/{id}/attributes/has_wheelchair_accessible_entrance", values: [true] },
      { name: "locations/{id}/attributes/wi_fi", values: ["paid"] },
    ],
  },
});
```

**Key constraint:** Available attributes vary by business category and region. Must query `attributes.list` first to know what's settable.

**Confidence:** HIGH -- documented at [attributes guide](https://developers.google.com/my-business/content/attributes).

#### 4. Upload Logo/Media

**API:** Google My Business v4 (NOT mybusinessbusinessinformation v1 -- media lives in v4)
**Status:** v4 media endpoints are still active (not on deprecation schedule as of March 2026)

Two upload methods:

**Method A: Upload from URL (simpler, if image is already hosted)**
```typescript
const oauth2Client = await createGoogleClient(googleAccountId);
const url = `https://mybusiness.googleapis.com/v4/${accountResourceName}/${locationName}/media`;

await oauth2Client.request({
  url,
  method: "POST",
  data: {
    mediaFormat: "PHOTO",
    locationAssociation: { category: "LOGO" },
    sourceUrl: "https://example.com/logo.jpg",
  },
});
```

**Method B: Upload from bytes (for user-uploaded files)**
```typescript
// Step 1: Get upload reference
const startRes = await oauth2Client.request({
  url: `https://mybusiness.googleapis.com/v4/${accountResourceName}/${locationName}/media:startUpload`,
  method: "POST",
});
const resourceName = startRes.data.resourceName;

// Step 2: Upload binary data
await oauth2Client.request({
  url: `https://mybusiness.googleapis.com/upload/v1/media/${resourceName}?upload_type=media`,
  method: "POST",
  headers: { "Content-Type": "image/jpeg" },
  body: imageBuffer,
});

// Step 3: Create media item linking to uploaded data
await oauth2Client.request({
  url: `https://mybusiness.googleapis.com/v4/${accountResourceName}/${locationName}/media`,
  method: "POST",
  data: {
    mediaFormat: "PHOTO",
    locationAssociation: { category: "LOGO" },
    dataRef: { resourceName },
  },
});
```

**Media categories:** `LOGO`, `COVER`, `ADDITIONAL`

**Confidence:** HIGH -- v4 media endpoints confirmed active. Documented at [upload media guide](https://developers.google.com/my-business/content/upload-photos).

#### 5. Social Profile Links

**API status:** Social links are NOT available in the GBP API as a writable field.

The `mybusinessbusinessinformation.v1` Location resource schema does not include `socialProfiles`, `moreUrls`, or any social link fields. Social links were added to the GBP web dashboard in 2023 but have not been exposed as API-writable fields.

**Recommendation:** Store social links in the local database (Prisma) for reference/display in the app, but do NOT attempt to push them to GBP via API. This is a manual GBP dashboard task. Flag this clearly in the UI: "Social links must be updated manually in Google Business Profile."

**Confidence:** MEDIUM -- could not find social links in any v1 API schema documentation. Multiple community posts confirm this limitation. Worth re-checking periodically as Google may add it.

## Wizard UI Pattern (No Library Needed)

The onboarding wizard is 4-5 steps with simple forms. This does NOT warrant `react-hook-form` or a wizard library.

**Pattern: useState + Zod per-step validation**

```typescript
// Wizard state
const [step, setStep] = useState(1);
const [data, setData] = useState<WizardData>({});

// Per-step Zod schemas (already have Zod 4.3.6)
const Step1Schema = z.object({ profileId: z.string() });
const Step2Schema = z.object({ keywords: z.array(z.string()).max(10) });
// etc.
```

**Why NOT react-hook-form:**
- Each wizard step has 2-5 fields max
- No deeply nested forms, no dynamic field arrays, no complex validation
- Adding react-hook-form for simple forms adds learning overhead without payoff
- Zod handles validation, React state handles the rest

**Why NOT a wizard library (react-step-wizard, etc.):**
- These libraries add routing/animation concerns we do not need
- The wizard is a single page with conditional rendering, not multi-page navigation
- Custom step indicator + conditional rendering is ~30 lines of code

## File Upload in Next.js App Router

Next.js 16 handles multipart form data natively in API routes:

```typescript
// src/app/api/upload-logo/route.ts
export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("logo") as File;
  const buffer = Buffer.from(await file.arrayBuffer());

  // Resize with sharp
  const resized = await sharp(buffer)
    .resize(720, 720, { fit: "cover" })
    .jpeg({ quality: 85 })
    .toBuffer();

  // Upload to GBP via v4 media API
  // ...
}
```

No multer, no formidable, no busboy. Native `Request.formData()` is sufficient.

## Database Schema Additions

New Prisma models needed (no new database technology):

```prisma
// Add to existing Profile model
model Profile {
  // ... existing fields ...
  keywords        String[]    @default([])     // AI-suggested target keywords (up to 10)
  targetCities    String[]    @default([])     // Target cities (up to 3)
  seoDescription  String?     @db.Text         // AI-generated SEO description
  onboardedAt     DateTime?                     // Null = not yet onboarded
  postFrequency   Int         @default(3)      // Posts per week
  socialLinks     Json?                         // { facebook, instagram, etc. } stored locally only
}

// New model for service descriptions
model ServiceDescription {
  id          String   @id @default(cuid())
  profileId   String
  profile     Profile  @relation(fields: [profileId], references: [id], onDelete: Cascade)
  serviceName String
  description String   @db.Text
  isApproved  Boolean  @default(false)
  isPushed    Boolean  @default(false)   // Pushed to GBP
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

## What NOT to Add

| Do Not Add | Why |
|------------|-----|
| react-hook-form | Wizard forms are simple; useState + Zod is sufficient |
| react-step-wizard | 30 lines of custom code replaces an entire library |
| multer / formidable | Next.js App Router handles FormData natively |
| @google-cloud/storage | Not needed; logos upload directly to GBP, not to cloud storage |
| Any keyword volume API (SEMrush, Ahrefs, etc.) | PROJECT.md explicitly defers this; AI suggestions are enough |
| A separate image upload service | sharp + direct GBP media upload is sufficient |
| shadcn/ui (if not already installed) | Already using Tailwind + Lucide; adding shadcn mid-project for a few components is churn |

## Integration Points with Existing Code

| New Feature | Integrates With | How |
|-------------|----------------|-----|
| GBP description update | `src/lib/google-locations.ts` | Add `updateLocationDescription()` using same `mybusinessbusinessinformation` client |
| GBP service update | `src/lib/google-locations.ts` | Add `updateLocationServices()` using same client |
| GBP attribute update | `src/lib/google-locations.ts` | Add `updateLocationAttributes()` using same client |
| Logo upload | `src/lib/google-posts.ts` | Follow same `oauth2Client.request()` pattern for v4 API calls |
| AI keyword generation | `@anthropic-ai/sdk` | New prompt template; feed business name, category, city into Claude |
| AI description generation | `@anthropic-ai/sdk` | New prompt template; include keywords in system prompt |
| Keywords into post generation | Existing prompt templates | Add keywords/cities to post generation prompts |
| Onboarding wizard | `src/app/dashboard/` | New route: `src/app/dashboard/onboarding/page.tsx` |
| Re-optimization | `src/app/dashboard/` | Add buttons to existing profile detail page |

## Sources

- [GBP API locations.patch](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/patch) -- HIGH confidence
- [GBP API attributes guide](https://developers.google.com/my-business/content/attributes) -- HIGH confidence
- [GBP API services guide](https://developers.google.com/my-business/content/services) -- HIGH confidence
- [GBP API media upload guide](https://developers.google.com/my-business/content/upload-photos) -- HIGH confidence
- [GBP API deprecation schedule](https://developers.google.com/my-business/content/sunset-dates) -- HIGH confidence (v4 media still active)
- [GBP API Location resource schema](https://developers.google.com/my-business/reference/businessinformation/rpc/google.mybusiness.businessinformation.v1) -- HIGH confidence
- [googleapis npm Node.js client](https://googleapis.dev/nodejs/googleapis/latest/mybusinessbusinessinformation/classes/Mybusinessbusinessinformation.html) -- HIGH confidence
- [Next.js file upload patterns](https://www.pronextjs.dev/next-js-file-uploads-server-side-solutions) -- MEDIUM confidence
