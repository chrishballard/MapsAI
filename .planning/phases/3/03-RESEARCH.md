# Phase 3: AI Post Generation & Drafts - Research

**Researched:** 2026-03-04
**Domain:** Claude AI text generation, Google Business Profile post types, prompt engineering
**Confidence:** HIGH

## Summary

Phase 3 integrates the Anthropic Claude API via `@anthropic-ai/sdk` to generate Google Business Profile post drafts. The SDK provides structured JSON output via `messages.parse()` with Zod schemas, which is the ideal pattern for generating posts with typed fields (content, callToAction, postType). The existing Prisma schema already has the `Post` model with correct enums (`PostType`, `PostStatus`), but needs a new `PromptTemplate` model to support R2.3 (custom prompts per business/category).

GBP posts have a 1,500-character hard limit, but best practice is 150-300 characters for mobile visibility (first ~150 chars show before truncation). The three post types (WHATS_NEW, EVENT, OFFER) each have different required fields when publishing via the GBP API -- the AI generation should produce content that maps cleanly to these API structures.

**Primary recommendation:** Use `@anthropic-ai/sdk` with `messages.parse()` + Zod schemas for type-safe structured post generation. Use `claude-sonnet-4-5-20250929` (not Opus) to keep costs low for batch generation of 400-800 posts/month. Build a prompt template system with sensible defaults per business category.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| R2.1 | Generate post drafts using Claude API based on business category, name, and context | Anthropic SDK `messages.parse()` with Zod for structured output; prompt templates with business context injection |
| R2.2 | Support "What's New", "Event", and "Offer" post types | Each type needs different prompt structure and output fields; maps to GBP API topicType |
| R2.3 | Allow custom prompts/templates per business or category | New `PromptTemplate` Prisma model; default templates per category with override capability |
| R2.4 | Batch-generate posts for a full month (4 posts per profile) | Sequential API calls (not parallel to avoid rate limits); progress tracking via server-sent events or polling |
| R2.5 | Store drafts with status: draft, approved, scheduled, published, failed | Post model already exists with correct enums in Prisma schema |
| R3.1 | Dashboard view of all pending drafts, filterable by profile | Server component with Prisma queries; filter by profileId, status, type |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @anthropic-ai/sdk | ^0.78.0 | Claude API client | Official Anthropic TypeScript SDK with type-safe structured outputs |
| zod | ^3.23 | Schema validation | Required by SDK's `zodOutputFormat()` for structured JSON output |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | (already installed) | Icons for post UI | Status badges, action buttons |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @anthropic-ai/sdk direct | Vercel AI SDK (@ai-sdk/anthropic) | AI SDK adds streaming UI helpers but unnecessary overhead for server-side batch generation; direct SDK is simpler and more control |
| claude-sonnet-4-5 | claude-opus-4-6 | Opus is higher quality but 15x more expensive; Sonnet is sufficient for short marketing posts |

**Installation:**
```bash
npm install @anthropic-ai/sdk zod
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  lib/
    claude.ts              # Anthropic client singleton
    post-generator.ts      # Post generation logic + prompt templates
    prompts/
      defaults.ts          # Default prompt templates by category
      types.ts             # Zod schemas for generated post structure
  app/
    api/
      posts/
        generate/
          route.ts         # POST: generate posts for a profile
        [id]/
          route.ts         # PATCH: update post, DELETE: delete post
        route.ts           # GET: list posts with filters
    dashboard/
      posts/
        page.tsx           # Posts list with filters (server component)
        generate/
          page.tsx         # Generation UI (select profile, configure, generate)
```

### Pattern 1: Anthropic Client Singleton
**What:** Single client instance reused across requests
**When to use:** Always -- avoids creating new HTTP connections per request
**Example:**
```typescript
// src/lib/claude.ts
import Anthropic from "@anthropic-ai/sdk";

const globalForAnthropic = globalThis as unknown as {
  anthropic: Anthropic | undefined;
};

export const anthropic =
  globalForAnthropic.anthropic ??
  new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

if (process.env.NODE_ENV !== "production") globalForAnthropic.anthropic = anthropic;
```

