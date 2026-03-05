# Domain Pitfalls: GBP Onboarding Wizard & Profile Optimization

**Domain:** Adding guided onboarding and AI-powered profile optimization to existing GBP management tool
**Researched:** 2026-03-04
**Focus:** Integration pitfalls when adding write operations, wizard UX, and AI content generation to an existing read-heavy system

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or client damage.

### Pitfall 1: Service Updates Replace the Entire List (No Partial Updates)
**What goes wrong:** The GBP API `locations.patch` with `updateMask=serviceItems` replaces ALL services on the profile, not just the ones you send. If you push 5 AI-generated services without fetching the existing 12 services first, 7 services disappear from the live profile.
**Why it happens:** Developers assume PATCH means partial update. For most GBP fields it does, but `serviceItems` specifically requires sending the complete list every time. The API docs state: "Updating individual services is not supported."
**Consequences:** Client loses existing services from their live GBP listing. Google may take time to re-index. Client trust destroyed.
**Prevention:**
- ALWAYS fetch current `serviceItems` before any update
- Merge AI-generated services INTO the existing list, never replace
- Store a snapshot of the pre-update service list in the database before pushing
- Show a diff view in the UI: "Adding 3 services, keeping 12 existing"
- Build a rollback capability using the stored snapshot
**Detection:** Compare service count before and after update. Alert if count decreased unexpectedly.
**Phase:** Must be addressed in the service optimization implementation. No shortcuts.
**Confidence:** HIGH -- confirmed via official Google documentation.

### Pitfall 2: 10 Edits Per Minute Per Profile Hard Limit
**What goes wrong:** The GBP API enforces a hard limit of 10 edits per minute per profile that CANNOT be increased (unlike the 300 QPM global limit which can be raised). During onboarding, if you push description + services + attributes + categories in rapid succession for one profile, you hit this limit and updates silently fail or error out.
**Why it happens:** The wizard makes it natural to submit all optimizations at once. Developers batch all writes together for a "save all" experience. 10 edits/minute sounds generous until you realize each attribute update, each service push, and each field patch counts as a separate edit.
**Consequences:** Some profile updates succeed, others fail. Profile ends up in an inconsistent state (description updated but services missing). No retry helps because retry storms hit the same limit.
**Prevention:**
- Consolidate writes: combine description + profile fields into a single `locations.patch` call with multiple fields in `updateMask` (e.g., `updateMask=profile.description,websiteUri,phoneNumbers`)
- Attributes use a separate endpoint (`locations.updateAttributes`), so plan the call sequence
- Services use `updateMask=serviceItems` in a separate call
- Space sequential API calls with at least 6-second delays between distinct write operations to the same profile
- Queue all GBP writes through BullMQ with per-profile rate limiting, not just global rate limiting
- The wizard should collect all data first, then push in a controlled sequence on "Finish"
**Detection:** Monitor for 429 errors specifically on write operations. Log the edit count per profile per minute.
**Phase:** Must be designed into the wizard submission flow from the start.
**Confidence:** HIGH -- confirmed in official GBP API usage limits documentation.

### Pitfall 3: Pushing AI Content Directly to Live GBP Without Human Review
**What goes wrong:** AI generates a business description or service descriptions, and the system pushes them to the live Google Business Profile without team approval. The description contains inaccurate claims, keyword stuffing, or content that violates Google's guidelines.
**Why it happens:** The wizard flow feels like a setup process, and developers assume "the user clicked next, so they approved it." But clicking through wizard steps is not the same as carefully reviewing AI-generated content that will appear publicly on Google.
**Consequences:** Inaccurate business descriptions on Google. Google may flag the profile for policy violations. Keyword-stuffed descriptions can actually hurt local SEO rankings. Client calls asking why their profile says something wrong.
**Prevention:**
- Enforce a mandatory review step: AI generates draft, user sees full preview with the exact text that will be pushed, user explicitly approves with a confirmation dialog
- Show a "This will update your live Google Business Profile" warning before any write operation
- Never auto-push. The existing app already has a draft-first workflow for posts and reviews -- use the same pattern for profile optimization
- Add a "Push to GBP" button that is separate from "Save Draft" -- saving locally should not trigger API writes
- Log all content that gets pushed to GBP with timestamps for audit trail
**Detection:** Track rejection rate of AI drafts. If users frequently edit AI suggestions before approving, the prompts need improvement.
**Phase:** Must be the core UX pattern from the start. Retrofitting approval is much harder.
**Confidence:** HIGH -- this is a universal pattern, and the existing app already uses draft-first for posts.

