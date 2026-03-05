# Architecture Patterns

**Domain:** GBP Onboarding Wizard & AI-Powered Profile Optimization
**Researched:** 2026-03-04

## Recommended Architecture

The onboarding and optimization features integrate into the existing Next.js App Router architecture as a new route group under `/dashboard/onboarding/` with supporting API routes, new Prisma models, new GBP API wrapper functions, and new AI generation modules. The wizard is a multi-step client component with local state, persisting progress to the database at each step boundary.

### High-Level Data Flow

```
Wizard UI (client) ──POST──> API Route ──> AI Generator ──> Draft Record (DB)
                                                               │
User Approves ─────PUT───> API Route ──> GBP API Wrapper ──> Google API (push live)
                                              │
                                         Update DB record status → PUBLISHED
```

This mirrors the existing draft-first pattern used for posts and reviews: AI generates content, user approves, then it pushes to GBP.

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `OnboardingWizard` (client component) | Multi-step UI, local wizard state, step navigation | API routes via fetch |
| `src/app/api/onboarding/` routes | Orchestrate wizard steps, persist progress, trigger AI | Prisma, AI generators, GBP wrappers |
| `src/lib/keyword-generator.ts` | AI-generate target keywords for a profile | `claude.ts` (Anthropic SDK) |
| `src/lib/description-generator.ts` | AI-generate SEO business description | `claude.ts` |
| `src/lib/service-generator.ts` | AI-generate/optimize service descriptions | `claude.ts` |
| `src/lib/google-business-info.ts` | PATCH location description, services, read location | `google.ts` (OAuth client) |
| `src/lib/google-attributes.ts` | List available attributes, update attributes | `google.ts` (OAuth client) |
| `src/lib/google-media.ts` | Upload logo/photos via Media API | `google.ts` (OAuth client) |
| `ProfileOptimization` (client component) | Re-optimization UI on profile detail page | Same API routes as wizard |

## New vs Modified: Explicit Inventory

### New Files to Create

**Prisma Schema Additions** (modify `schema.prisma`):
- `ProfileKeyword` model -- target keywords per profile (up to 10)
- `ProfileCity` model -- target cities per profile (up to 3)
- `ProfileDescription` model -- AI-generated descriptions with approval status
- `ProfileService` model -- AI-generated service descriptions with approval status
- `OnboardingProgress` model -- wizard step tracking per profile
- New fields on `Profile`: `postFrequency`, `onboardingCompletedAt`, `logoUrl`

**API Routes** (all new):
- `src/app/api/onboarding/keywords/route.ts` -- generate/save target keywords
- `src/app/api/onboarding/cities/route.ts` -- save target cities
- `src/app/api/onboarding/description/route.ts` -- generate/approve/push description
- `src/app/api/onboarding/services/route.ts` -- generate/approve/push services
- `src/app/api/onboarding/attributes/route.ts` -- list/update attributes
- `src/app/api/onboarding/logo/route.ts` -- upload logo
- `src/app/api/onboarding/progress/route.ts` -- read/update wizard progress
- `src/app/api/onboarding/settings/route.ts` -- post frequency, social links

**Library Modules** (all new):
- `src/lib/keyword-generator.ts`
- `src/lib/description-generator.ts`
- `src/lib/service-generator.ts`
- `src/lib/google-business-info.ts`
- `src/lib/google-attributes.ts`
- `src/lib/google-media.ts`

**Pages** (all new):
- `src/app/dashboard/onboarding/page.tsx` -- wizard entry/profile selection
- `src/app/dashboard/onboarding/[profileId]/page.tsx` -- wizard for specific profile