### Pattern 2: Structured Output with Zod
**What:** Use `messages.parse()` with `zodOutputFormat()` for guaranteed JSON structure
**When to use:** Every post generation call -- ensures parseable, typed output
**Example:**
```typescript
// src/lib/prompts/types.ts
import { z } from "zod";

export const GeneratedPostSchema = z.object({
  content: z.string().describe("The post body text, 150-300 characters"),
  callToAction: z.string().optional().describe("Call to action text if applicable"),
  callToActionUrl: z.string().optional().describe("URL for the call to action"),
  suggestedType: z.enum(["WHATS_NEW", "EVENT", "OFFER"]).describe("Best post type for this content"),
});

export const BatchPostsSchema = z.object({
  posts: z.array(GeneratedPostSchema).length(4).describe("Four weekly posts for the month"),
});

export type GeneratedPost = z.infer<typeof GeneratedPostSchema>;
```

```typescript
// src/lib/post-generator.ts
import { anthropic } from "./claude";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { BatchPostsSchema } from "./prompts/types";

export async function generateMonthlyPosts(profile: {
  name: string;
  category: string | null;
  address: string | null;
}, customPrompt?: string) {
  const systemPrompt = customPrompt || getDefaultPrompt(profile.category);

  const response = await anthropic.messages.parse({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{
      role: "user",
      content: `Generate 4 weekly Google Business Profile posts for: ${profile.name}${profile.category ? ` (${profile.category})` : ""}${profile.address ? ` located at ${profile.address}` : ""}. Mix post types between What's New, Events, and Offers as appropriate for this business type.`,
    }],
    output_config: { format: zodOutputFormat(BatchPostsSchema) },
  });

  return response.parsed_output;
}
```

### Pattern 3: Batch Generation with Progress
**What:** Generate posts for multiple profiles sequentially with progress tracking
**When to use:** When generating for all profiles at once
**Example:**
```typescript
// API route for batch generation
export async function POST(request: Request) {
  const { profileIds } = await request.json();
  const results = [];

  for (const profileId of profileIds) {
    try {
      const profile = await prisma.profile.findUnique({ where: { id: profileId } });
      if (!profile) continue;

      const generated = await generateMonthlyPosts(profile);

      const posts = await prisma.post.createMany({
        data: generated.posts.map((post, index) => ({
          profileId,
          type: post.suggestedType as PostType,
          content: post.content,
          callToAction: post.callToAction,
          status: "DRAFT",
        })),
      });

      results.push({ profileId, count: generated.posts.length, status: "success" });
    } catch (error) {
      results.push({ profileId, count: 0, status: "error", error: String(error) });
    }
  }

  return NextResponse.json({ results });
}
```

### Anti-Patterns to Avoid
- **Parallel API calls for batch generation:** Claude API has rate limits. Process profiles sequentially or with a small concurrency limit (2-3 max).
- **Generating one post per API call:** Generate all 4 monthly posts in a single call to reduce latency and cost. The model can produce 4 varied posts in one request.
- **Hardcoding prompts in route handlers:** Keep prompts in a dedicated module so they can be iterated on without touching API logic.
- **Not validating output length:** Even with structured output, validate that `content` stays under 1,500 chars (GBP limit) before saving.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON parsing from AI output | Custom regex/JSON.parse with error handling | `messages.parse()` + `zodOutputFormat()` | SDK handles constrained decoding; guaranteed valid JSON matching your schema |
| Rate limiting | Custom delay/retry logic | Sequential processing + try/catch with exponential backoff | Simple sequential calls avoid rate limits for batch sizes under 200 |
| Post content validation | Manual character counting | Zod schema `.max(1500)` refinement + GBP field validation | Schema validation catches issues at generation time |

**Key insight:** The `messages.parse()` method with Zod eliminates the entire class of "AI returned malformed JSON" bugs that plague most AI integrations. Use it exclusively.

## Common Pitfalls

### Pitfall 1: Posts Too Long for Mobile Display
**What goes wrong:** Generated posts are technically valid (under 1,500 chars) but get truncated on mobile, hiding the key message.
**Why it happens:** Without explicit length guidance, Claude generates 300-600 character posts.
**How to avoid:** Explicitly instruct in the prompt: "Keep posts between 150-300 characters. Front-load the most important information in the first 100 characters." Add Zod refinement: `z.string().max(300)`.
**Warning signs:** Posts consistently over 300 characters.

### Pitfall 2: Generic/Repetitive Posts Across Profiles
**What goes wrong:** All restaurants get the same "Come try our delicious food!" style posts.
**Why it happens:** Prompt doesn't include enough business-specific context.
**How to avoid:** Include business name, category, address/city in the prompt. Use category-specific default templates. Allow custom context per profile (seasonal info, specialties).
**Warning signs:** Posts are interchangeable between different businesses.

### Pitfall 3: Claude API Cost Surprises
**What goes wrong:** Batch generation for 200 profiles costs more than expected.
**Why it happens:** Using Opus instead of Sonnet, or making too many API calls.
**How to avoid:** Use `claude-sonnet-4-5-20250929` (~$3/M input, $15/M output tokens). Generate 4 posts per call (not 1). Estimate: 200 profiles x ~500 input tokens x ~800 output tokens = ~$3.40/month.
**Warning signs:** Monthly API costs exceeding $20.

### Pitfall 4: Missing Prompt Template for New Categories
**What goes wrong:** A business with an unusual category gets generic, low-quality posts.
**Why it happens:** Default prompt templates only cover common categories.
**How to avoid:** Have a solid generic fallback template. Allow custom prompt override per profile. Log which profiles use fallback vs. specific templates.
**Warning signs:** Users manually editing every generated post for certain profiles.

### Pitfall 5: Offer/Event Posts Missing Required Fields
**What goes wrong:** Generated OFFER posts lack coupon codes or dates required by GBP API.
**Why it happens:** AI generates the content but doesn't know GBP API field requirements.
**How to avoid:** For this phase (generation only, not publishing), store suggested type and content. When publishing in Phase 4, add required fields (dates, coupon codes) during approval flow. Don't try to auto-generate coupon codes.
**Warning signs:** OFFER/EVENT posts that would fail GBP API validation.

## Code Examples

### Claude Client Setup
```typescript
// src/lib/claude.ts
// Source: @anthropic-ai/sdk npm documentation
import Anthropic from "@anthropic-ai/sdk";

