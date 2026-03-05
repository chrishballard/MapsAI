---
phase: 03-ai-post-generation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - prisma/schema.prisma
  - src/lib/claude.ts
  - src/lib/prompts/types.ts
  - src/lib/prompts/defaults.ts
  - src/lib/post-generator.ts
  - src/app/api/posts/generate/route.ts
  - src/app/api/posts/route.ts
  - src/app/dashboard/posts/page.tsx
  - src/app/dashboard/posts/generate/page.tsx
autonomous: true
requirements: [R2.1, R2.2, R2.3, R2.4, R2.5, R3.1]

must_haves:
  truths:
    - "User can generate 4 post drafts for a selected profile via the UI"
    - "Generated posts vary by business category and include appropriate post types"
    - "User can view all generated drafts in the posts dashboard"
    - "User can filter posts by profile and status"
    - "Posts are stored with DRAFT status and correct type (WHATS_NEW, EVENT, OFFER)"
  artifacts:
    - path: "src/lib/claude.ts"
      provides: "Anthropic client singleton"
    - path: "src/lib/post-generator.ts"
      provides: "Post generation logic with structured output"
      exports: ["generateMonthlyPosts"]
    - path: "src/lib/prompts/defaults.ts"
      provides: "Default prompt templates by category"
      exports: ["getDefaultPrompt"]
    - path: "src/lib/prompts/types.ts"
      provides: "Zod schemas for generated post structure"
      exports: ["GeneratedPostSchema", "BatchPostsSchema"]
    - path: "src/app/api/posts/generate/route.ts"
      provides: "POST endpoint for generating posts"
      exports: ["POST"]
    - path: "src/app/api/posts/route.ts"
      provides: "GET endpoint for listing posts with filters"
      exports: ["GET"]
    - path: "src/app/dashboard/posts/page.tsx"
      provides: "Posts list UI with filters"
    - path: "src/app/dashboard/posts/generate/page.tsx"
      provides: "Generation UI with profile selector"
  key_links:
    - from: "src/app/dashboard/posts/generate/page.tsx"
      to: "/api/posts/generate"
      via: "fetch POST on generate button click"
      pattern: "fetch.*api/posts/generate"
    - from: "src/lib/post-generator.ts"
      to: "src/lib/claude.ts"
      via: "import anthropic client"
      pattern: "import.*claude"
    - from: "src/app/api/posts/generate/route.ts"
      to: "src/lib/post-generator.ts"
      via: "calls generateMonthlyPosts"
      pattern: "generateMonthlyPosts"
    - from: "src/app/dashboard/posts/page.tsx"
      to: "/api/posts"
      via: "fetch GET for post listing"
      pattern: "fetch.*api/posts"
---

<objective>
Implement AI-powered post generation using Claude API and build the posts dashboard UI.

Purpose: This is the core AI feature of MapsAI -- generating Google Business Profile post drafts that users can review, approve, and eventually publish. This phase covers the full vertical slice from Claude API integration through to the user-facing generation and viewing UI.

Output: Working post generation flow where a user selects a profile, generates 4 monthly post drafts via Claude, and views/filters all drafts in a posts dashboard.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/3/03-RESEARCH.md
@prisma/schema.prisma
@src/lib/prisma.ts
@src/app/api/profiles/sync/route.ts
@src/app/dashboard/posts/page.tsx

<interfaces>
<!-- Existing patterns the executor needs to follow -->

From src/lib/prisma.ts:
```typescript
export const prisma: PrismaClient;
// Singleton pattern with globalThis caching
```

From src/lib/auth.ts:
```typescript
export const authOptions: NextAuthOptions;
// Used via getServerSession(authOptions) in API routes
```

From prisma/schema.prisma:
```prisma
model Profile {
  id              String         @id @default(cuid())
  googleAccountId String
  locationName    String
  name            String
  category        String?
  address         String?
  // ... has posts Post[] relation
}

enum PostType { WHATS_NEW, EVENT, OFFER }
enum PostStatus { DRAFT, APPROVED, SCHEDULED, PUBLISHED, FAILED }

model Post {
  id           String     @id @default(cuid())
  profileId    String
  profile      Profile    @relation(...)
  type         PostType   @default(WHATS_NEW)
  content      String
  callToAction String?
  status       PostStatus @default(DRAFT)
  // ...
}
```