**Components** (all new):
- `src/components/onboarding/wizard-shell.tsx` -- step indicator, navigation, progress
- `src/components/onboarding/step-keywords.tsx` -- keyword generation/editing
- `src/components/onboarding/step-cities.tsx` -- target city selection
- `src/components/onboarding/step-description.tsx` -- description generation/approval
- `src/components/onboarding/step-services.tsx` -- service generation/approval
- `src/components/onboarding/step-attributes.tsx` -- attribute toggles
- `src/components/onboarding/step-settings.tsx` -- post frequency, social links, logo
- `src/components/onboarding/step-review.tsx` -- summary before final push
- `src/components/profile/optimize-button.tsx` -- re-optimization trigger on profile page

### Modified Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add 5 new models + fields on Profile |
| `src/components/sidebar.tsx` | Add "Onboarding" nav item |
| `src/app/dashboard/profiles/[id]/page.tsx` | Add "Optimize" button, show keywords/cities/description |
| `src/lib/post-generator.ts` | Inject keywords and target cities into post generation prompt |
| `src/lib/prompts/defaults.ts` | Update templates to accept keywords/cities context |
| `src/app/api/profiles/route.ts` | Include onboarding status in profile list response |

## Data Model Design

### New Prisma Models

```prisma
model ProfileKeyword {
  id        String   @id @default(cuid())
  profileId String
  profile   Profile  @relation(fields: [profileId], references: [id], onDelete: Cascade)
  keyword   String
  isPrimary Boolean  @default(false)
  createdAt DateTime @default(now())

  @@unique([profileId, keyword])
}

model ProfileCity {
  id        String   @id @default(cuid())
  profileId String
  profile   Profile  @relation(fields: [profileId], references: [id], onDelete: Cascade)
  city      String   // e.g. "Austin, TX"
  createdAt DateTime @default(now())

  @@unique([profileId, city])
}

model ProfileDescription {
  id           String   @id @default(cuid())
  profileId    String
  profile      Profile  @relation(fields: [profileId], references: [id], onDelete: Cascade)
  content      String   @db.Text
  status       String   @default("DRAFT")  // DRAFT | APPROVED | PUBLISHED | FAILED
  pushedAt     DateTime?
  errorMessage String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model ProfileService {
  id            String   @id @default(cuid())
  profileId     String
  profile       Profile  @relation(fields: [profileId], references: [id], onDelete: Cascade)
  serviceName   String
  description   String?  @db.Text
  serviceType   String   @default("FREE_FORM")  // FREE_FORM | STRUCTURED
  serviceTypeId String?  // For structured services (e.g. "job_type_id:hair_coloring")
  status        String   @default("DRAFT")  // DRAFT | APPROVED | PUBLISHED
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model OnboardingProgress {
  id             String   @id @default(cuid())
  profileId      String   @unique
  profile        Profile  @relation(fields: [profileId], references: [id], onDelete: Cascade)
  currentStep    Int      @default(0)
  completedSteps String   @default("[]")  // JSON array of completed step names
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

### Profile Model Additions

```prisma
model Profile {
  // ... existing fields ...
  postFrequency          Int       @default(4)  // posts per month
  onboardingCompletedAt  DateTime?
  logoUrl                String?

  // New relations
  keywords               ProfileKeyword[]
  cities                 ProfileCity[]
  descriptions           ProfileDescription[]
  services               ProfileService[]
  onboardingProgress     OnboardingProgress?
}
```

## Wizard State Management

**Use client-side React state with server persistence at step boundaries.** Not URL-based, not a global state library.

### Why This Approach

1. **Local `useState` per step** -- each step component manages its own form state (keyword list, city inputs, generated description text). Simple, avoids unnecessary re-renders.

2. **Persist to DB on step completion** -- when the user clicks "Next" or "Save", an API call writes the step data to the database AND updates `OnboardingProgress.currentStep`. This gives durability: user can close browser and resume later.

3. **No URL-based step routing** -- the wizard is a single page (`/dashboard/onboarding/[profileId]`) with step components swapped via state. Avoids back-button issues and keeps the wizard cohesive. The current step is loaded from `OnboardingProgress` on page mount.

4. **No Redux/Zustand** -- overkill for a linear wizard. The data between steps is independent (keywords don't need to be visible while editing the description). Each step loads its own data from the API.

### Wizard Step Flow

```
Step 0: Select Profile (if not already selected)
  |
  v