const globalForAnthropic = globalThis as unknown as {
  anthropic: Anthropic | undefined;
};

export const anthropic =
  globalForAnthropic.anthropic ??
  new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

if (process.env.NODE_ENV !== "production") {
  globalForAnthropic.anthropic = anthropic;
}
```

### Default Prompt Template System
```typescript
// src/lib/prompts/defaults.ts
const GENERIC_TEMPLATE = `You are a local business marketing expert creating Google Business Profile posts.

Rules:
- Each post should be 150-300 characters
- Front-load the most compelling information in the first 100 characters
- Use a friendly, professional tone
- Include a call-to-action when appropriate
- Vary the content across the 4 posts (don't repeat themes)
- Make posts feel authentic and specific, not generic
- Do NOT use hashtags (GBP doesn't support them well)
- Do NOT use emojis excessively (1-2 max per post)

Post types to use:
- WHATS_NEW: General updates, tips, highlights about the business
- EVENT: Only if the business type commonly has events (restaurants, venues, etc.)
- OFFER: Special deals or promotions (use sparingly, 1 per month max)`;

const CATEGORY_TEMPLATES: Record<string, string> = {
  restaurant: `${GENERIC_TEMPLATE}

Focus areas for restaurants:
- Seasonal menu items or specials
- Chef highlights or kitchen stories
- Community involvement
- Dining atmosphere and experience`,

  dentist: `${GENERIC_TEMPLATE}

Focus areas for dental practices:
- Dental health tips and education
- New services or technology
- Patient comfort and experience
- Insurance and affordability info`,

  // Add more categories as needed
};

