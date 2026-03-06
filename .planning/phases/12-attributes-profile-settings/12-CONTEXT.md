# Phase 12: Attributes & Profile Settings - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

User can manage GBP attributes (fetched dynamically per business category), configure post frequency, and complete the onboarding wizard with a summary review. This covers wizard steps 4 (Attributes), 5 (Settings), and 6 (Review & Complete).

</domain>

<decisions>
## Implementation Decisions

### Attributes display & interaction
- Attributes grouped by GBP category group (e.g., 'Accessibility', 'Amenities', 'Service Options') with collapsible sections
- All groups start expanded on load
- Show ALL available attributes for the category with current GBP values pre-filled
- Native controls per attribute type: toggle switches for booleans, radio buttons for single-choice enums, checkboxes for repeated enums, text input for URL types
- Auto-fetch attributes on step load (consistent with other steps)

### Attributes push behavior
- No per-attribute approve flow — user toggles/selects freely, then one "Push to Google" button at the bottom sends all attribute values
- "Skip for Now" option available (consistent with description and services steps) — saves locally, advances wizard
- If GBP API returns no attributes for the business category, auto-skip the step with a "No attributes available for this category" message and auto-complete
- No change diff before push — just push all currently-toggled values (current values already visible in the UI)
- Same success/failure banner pattern as description and services steps

### Post frequency configuration
- Dropdown with presets: 4/month (weekly), 8/month (2x/week), 12/month (3x/week), Custom
- Custom option allows number input capped at 30 posts/month
- Default value: 4 posts/month (weekly)
- Settings step shows post frequency only — no other settings in this step
- New `postFrequency` field needed on Profile model (integer, default 4)
- scheduling.ts integration: use stored postFrequency when calculating schedule dates

### Review & Complete step (ONBRD-04)
- Checklist summary showing status of each wizard step (complete/skipped/pending)
- Each step in the checklist is a clickable link that navigates back to that step for fixing
- Allow completion with skipped steps — user doesn't have to finish everything
- "Complete Onboarding" button marks onboarding as done
- After completion: redirect to the profile's detail page in the dashboard (not onboarding list)

### Claude's Discretion
- Exact attribute group names and ordering (depends on GBP API response structure)
- Loading skeleton design during attribute fetch
- Exact spacing, typography, and responsive behavior
- How to handle partially-failed attribute pushes (some succeed, some fail)
- Checklist visual design (icons, colors for complete/skipped/pending states)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `wizard-shell.tsx`: Steps 4 (Attributes), 5 (Settings), 6 (Review & Complete) already registered in STEP_CONFIG with placeholder UI
- `description-step.tsx` / `services-step.tsx`: Reference for step pattern — fetch on mount, push flow, success/failure banners, Skip for Now
- `google-business-info.ts`: GBP read/write pattern — extend with attribute fetch/push functions
- `step-indicator.tsx`: Already renders all 7 wizard steps with click navigation
- `Loader2` icon with `animate-spin` for loading states
- Existing button styles: `bg-blue-600`, `bg-green-600`, `text-red-600`

### Established Patterns
- GBP writes: `createGoogleClient(googleAccountId)` -> `oauth2Client.request({ url, method, data })`
- API routes: auth check -> param validation -> DB operation -> response
- Draft-first: isApproved/isPushed boolean flags on models
- Wizard step components receive `profileId` and `onComplete` callback
- Auto-generation/fetch on step load (no manual trigger)

### Integration Points
- `Profile` model: needs new `postFrequency Int @default(4)` field
- `OnboardingProgress` model: already has `isComplete`, `completedAt`, `completedSteps` fields
- `scheduling.ts`: `calculateScheduleDates(postCount, month, year)` — needs to read `postFrequency` from profile
- GBP Attributes API: `mybusinessbusinessinformation.googleapis.com/v1/{locationName}/attributes` with category-based discovery
- Wizard navigation: `completeCurrentStep()` and `goToStep()` already handle step transitions
- Post-completion redirect: change from `router.push("/dashboard/onboarding?completed=true")` to profile page

</code_context>

<specifics>
## Specific Ideas

- Attributes should feel like a settings panel — toggle things on/off, select values, then push once
- Post frequency presets should cover the most common use cases (weekly, 2x/week, 3x/week) without requiring custom input for most users
- Review step should be quick to scan — checklist, not a wall of text

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-attributes-profile-settings*
*Context gathered: 2026-03-05*