Step 1: Keywords (AI generates 10, user can edit/remove/add)
  |
  v
Step 2: Target Cities (user enters up to 3)
  |
  v
Step 3: Description (AI generates using keywords+cities, user approves, push to GBP)
  |
  v
Step 4: Services (AI generates using keywords, user approves individually, push to GBP)
  |
  v
Step 5: Attributes (load available from GBP, toggle values, save)
  |
  v
Step 6: Settings (post frequency, logo upload, social links note)
  |
  v
Step 7: Review & Complete (summary of everything, mark onboarding done)
```

### Step Component Pattern

```typescript
// Each step follows this consistent pattern:
function StepKeywords({ profileId, onNext, onBack }: StepProps) {
  const [keywords, setKeywords] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load existing data on mount
  useEffect(() => {
    fetch(`/api/onboarding/keywords?profileId=${profileId}`)
      .then(r => r.json())
      .then(data => { setKeywords(data.keywords); setLoading(false); });
  }, [profileId]);

  // AI generate
  async function handleGenerate() {
    setGenerating(true);
    const res = await fetch(`/api/onboarding/keywords`, {
      method: 'POST',
      body: JSON.stringify({ profileId, action: 'generate' }),
    });
    const data = await res.json();
    setKeywords(data.keywords);
    setGenerating(false);
  }

  // Save and advance
  async function handleNext() {
    setSaving(true);
    await fetch(`/api/onboarding/keywords`, {
      method: 'PUT',
      body: JSON.stringify({ profileId, keywords }),
    });
    onNext();
  }

  return (/* step UI with keyword list, edit controls, generate button */);
}
```

## GBP API Integration Layer

### New Wrapper: `google-business-info.ts`

Handles reading and updating location fields via `mybusinessbusinessinformation` v1 API.

```typescript
import { google } from "googleapis";
import { createGoogleClient } from "./google";

// Read current location data
export async function getLocationDetails(
  googleAccountId: string,
  locationName: string
) {
  const oauth2Client = await createGoogleClient(googleAccountId);
  const api = google.mybusinessbusinessinformation({ version: "v1", auth: oauth2Client });

  const res = await api.locations.get({
    name: locationName,
    readMask: "name,title,profile,serviceItems,websiteUri,categories",
  });
  return res.data;
}

// Update business description
// PATCH /v1/locations/{id}?updateMask=profile
// Body: { profile: { description: "..." } }
export async function updateLocationDescription(
  googleAccountId: string,
  locationName: string,
  description: string
) {
  const oauth2Client = await createGoogleClient(googleAccountId);
  const api = google.mybusinessbusinessinformation({ version: "v1", auth: oauth2Client });

  await api.locations.patch({
    name: locationName,
    updateMask: "profile",
    requestBody: { profile: { description } },
  });
}

// Update services (replaces entire list -- API limitation)
// PATCH /v1/locations/{id}?updateMask=serviceItems
export async function updateLocationServices(
  googleAccountId: string,
  locationName: string,
  serviceItems: ServiceItem[]
) {
  const oauth2Client = await createGoogleClient(googleAccountId);
  const api = google.mybusinessbusinessinformation({ version: "v1", auth: oauth2Client });

  await api.locations.patch({
    name: locationName,
    updateMask: "serviceItems",
    requestBody: { serviceItems },
  });
}
```

### New Wrapper: `google-attributes.ts`

```typescript
// List available attributes for a category/region
export async function listAvailableAttributes(
  googleAccountId: string,
  categoryName: string,  // e.g. "gcid:restaurant"
  regionCode: string = "US"
) {
  // GET /v1/attributes?regionCode=US&languageCode=EN&categoryName=gcid:restaurant
  const oauth2Client = await createGoogleClient(googleAccountId);
  const api = google.mybusinessbusinessinformation({ version: "v1", auth: oauth2Client });

  const res = await api.attributes.list({ regionCode, languageCode: "EN", categoryName });
  return res.data.attributeMetadata || [];
}