### Pitfall 4: Google Updates Overwriting Your API-Pushed Changes
**What goes wrong:** You push an optimized description via the API. A week later, Google's own automated systems propose an "update" to the description based on web data, user suggestions, or Google's AI. If nobody monitors and rejects these Google Updates, the optimized description gets overwritten with Google's version.
**Why it happens:** Google actively crawls and updates business information from multiple sources. The API is just one input. Google may "correct" your changes based on what it finds elsewhere. Developers don't realize GBP is a living document that Google actively modifies.
**Consequences:** All optimization work gets silently undone. The team doesn't notice because MapsAI only reads profile data on sync, and may not compare it against what was pushed.
**Prevention:**
- Store what you pushed to GBP (the "expected" state) in the database alongside the synced state
- On every profile sync, compare current GBP data against expected data -- alert if they differ
- Use the `locations.getGoogleUpdated` endpoint to check for pending Google Updates and surface them in the dashboard
- Consider subscribing to GBP Pub/Sub notifications for real-time update alerts
- Build a "Profile Health" indicator that shows when GBP data has drifted from the optimized state
**Detection:** Automated comparison between stored "pushed" content and current GBP content on each sync.
**Phase:** Should be implemented alongside or immediately after the optimization push feature.
**Confidence:** HIGH -- Google Updates overwriting manual/API edits is a well-documented issue in the local SEO community.

## Moderate Pitfalls

### Pitfall 5: Wizard State Lost on Navigation or Refresh
**What goes wrong:** User completes 3 of 5 wizard steps, navigates away (clicks sidebar link), or browser refreshes. All wizard progress is lost. User has to start over.
**Why it happens:** Wizard state stored in React component state (useState/useReducer) is ephemeral. Next.js App Router re-mounts components on navigation. No persistence layer.
**Consequences:** Frustration, especially during onboarding when users need to gather business information (keywords, services, etc.) which may require leaving the wizard. Users abandon the wizard.
**Prevention:**
- Persist wizard state to the database after each step completion, not just on final submit
- Use URL search params (via `nuqs` or manual `useSearchParams`) to track current step -- enables back/forward navigation
- On wizard load, check for incomplete wizard state in the database and offer to resume
- Each step should save independently: Step 1 saves keywords, Step 2 saves description draft, etc.
- Do NOT use localStorage as primary storage -- it doesn't sync across devices and is unreliable
**Detection:** Track wizard abandonment rate per step. High drop-off on a specific step indicates a problem.
**Phase:** Must be designed into the wizard architecture from day one.
**Confidence:** HIGH -- standard multi-step form challenge in Next.js App Router.