API route auth pattern (from src/app/api/profiles/sync/route.ts):
```typescript
const session = await getServerSession(authOptions);
if (!session) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Claude API integration, prompt system, and post generation API</name>
  <files>
    src/lib/claude.ts,
    src/lib/prompts/types.ts,
    src/lib/prompts/defaults.ts,
    src/lib/post-generator.ts,
    src/app/api/posts/generate/route.ts,
    src/app/api/posts/route.ts,
    prisma/schema.prisma
  </files>
  <action>
    **Install dependencies:**
    ```bash
    npm install @anthropic-ai/sdk zod
    ```

    **1. Add PromptTemplate model to prisma/schema.prisma:**
    Add after the Post model:
    ```prisma
    model PromptTemplate {
      id         String   @id @default(cuid())
      profileId  String?  @unique
      profile    Profile? @relation(fields: [profileId], references: [id], onDelete: Cascade)
      category   String?
      name       String
      prompt     String   @db.Text
      isDefault  Boolean  @default(false)
      createdAt  DateTime @default(now())
      updatedAt  DateTime @updatedAt

      @@unique([category, isDefault])
    }
    ```
    Add `promptTemplate PromptTemplate?` relation to the Profile model.
    Run `npx prisma db push` to sync schema.

    **2. Create src/lib/claude.ts:**
    Anthropic client singleton following the same globalThis pattern as src/lib/prisma.ts. Use `process.env.ANTHROPIC_API_KEY`.

    **3. Create src/lib/prompts/types.ts:**
    Define Zod schemas:
    - `GeneratedPostSchema`: object with `content` (string, max 300 chars), `callToAction` (optional string), `callToActionUrl` (optional string), `suggestedType` (enum: WHATS_NEW, EVENT, OFFER)
    - `BatchPostsSchema`: object with `posts` array of exactly 4 GeneratedPostSchema items
    - Export inferred TypeScript types

    **4. Create src/lib/prompts/defaults.ts:**
    - `GENERIC_TEMPLATE`: System prompt for GBP post generation. Rules: 150-300 chars, front-load key info, friendly professional tone, vary content, no hashtags, max 1-2 emojis. Include post type guidance (WHATS_NEW for updates, EVENT only for event-oriented businesses, OFFER sparingly).
    - `CATEGORY_TEMPLATES`: Record keyed by lowercase category (restaurant, dentist, salon, auto_repair, law_firm) extending GENERIC_TEMPLATE with category-specific focus areas.
    - `getDefaultPrompt(category: string | null): string` function that looks up category or falls back to generic.

    **5. Create src/lib/post-generator.ts:**
    - `generateMonthlyPosts(profile: { name, category, address }, customPrompt?: string)` function
    - Uses `anthropic.messages.parse()` with `zodOutputFormat(BatchPostsSchema)` from `@anthropic-ai/sdk/helpers/zod`
    - Model: `claude-sonnet-4-5-20250929`, max_tokens: 2048
    - System prompt from customPrompt or getDefaultPrompt(profile.category)
    - User message includes profile name, category, and address
    - Returns typed `BatchPostsSchema` parsed output
    - Validate each post content is under 1500 chars (GBP hard limit) before returning

    **6. Create src/app/api/posts/generate/route.ts:**
    - POST endpoint accepting `{ profileIds: string[] }` in body
    - Auth check with getServerSession pattern
    - For each profileId: fetch profile from DB, check for custom PromptTemplate, call generateMonthlyPosts, save results as Post records with status DRAFT
    - Sequential processing (not parallel) to avoid rate limits
    - Return `{ results: [{ profileId, count, status: "success"|"error", error? }] }`
    - Wrap each profile in try/catch so one failure does not block others

    **7. Create src/app/api/posts/route.ts:**
    - GET endpoint with query params: profileId, status, type (all optional filters)
    - Auth check
    - Query prisma.post.findMany with filters, include profile (select: name, category)
    - Order by createdAt desc
    - Return `{ posts }` array
  </action>
  <verify>
    <automated>npx prisma db push --accept-data-loss 2>&1 | tail -5 && npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>
    - Prisma schema has PromptTemplate model and Profile relation
    - Claude client singleton exists at src/lib/claude.ts
    - Zod schemas define post generation structure with 300-char content limit
    - Default prompt templates cover at least 5 business categories
    - generateMonthlyPosts function uses messages.parse() with zodOutputFormat
    - POST /api/posts/generate accepts profileIds and creates DRAFT posts
    - GET /api/posts returns filtered post list
    - TypeScript compiles without errors
  </done>
</task>

<task type="auto">
  <name>Task 2: Posts dashboard UI and generation page</name>
  <files>
    src/app/dashboard/posts/page.tsx,
    src/app/dashboard/posts/generate/page.tsx
  </files>
  <action>
    **1. Replace src/app/dashboard/posts/page.tsx (posts list with filters):**
    Build a server component that:
    - Fetches posts via the GET /api/posts endpoint (or direct Prisma query since it is a server component -- prefer direct Prisma for server components)
    - Accepts searchParams for profileId, status, type filters
    - Shows filter controls at top: profile dropdown (fetch all profiles), status dropdown (DRAFT, APPROVED, SCHEDULED, PUBLISHED, FAILED), type dropdown (WHATS_NEW, EVENT, OFFER)
    - Filter changes should update URL searchParams (use links or client component wrapper for interactivity)
    - Displays posts in a card grid layout:
      - Each card shows: profile name, post type badge (color-coded: blue for WHATS_NEW, purple for EVENT, green for OFFER), status badge, content preview (truncated at 150 chars), created date
      - Empty state when no posts: keep existing empty state design but add a "Generate Posts" button linking to /dashboard/posts/generate
    - Add a "Generate Posts" button in the page header linking to /dashboard/posts/generate
    - Use Tailwind classes consistent with existing dashboard styling (white cards, gray-200 borders, shadow-sm)

    **2. Create src/app/dashboard/posts/generate/page.tsx (generation UI):**
    This needs client interactivity, so use "use client" directive.
    - Profile selector: fetch profiles from a lightweight API or pass as server component prop via a wrapper. Show profile name and category. Support selecting multiple profiles (checkboxes) or a single profile.
    - "Generate Monthly Posts" button that:
      - Calls POST /api/posts/generate with selected profileIds
      - Shows loading state with progress ("Generating posts for Profile X...")
      - On success, shows summary (N posts generated for M profiles)
      - Has a "View Posts" link back to /dashboard/posts
    - "Select All" / "Deselect All" convenience buttons
    - Error handling: show toast or inline error if generation fails for any profile
    - Add a link back to /dashboard/posts in the header

    For the profile list in the generate page, create a small API endpoint or use a server component wrapper. Simplest approach: create the generate page as a client component that fetches profiles from a new GET /api/profiles endpoint, or inline the profile fetch. If no GET /api/profiles exists, add one:
    - src/app/api/profiles/route.ts: GET returns all profiles (id, name, category) with auth check

    Style notes:
    - Match existing dashboard aesthetic: white backgrounds, rounded-lg, shadow-sm, gray borders
    - Use lucide-react icons (FileText, Sparkles, Check, AlertCircle) for visual cues
    - Responsive: single column on mobile, 2-3 columns on larger screens for post cards
  </action>
  <verify>
    <automated>npm run build 2>&1 | tail -10</automated>
  </verify>
  <done>
    - Posts page shows all drafts in a filterable card grid
    - Filter by profile, status, and post type works via URL searchParams
    - Empty state shows "Generate Posts" call to action
    - Generate page shows profile selector with checkboxes
    - Clicking "Generate Monthly Posts" calls the API and shows loading/success states
    - Generated posts appear in the posts list after navigating back
    - Build succeeds without errors
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Complete AI post generation flow: Claude API integration with structured outputs, prompt template system with category-specific templates, batch generation API, posts dashboard with filters, and generation UI with profile selection.
  </what-built>
  <how-to-verify>
    1. Ensure ANTHROPIC_API_KEY is set in .env (or .env.local)
    2. Start dev server: `npm run dev`
    3. Navigate to http://localhost:3000/dashboard/posts -- should show empty state with "Generate Posts" button
    4. Click "Generate Posts" to go to /dashboard/posts/generate
    5. Select one profile and click "Generate Monthly Posts"
    6. Wait for generation to complete (should take 5-15 seconds)
    7. Navigate back to /dashboard/posts -- should show 4 new DRAFT posts
    8. Verify posts have varied content (not all identical)
    9. Verify post types include a mix (mostly WHATS_NEW, possibly an EVENT or OFFER)
    10. Test filters: select a specific profile, select DRAFT status, select a post type
    11. Try generating for multiple profiles at once
  </how-to-verify>
  <resume-signal>Type "approved" or describe any issues with the generation quality, UI, or flow</resume-signal>
</task>

</tasks>

<verification>
- TypeScript compiles: `npx tsc --noEmit`
- App builds: `npm run build`
- Prisma schema valid: `npx prisma validate`
- API endpoints respond:
  - POST /api/posts/generate with profileIds returns generated post results
  - GET /api/posts returns post list (with optional filters)
- Posts dashboard renders with filter controls
- Generate page allows profile selection and triggers generation
</verification>

<success_criteria>
- Can select a profile and generate 4 monthly post drafts via Claude API
- Generated posts are stored with DRAFT status and appropriate PostType
- Posts dashboard displays all drafts with profile name, type badge, status badge, and content preview
- Can filter posts by profile, status, and type
- Prompt templates produce category-appropriate content (restaurant posts differ from dentist posts)
- Build and TypeScript compilation succeed
</success_criteria>

<output>
After completion, create `.planning/phases/3/03-01-SUMMARY.md`
</output>