// Get current attribute values for a location
export async function getLocationAttributes(
  googleAccountId: string,
  locationName: string
) {
  const oauth2Client = await createGoogleClient(googleAccountId);
  const api = google.mybusinessbusinessinformation({ version: "v1", auth: oauth2Client });

  const res = await api.locations.getAttributes({ name: `${locationName}/attributes` });
  return res.data.attributes || [];
}

// Update attributes
// PATCH /v1/locations/{id}/attributes?attributeMask=attr1,attr2
export async function updateLocationAttributes(
  googleAccountId: string,
  locationName: string,
  attributes: Attribute[],
  attributeMask: string
) {
  const oauth2Client = await createGoogleClient(googleAccountId);
  const api = google.mybusinessbusinessinformation({ version: "v1", auth: oauth2Client });

  await api.locations.updateAttributes({
    name: `${locationName}/attributes`,
    attributeMask,
    requestBody: { attributes },
  });
}
```

### New Wrapper: `google-media.ts`

```typescript
// Upload logo via Media API (v4 endpoint -- still active for media operations)
// POST /v4/accounts/{accountId}/locations/{locationId}/media
export async function uploadLocationMedia(
  googleAccountId: string,
  accountResourceName: string,
  locationName: string,
  sourceUrl: string,
  category: "LOGO" | "COVER" | "ADDITIONAL"
) {
  const oauth2Client = await createGoogleClient(googleAccountId);
  const parent = `${accountResourceName}/${locationName}`;
  const url = `https://mybusiness.googleapis.com/v4/${parent}/media`;

  const response = await oauth2Client.request({
    url,
    method: "POST",
    data: {
      mediaFormat: "PHOTO",
      locationAssociation: { category },
      sourceUrl,
    },
  });

  return response.data;
}
```

### Social Links: Manual Only (API Not Available)

Social links are NOT available via the GBP API as of March 2026. The wizard should display a note directing users to manage social links manually via the GBP dashboard. Store social link URLs in the database for internal reference, but do not attempt API push. Supported platforms (for the note): Instagram, LinkedIn, Pinterest, TikTok, X (Twitter), YouTube, Facebook.

## AI Generation Architecture

### Keyword Generator

```typescript
// Input: profile name, category, address, website URL
// Output: 10 suggested keywords with reasoning
// Uses structured output (Zod schema) -- same pattern as post-generator.ts

const KeywordSuggestionsSchema = z.object({
  keywords: z.array(z.object({
    keyword: z.string(),
    reasoning: z.string(),  // Displayed to user as context for the suggestion
    isPrimary: z.boolean(), // Top 3 marked as primary
  })).length(10),
});
```

### Description Generator

```typescript
// Input: profile name, category, address, keywords[], targetCities[]
// Output: SEO-optimized business description (750 char GBP limit)
// Keywords and cities are injected into the prompt to ensure SEO alignment

const DescriptionSchema = z.object({
  description: z.string().max(750),
  keywordsUsed: z.array(z.string()),  // Which keywords were woven in
});
```

### Service Generator

```typescript
// Input: profile name, category, keywords[], existing services (if any from GBP)
// Output: array of service descriptions optimized for SEO
// Each service gets its own description for user to approve individually or in bulk

const ServicesSchema = z.object({
  services: z.array(z.object({
    serviceName: z.string(),
    description: z.string().max(300),  // GBP service description limit
    categoryId: z.string(),           // For free-form service items
  })),
});
```

### Feeding Keywords/Cities into Post Generation (Existing File Modified)

The existing `post-generator.ts` (`ProfileInput` interface) needs two new fields:

```typescript
interface ProfileInput {
  name: string;
  category: string | null;
  address: string | null;
  keywords: string[];      // NEW -- loaded from ProfileKeyword
  targetCities: string[];  // NEW -- loaded from ProfileCity
}