### Pitfall 6: Attributes Vary by Category and Country (Not a Fixed Set)
**What goes wrong:** You hardcode a list of attributes to display in the wizard (e.g., "wheelchair accessible", "free wifi", "outdoor seating"). A plumber's GBP profile doesn't support "outdoor seating." The wizard shows irrelevant attributes, or worse, tries to push unsupported attributes and gets API errors.
**Why it happens:** Developers look at one business profile's attributes, assume they're universal, and hardcode the UI. GBP attributes are dynamic: they differ by primary category, by country, and can change at any time.
**Consequences:** Confusing UI showing irrelevant options. API errors when trying to set attributes that don't exist for that category. Wasted user time selecting attributes that can't be saved.
**Prevention:**
- ALWAYS call `attributes.list` with the profile's `categoryName` and `regionCode` to get the valid attribute set before rendering the attributes step
- Cache attribute lists per category (they don't change frequently) but invalidate cache periodically
- Build the attributes UI dynamically from the API response -- no hardcoded attribute lists
- Handle the three value types correctly: BOOL (checkbox), ENUM (single select), REPEATED_ENUM (multi-select)
- Show "No additional attributes available for this category" when the list is empty
**Detection:** API errors on `updateAttributes` calls. Monitor for "invalid attribute" error responses.
**Phase:** Attributes management step of the wizard.
**Confidence:** HIGH -- confirmed in official attributes documentation.

### Pitfall 7: Re-optimization Overwrites Manual Edits Without Warning
**What goes wrong:** User manually tweaks the AI-generated description after it's pushed to GBP (directly in Google, or via the app). Later, they hit "Re-optimize" on the profile page. The AI generates a fresh description and pushes it, overwriting their careful manual edits.
**Why it happens:** Re-optimization is designed as "start fresh with AI." Developers don't consider that the current live content may include manual refinements that should be preserved.
**Consequences:** User loses manual edits they spent time crafting. Especially painful for descriptions that were edited to include specific details AI missed.
**Prevention:**
- Before re-optimization, fetch and display the CURRENT live content from GBP
- Show a side-by-side comparison: "Current (live)" vs "AI Suggestion (new)"
- Let users pick and choose: "Keep current description, update services only"
- Include an "Edit AI suggestion" step before pushing -- never go straight from AI generation to GBP push
- Store a history of all pushed content versions for each profile field
**Detection:** Track whether users edit AI suggestions before approving (indicates AI quality issues or preservation needs).
**Phase:** Re-optimization feature, but the data model for content history should be set up during initial optimization.
**Confidence:** HIGH -- this is a predictable UX pitfall for any "regenerate" feature.

### Pitfall 8: Logo Upload Hitting Serverless/Railway Payload Limits
**What goes wrong:** User uploads a high-resolution logo (5-10MB) during onboarding. The Next.js API route on Railway has a default body size limit (typically 1-4MB). The upload fails silently or with a cryptic error.
**Why it happens:** Railway runs Next.js as a Node.js process, not edge, so you avoid edge runtime limitations. But the default `bodyParser` limit in Next.js API routes is still restrictive. Large images also consume memory during processing.
**Consequences:** Users can't complete the onboarding wizard. Error messages are unhelpful ("Request Entity Too Large" or just a failed fetch).
**Prevention:**
- Set explicit body size limits in the API route config: `export const config = { api: { bodyParser: { sizeLimit: '10mb' } } }`
- Better approach: upload directly to cloud storage (S3/GCS pre-signed URL) from the client, bypassing the server entirely
- Validate file type and size on the CLIENT before upload (show clear error messages)
- Compress/resize images client-side before upload using canvas API or a library like `browser-image-compression`
- For GBP logo upload, use the GBP Media API which may have its own requirements for dimensions and format
- Show upload progress indicator -- logos are big enough that users need feedback
**Detection:** Monitor failed uploads in error logs. Track wizard abandonment on the logo step.
**Phase:** Onboarding wizard logo step.
**Confidence:** MEDIUM -- Railway uses Node.js runtime (not edge), so limits are configurable, but the default still needs adjustment.

### Pitfall 9: Description Length Validation Mismatch
**What goes wrong:** AI generates a 900-character description. The app happily shows it in the preview. User approves. Push to GBP fails because the GBP description field has a 750-character hard limit. Or worse, the description gets truncated silently.
**Why it happens:** The AI prompt doesn't enforce the character limit, and the app doesn't validate before pushing. 750 characters is not a standard limit developers would guess.
**Consequences:** Failed API calls, frustrated users, or truncated descriptions that read poorly.
**Prevention:**
- Include explicit character limit in the AI system prompt: "Generate a business description of no more than 740 characters" (leave 10-char buffer)
- Client-side character counter in the description editor showing "XXX / 750 characters"
- Server-side validation before ANY GBP API write call
- If AI exceeds the limit, automatically re-prompt or truncate intelligently (at sentence boundary)
- Note: only the first ~250 characters are visible in search results, so front-load the most important keywords
**Detection:** Pre-push validation catches this before it reaches the API.
**Phase:** Description generation feature.
**Confidence:** HIGH -- 750-character limit confirmed across multiple sources and Google's own help documentation.

## Minor Pitfalls

### Pitfall 10: AI Keyword Suggestions Without Context Produce Generic Results
**What goes wrong:** AI suggests keywords like "plumber", "plumbing services", "plumbing repair" for every plumber. These are obvious and don't help differentiate. Users expected specific, strategic keyword suggestions.
**Why it happens:** The AI only has the business name and category. Without location context, competitor data, or search volume information, it defaults to the most obvious generic keywords.
**Prevention:**
- Feed the AI: business name, category, address/city, existing GBP description, services already listed, and target cities
- Prompt for specificity: "Suggest keywords that include geo-modifiers, specialty services, and long-tail variations, not just the obvious category terms"
- Include examples in the prompt of what GOOD keyword suggestions look like vs. BAD ones
- Let users edit/add/remove keywords before they feed into content generation
- Accept that without search volume data, these are educated guesses -- label them as "AI Suggestions" not "Recommended Keywords"
**Phase:** Keyword suggestion step of the wizard.
**Confidence:** HIGH -- inherent limitation of AI keyword generation without search data.

### Pitfall 11: Schema Migration Breaks Existing Profiles
**What goes wrong:** Adding new fields to the Profile model (keywords, targetCities, description, services, onboardingStatus) requires a database migration. If the migration has non-nullable fields without defaults, it fails on the 100+ existing profiles.
**Prevention:**
- ALL new fields on Profile must be nullable or have sensible defaults
- `keywords` should be `String[]` defaulting to `[]` (empty array), not required
- `onboardingStatus` should default to `COMPLETE` for existing profiles (they were set up manually, not through the wizard)
- `description` field should be nullable -- existing profiles may not have one stored locally
- Run migrations on a staging database first with production data volume
**Phase:** First migration when adding optimization fields to the Profile model.
**Confidence:** HIGH -- standard database migration concern with existing data.

### Pitfall 12: Structured vs. Free-Form Services Confusion
**What goes wrong:** The wizard lets users type in service names as free text. But GBP has two service types: `StructuredServiceItem` (predefined by Google for the category, identified by `serviceTypeId`) and `FreeFormServiceItem` (custom text with `categoryId` and `label`). Pushing free-form services when a structured match exists means missing out on Google's enhanced display for recognized services.
**Prevention:**
- First fetch structured services available for the profile's category via the categories API
- Show structured services as a checklist (toggle on/off) -- these are Google's predefined services
- Only offer free-form entry for services NOT in the structured list
- AI should suggest which structured services to enable, plus any custom free-form additions
- In the UI, clearly distinguish "Google-recognized services" from "Custom services"
**Phase:** Service optimization step.
**Confidence:** MEDIUM -- the structured vs. free-form distinction is documented but the UX implications require careful design.

### Pitfall 13: Keywords Not Actually Flowing Into Post Generation
**What goes wrong:** Keywords are stored on the profile during onboarding but never actually used by the existing post generation system. The post AI prompts don't reference the stored keywords, so the promised "keywords inform all content" value proposition is hollow.
**Prevention:**
- When the post generation prompt is built, include the profile's stored keywords and target cities
- Update the existing PromptTemplate system to support keyword interpolation (e.g., `{{keywords}}` placeholder)
- Verify the integration with a test: generate a post for a profile with keywords, confirm the keywords appear in the output
- This is a cross-cutting concern that bridges the new optimization feature with the existing post system
**Phase:** Must be addressed when keywords are first stored, not deferred. The integration is the whole point.
**Confidence:** HIGH -- this is the core value proposition of the milestone.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Database schema changes | New fields break existing profiles | All new fields nullable or defaulted; migration tested on staging |
| Wizard UI architecture | State lost on navigation/refresh | Persist each step to database; URL-based step tracking |
| AI keyword generation | Generic, non-strategic suggestions | Rich context in prompts; geo-modifiers; user editing |
| AI description generation | Exceeds 750-char limit | Enforce in prompt + client validation + server validation |
| Service optimization | Replacing instead of merging services | Always fetch first, merge, show diff, then push |
| Attribute management | Hardcoded attribute list fails for different categories | Dynamic attribute fetching per category via API |
| GBP write operations | Rate limit (10 edits/min/profile) hit during batch push | Consolidate writes, queue with per-profile throttling |
| Re-optimization | Overwrites manual edits | Side-by-side comparison, selective updates, version history |
| Logo upload | Payload size limits on server | Client-side resize + direct-to-cloud upload |
| Post generation integration | Keywords stored but not used | Update post prompts to reference stored keywords |
| Ongoing monitoring | Google Updates overwrite optimizations | Compare pushed vs. current state on sync, alert on drift |

## Sources

- [GBP API Usage Limits](https://developers.google.com/my-business/content/limits) -- 300 QPM default, 10 edits/min/profile hard limit (HIGH confidence)
- [locations.patch Method](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/patch) -- updateMask, validateOnly parameters (HIGH confidence)
- [GBP Services Documentation](https://developers.google.com/my-business/content/services) -- structured vs free-form, full list replacement (HIGH confidence)
- [GBP Attributes Documentation](https://developers.google.com/my-business/content/attributes) -- dynamic by category/country, value types (HIGH confidence)
- [Manage Google Updates](https://developers.google.com/my-business/content/accept-or-reject-updates) -- getGoogleUpdated, Pub/Sub notifications (HIGH confidence)
- [Work with Location Data](https://developers.google.com/my-business/content/location-data) -- updateMask format, field names (HIGH confidence)
- [GBP Description Limit](https://support.google.com/business/answer/3039617) -- 750 characters (HIGH confidence)
- [GMB Services Character Limit Discussion](https://localsearchforum.com/threads/gmb-services-character-limit-change.56072/) -- community confirmation (MEDIUM confidence)
- [Next.js File Upload Workarounds](https://www.pronextjs.dev/next-js-file-uploads-server-side-solutions) -- serverless payload limits (MEDIUM confidence)
