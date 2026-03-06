# Phase 11: Service Optimization - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

User can discover available services for their business category, generate AI-optimized descriptions for each, approve/reject individually, and push all approved services to GBP without losing existing services. This is wizard step 3 in the onboarding flow.

</domain>

<decisions>
## Implementation Decisions

### Service discovery & selection UX
- Auto-fetch structured services for the profile's GBP category on step load
- Show as a checklist with all services pre-checked (up to 15 services)
- User can uncheck services they don't offer
- User can add custom services via text input (like keyword add flow) for niche services not in the structured list
- Flat list (no grouping by service category) — keeps UI simple and consistent with keywords step

### AI description generation flow
- Batch-generate all descriptions in a single Claude API call (structured output returning all 15 descriptions at once) — faster, cheaper, and Claude can write more differentiated descriptions with full context
- Auto-generate on step load (same pattern as description step) — no manual trigger needed
- Target character count: Claude's discretion, likely ~250-300 chars per service description
- Same retry-with-feedback pattern as description generator if lengths are off
- Each service description is editable in-place — user can tweak wording without regenerating all

### Approve & push workflow (Page by Merchant style)
- Scrollable list: each service is a card showing service name + AI description (editable textarea) + Approve/Don't Approve buttons
- Individual approve/reject per service as user scrolls through
- Running counter above push area: "X/Y services approved"
- At the bottom (past all services):
  - "Approve All" button — batch-approves all remaining unapproved services locally
  - "Push All to Google" button — single API call that pushes all approved services via fetch-merge-push
  - "Skip for Now" link — saves locally, advances wizard
- Approve is local-only; push happens once via the Push button (critical: API replaces entire list, so one write operation)
- Same success/failure pattern as description step: green banner + auto-advance on success, red error with Retry on failure

### Handling existing GBP services
- Don't show existing GBP services in the UI — keep the interface focused on AI-optimized services
- Fetch-merge-push happens server-side: fetch current services from GBP, merge with approved optimized services, push combined list
- Unknown/free-form services already on GBP are preserved silently during merge (never delete what we didn't create)
- Store pre-push snapshot of the full GBP service list before pushing (enables future rollback capability)
- Return visit: show pushed services with timestamps and "Pushed to Google" indicators, with "Regenerate" option available

### Claude's Discretion
- AI prompt engineering for service description quality and keyword incorporation
- Exact service card layout, spacing, and responsive behavior
- Loading skeleton design during batch generation
- How to handle edge case where GBP category returns zero structured services
- Service description character limit enforcement strategy

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `wizard-shell.tsx`: Step infrastructure — ServicesStep will be step index 3 with `onComplete` callback
- `description-step.tsx`: Reference for approve/push UX pattern, success/failure banners, Skip for Now flow
- `description-generator.ts`: Claude integration pattern with retry loop for length targeting
- `google-business-info.ts`: GBP read/write pattern — extend with service fetch/push functions
- `keyword-generator.ts`: Batch structured output pattern — Zod schema with array, `anthropic.messages.parse()`
- Keywords/cities fetched via existing APIs for injection into service description prompts

### Established Patterns
- AI generation: Zod schema -> `anthropic.messages.parse()` -> validate parsed output -> return
- GBP writes: `createGoogleClient(googleAccountId)` -> `oauth2Client.request({ url, method, data })`
- API routes: auth check -> param validation -> DB operation -> response
- Draft-first: isApproved/isPushed boolean flags on models
- Fetch-merge-push: fetch current state from GBP, merge with local changes, push combined result

### Integration Points
- `ProfileService` Prisma model already exists (id, profileId, serviceName, description, isStructured, isApproved, isPushed, pushedAt)
- Keywords fetched via `prisma.profileKeyword.findMany({ where: { profileId } })`
- Cities fetched via `prisma.profileCity.findMany({ where: { profileId } })`
- GBP resource names: `profile.accountResourceName`, `profile.locationName`
- GBP Services API: `mybusinessbusinessinformation.googleapis.com/v1/{locationName}` with `readMask=serviceItems` and `updateMask=serviceItems`
- Onboarding progress API: `/api/onboarding/progress`

</code_context>

<specifics>
## Specific Ideas

- Page by Merchant style: list each service with description, individual approve/don't approve buttons per service card
- "Approve All" button at the very bottom after scrolling past all services
- User should be able to just scroll through, read descriptions, and approve as they go

</specifics>

<deferred>
## Deferred Ideas

- Rollback UI (snapshot is stored but no restore button yet — future phase)
- Service grouping/categorization in UI (flat list for now, could add groups later)
- Showing existing GBP services for comparison (keeping UI simple for v1)

</deferred>

---

*Phase: 11-service-optimization*
*Context gathered: 2026-03-05*
