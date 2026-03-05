# Phase 10: Description Optimization - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

User can generate an AI SEO-optimized business description (max 750 chars) using stored keywords and cities, review/edit it, approve it, and push it live to Google Business Profile. This is wizard step 2 in the onboarding flow.

</domain>

<decisions>
## Implementation Decisions

### Description generation UX
- Generate a single description at a time (not multiple variants)
- Auto-generate on first visit to the step (no manual trigger needed for initial generation)
- "Regenerate" button available for subsequent generations
- Page by Merchant-style layout: show current GBP description alongside AI-recommended description

### Review & editing layout
- Stacked layout (top/bottom): current description on top (read-only, muted), AI recommendation below (editable)
- AI description appears in an editable textarea — user can tweak wording before approving
- Live character counter below textarea showing "X/750"
- Counter changes color as it approaches limit (green -> yellow -> red)
- First 250 characters marked/indicated as "visible in Google Search"
- Block save and disable approve button if description exceeds 750 characters (show red warning text)
- Show keyword usage indicators: display stored keywords below the description with checkmarks on keywords that appear in the text

### Approve & push flow
- Single "Approve & Push to Google" button in the description area (not the wizard bottom bar)
- One action: saves to DB (isApproved: true) AND pushes to GBP in sequence
- If push fails, description is still saved locally
- Button shows spinner + "Pushing to Google..." during the push
- On success: green banner ("Description pushed to Google Business Profile") then auto-advance to next wizard step after 2-3 seconds
- On failure: inline red error banner below description with "Retry" button
- "Skip for Now" option available — lets user continue wizard without pushing (description saved locally only)

### Return visit behavior
- If user already approved & pushed, show the pushed description with timestamp and "Pushed to Google" indicator
- Offer "Regenerate" button to create a new description if they want to change it
- Wizard bottom bar shows "Continue" for advancing (since step is already complete)

### Claude's Discretion
- AI prompt engineering for description quality and keyword weaving strategy
- Loading skeleton design during generation
- Exact spacing, typography, and color values beyond established patterns
- How to handle edge case where profile has no current GBP description (empty current section)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `wizard-shell.tsx`: Step infrastructure — DescriptionStep will be step index 2 with `onComplete` callback
- `keywords-cities-step.tsx`: Reference implementation for step pattern — fetch on mount, AI suggestions panel, save flow
- `keyword-generator.ts`: Claude integration pattern — Zod schema, `anthropic.messages.parse()`, structured output
- `post-generator.ts`: Keyword weaving pattern — passes keywords[] and cities[] to Claude for natural incorporation
- `google-posts.ts` / `google-reviews.ts`: GBP write pattern — `createGoogleClient()`, `oauth2Client.request()`, direct API calls
- `Loader2` icon with `animate-spin` for loading states
- Existing button styles: `bg-blue-600`, `bg-green-600`, `text-red-600`

### Established Patterns
- AI generation: Zod schema -> `anthropic.messages.parse()` -> validate parsed output -> return
- GBP writes: `createGoogleClient(googleAccountId)` -> `oauth2Client.request({ url, method, data })`
- API routes: auth check -> param validation -> DB operation -> response
- Draft-first: isApproved/isPushed boolean flags on models
- Atomic DB updates: `prisma.$transaction()` for delete-all + create-many

### Integration Points
- `ProfileDescription` Prisma model already exists (id, profileId, content, isApproved, isPushed, pushedAt)
- Keywords fetched via `prisma.profileKeyword.findMany({ where: { profileId } })`
- Cities fetched via `prisma.profileCity.findMany({ where: { profileId } })`
- GBP resource names: `profile.accountResourceName`, `profile.locationName`
- Onboarding progress API: `/api/onboarding/progress`

</code_context>

<specifics>
## Specific Ideas

- "I like the way Page by Merchant does it — shows your current description and then shows the recommended description with the ability to approve it"
- The layout should feel like a natural comparison: what you have now vs what AI suggests

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-description-optimization*
*Context gathered: 2026-03-05*