export function getDefaultPrompt(category: string | null): string {
  if (!category) return GENERIC_TEMPLATE;
  const key = category.toLowerCase().replace(/[^a-z]/g, "");
  return CATEGORY_TEMPLATES[key] || GENERIC_TEMPLATE;
}
```

### Prisma Schema Addition for PromptTemplate
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

Note: The Profile model needs a `promptTemplate PromptTemplate?` relation added.

### Posts API Route (List with Filters)
```typescript
// src/app/api/posts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get("profileId");
  const status = searchParams.get("status");
  const type = searchParams.get("type");

  const posts = await prisma.post.findMany({
    where: {
      ...(profileId && { profileId }),
      ...(status && { status: status as PostStatus }),
      ...(type && { type: type as PostType }),
    },
    include: { profile: { select: { name: true, category: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ posts });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| JSON.parse AI output with try/catch | `messages.parse()` + `zodOutputFormat()` | SDK ~0.50+ (2025) | Guaranteed valid structured output via constrained decoding |
| `client.completions.create()` | `client.messages.create()` | Messages API (2024) | Completions API deprecated; messages is the only supported API |
| Manual prompt for JSON format | `output_config: { format: zodOutputFormat(schema) }` | Structured outputs (2025) | No more "please respond in JSON" prompt hacks |

**Deprecated/outdated:**
- Completions API: Fully replaced by Messages API
- `anthropic-version` header management: SDK handles this automatically

## Google Business Profile Post Specifications

### Character Limits
| Field | Limit | Recommended |
|-------|-------|-------------|
| Post body (summary) | 1,500 chars max | 150-300 chars for mobile visibility |
| First visible on mobile | ~150 chars before "...more" | Front-load key info here |
| Event title | 58 chars | Keep concise |
| Offer title | 58 chars | Keep concise |

### Post Type Field Requirements (for future GBP API publishing)
| Post Type | Required Fields | Optional Fields |
|-----------|----------------|-----------------|
| WHATS_NEW | summary, languageCode | media, callToAction |
| EVENT | summary, languageCode, event.title, event.schedule (start/end) | media, callToAction |
| OFFER | summary, languageCode, offer.couponCode, offer.redeemOnlineUrl, offer.termsConditions | media |

### Call to Action Types (GBP API)
BOOK, ORDER, SHOP, LEARN_MORE, SIGN_UP, CALL

### Cost Estimation (claude-sonnet-4-5)
| Scenario | Input Tokens | Output Tokens | Cost/call | Monthly (200 profiles) |
|----------|-------------|---------------|-----------|----------------------|
| 4 posts per profile | ~500 | ~800 | ~$0.014 | ~$2.80 |
| With custom context | ~800 | ~800 | ~$0.015 | ~$3.00 |

## Open Questions

1. **Regeneration UX**
   - What we know: Users will want to regenerate individual posts they don't like
   - What's unclear: Should regeneration create a new post or replace the existing one?
   - Recommendation: Replace existing draft (same post ID, update content). Add a "Regenerate" button per post. Track generation count to avoid infinite regeneration.

2. **Month/Week targeting for generated posts**
   - What we know: Need 4 posts per month (weekly cadence)
   - What's unclear: Should generated posts have suggested dates, or just be 4 undated drafts?
   - Recommendation: Generate as undated drafts. Scheduling happens in Phase 4 (approval). Keeps generation simple and decoupled.

3. **Custom context per profile beyond category**
   - What we know: R2.3 requires custom prompts/templates per business
   - What's unclear: How much custom context do users want to provide (keywords, seasonal focus, tone)?
   - Recommendation: Start with a simple free-text "custom context" field on Profile. Power users can create full custom PromptTemplates. Default templates handle 80% of cases.

## Sources

### Primary (HIGH confidence)
- [@anthropic-ai/sdk npm](https://www.npmjs.com/package/@anthropic-ai/sdk) - SDK version, installation, basic usage
- [Anthropic SDK TypeScript GitHub](https://github.com/anthropics/anthropic-sdk-typescript) - Code patterns, streaming, structured output
- [Claude Structured Outputs docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) - `messages.parse()`, `zodOutputFormat()`, Zod integration
- [GBP API localPosts reference](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts) - Post types, field requirements

### Secondary (MEDIUM confidence)
- [GBP Post best practices guide](https://www.socialchamp.com/blog/guide-to-google-business-profile-posts/) - Character limit recommendations, mobile truncation
- [GBP API posts-data](https://developers.google.com/my-business/content/posts-data) - Post creation fields by type

### Tertiary (LOW confidence)
- Cost estimates for claude-sonnet-4-5 based on published pricing; actual costs may vary with prompt length and output variation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official SDK docs verified, structured outputs well-documented
- Architecture: HIGH - Follows existing project patterns (singleton clients, API routes, server components)
- GBP post specs: MEDIUM - Character limits from multiple sources; API field requirements from official Google docs
- Cost estimates: MEDIUM - Based on published pricing but actual token counts will vary
- Pitfalls: HIGH - Common AI integration issues well-documented

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable domain, SDK may get minor updates)