// In the user message construction, add:
// "Target keywords to naturally incorporate: [keyword list]"
// "Target cities/areas to reference when relevant: [city list]"
```

## Patterns to Follow

### Pattern 1: Draft-First with Approval (Existing, Extend)
**What:** All AI-generated content starts as DRAFT, requires user approval, then pushes to GBP.
**When:** Descriptions, services -- same as existing posts and review responses.
**Why:** Already proven in the codebase. Users trust the workflow. Prevents bad AI output from going live on 200 profiles.

### Pattern 2: Server Components + Client Islands (Existing, Extend)
**What:** Server components for data fetching; client components for interactivity.
**When:** The wizard page itself is a server component that loads the profile and initial progress. Step components are client components with local state.
**Example:** Profile detail page already does this -- server component fetches data, renders static layout, client components handle interactive elements.

### Pattern 3: Structured AI Output with Zod (Existing, Extend)
**What:** Use `anthropic.messages.parse()` with `zodOutputFormat()` for all AI generation.
**When:** Keywords, descriptions, services -- all use Zod schemas for type-safe parsing.
**Why:** Already used in `post-generator.ts` and `review-responder.ts`. Consistent pattern across the codebase.

### Pattern 4: API Route per Resource (Existing, Extend)
**What:** Each new data type gets its own API route with GET/POST/PUT handlers.
**When:** Keywords, cities, descriptions, services, attributes, progress -- each at their own `/api/onboarding/[resource]` path.
**Why:** Matches existing pattern (`/api/posts`, `/api/reviews`, `/api/profiles`, etc.).

### Pattern 5: Direct GBP Calls for User-Initiated Actions (New)
**What:** For onboarding pushes (description, services, attributes), call the GBP API directly from the API route instead of queuing via BullMQ.
**When:** User clicks "Approve & Push" in the wizard.
**Why:** The user is waiting for confirmation. Onboarding is one-time per profile, not a scheduled batch. Posts use BullMQ because they are scheduled for future times; onboarding is immediate.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Wizard State in URL Query Params
**What:** Encoding wizard step and form data in URL search params.
**Why bad:** Breaks on refresh with complex data, creates ugly URLs, back button causes confusion.
**Instead:** Store current step in DB via `OnboardingProgress`, load on mount.

### Anti-Pattern 2: Single Monolithic Onboarding API Route
**What:** One `/api/onboarding` route handling all steps via action type discrimination.
**Why bad:** Becomes a 500+ line route file, hard to test independently, mixed concerns.
**Instead:** Separate route per resource (`/api/onboarding/keywords`, `/api/onboarding/description`, etc.).

### Anti-Pattern 3: Pushing to GBP Without Approval
**What:** Auto-pushing AI-generated descriptions/services to GBP immediately after generation.
**Why bad:** AI can hallucinate services, descriptions may be off-brand, no safety net.
**Instead:** Follow the existing draft-first pattern. User reviews and approves before any GBP push.

### Anti-Pattern 4: Caching Attributes Locally
**What:** Storing all available attribute values in your DB and syncing bidirectionally.
**Why bad:** Google can add/remove attributes without notice. Cache goes stale silently. The set of available attributes varies by category and region.
**Instead:** Always read available attributes fresh from GBP API when the attributes step loads. Only store attribute values you actually push.

### Anti-Pattern 5: BullMQ for Onboarding Pushes
**What:** Queuing GBP description/service/attribute updates through BullMQ.
**Why bad:** Onboarding pushes are user-initiated and synchronous (user is waiting for confirmation). Posts use queues because they are scheduled for future delivery.
**Instead:** Push directly from the API route, return success/failure to the UI. Reserve BullMQ for scheduled/batched ongoing operations.

### Anti-Pattern 6: Replacing Services Partially
**What:** Trying to update individual service items via the API.
**Why bad:** The GBP API requires replacing the ENTIRE service list in a single PATCH call. Individual updates are not supported.
**Instead:** Always read current services, merge with changes, and send the full list.

## Suggested Build Order

Build order accounts for data dependencies: later features depend on data from earlier ones.

| Order | What to Build | Dependency Rationale |
|-------|---------------|---------------------|
| 1 | Prisma schema changes + migration | Everything depends on the data models existing |
| 2 | `OnboardingProgress` API + wizard shell UI | Framework for all steps; can stub step components |
| 3 | `keyword-generator.ts` + keywords API route + step UI | Keywords are foundational -- description and post generation depend on them |
| 4 | Cities API route + step UI | Simple CRUD (no AI), feeds into description generation |
| 5 | `description-generator.ts` + description API + GBP push (`google-business-info.ts`) + step UI | Depends on keywords + cities being available |
| 6 | `service-generator.ts` + services API + GBP push + step UI | Depends on keywords; independent of description |
| 7 | `google-attributes.ts` + attributes API + step UI | Independent of other steps, but later in wizard |
| 8 | Settings step (post frequency field on Profile, `google-media.ts` for logo) | Independent, straightforward |
| 9 | Review/complete step + mark `onboardingCompletedAt` | Final integration of wizard |
| 10 | Modify `post-generator.ts` + `defaults.ts` to use keywords/cities | Connects onboarding data to ongoing post management |
| 11 | Re-optimization on profile detail page | Reuses API routes from wizard, add "Optimize" button |
| 12 | Social links reference storage + manual instructions note | Lowest priority -- no API integration possible |

## Integration Points Summary

| Existing Component | Integration | What Changes |
|-------------------|-------------|--------------|
| `Profile` model | Extended | New fields: `postFrequency`, `onboardingCompletedAt`, `logoUrl` + 5 new relations |
| `post-generator.ts` | Modified | `ProfileInput` gains `keywords[]` and `targetCities[]`, injected into prompts |
| `prompts/defaults.ts` | Modified | Templates updated to incorporate keyword/city context when available |
| `sidebar.tsx` | Modified | New "Onboarding" nav link added to `navItems` array |
| `profiles/[id]/page.tsx` | Modified | Shows keywords, cities, description status; adds "Re-optimize" button |
| `api/profiles/route.ts` | Modified | Returns `onboardingCompletedAt` in profile list response |
| `google.ts` | Unchanged | Reused for OAuth client creation by all new GBP wrappers |
| `google-locations.ts` | Unchanged | Existing profile sync stays as-is |
| `claude.ts` | Unchanged | Reused as the Anthropic client by all new AI generators |
| BullMQ queues | Unchanged | Onboarding uses direct API calls, not queues |
| `business-selector.tsx` | Unchanged | Already supports profile selection; wizard uses URL param instead |
| Dashboard layout | Unchanged | New pages render within existing layout shell |

## Sources

- [GBP Business Information API reference](https://developers.google.com/my-business/reference/businessinformation/rest) -- HIGH confidence
- [GBP attributes management guide](https://developers.google.com/my-business/content/attributes) -- HIGH confidence
- [GBP services management guide](https://developers.google.com/my-business/content/services) -- HIGH confidence
- [GBP location data guide](https://developers.google.com/my-business/content/location-data) -- HIGH confidence
- [GBP media upload guide](https://developers.google.com/my-business/content/upload-photos) -- HIGH confidence
- [GBP locations.updateAttributes reference](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/updateAttributes) -- HIGH confidence
- Social links API availability: multiple sources confirm not available via API as of 2026 -- MEDIUM confidence
- Existing codebase analysis of `src/lib/google-*.ts`, `src/lib/post-generator.ts`, `src/lib/review-responder.ts`, `prisma/schema.prisma` -- HIGH confidence
