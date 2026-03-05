# Feature Landscape: Onboarding & Profile Optimization (v1.1)

**Domain:** GBP onboarding wizard and AI-powered profile optimization
**Researched:** 2026-03-04
**Builds on:** Existing MapsAI MVP (OAuth, posts, reviews, reports already shipped)

## Table Stakes

Features that any GBP management tool with "optimization" in its pitch must have. Without these, the onboarding flow feels like a toy.

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| Target keywords per profile | Keywords are the backbone of all GBP optimization -- descriptions, services, and posts all revolve around them | Low | Profile model (exists) | Store up to 10 keywords per profile. Feed into all AI generation. |
| Target cities/service areas | Local SEO is geo-modified keyword strategy; "plumber Denver" != "plumber Aurora" | Low | Profile model (exists) | Store up to 3 cities. Combine with keywords for geo-targeted content. |
| AI-generated business description | The 750-char GBP description is the single highest-impact optimization field | Medium | Keywords, cities, GBP API patch | Generate SEO-optimized description using profile category + keywords + cities. Approve then push via `locations.patch` with `updateMask=profile.description`. |
| AI-optimized service descriptions | Services section is underused but powerful for local SEO; each service can have a keyword-rich description | High | Keywords, categories API, GBP API patch | Must fetch available structured services per category first, then generate descriptions. Push via `updateMask=serviceItems`. Full replacement only (no individual updates). |
| Configurable post frequency | Different businesses need different cadences; a dentist needs 4/month, a restaurant might want 8/month | Low | Existing scheduling system | Store frequency on profile. Feed into existing BullMQ scheduling. |
| Re-optimization on demand | Businesses pivot, add services, change focus; optimization is not one-and-done | Low | All optimization features | "Re-optimize" button on profile page that re-runs description + services generation with current keywords. |

## Differentiators

Features that elevate MapsAI beyond "yet another GBP tool" for Vineyard Growth's workflow. Not expected, but high-value.

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| AI-suggested keywords | Zero manual keyword research; Claude analyzes business name, category, address, and existing GBP data to suggest 10 relevant keywords | Medium | Profile data (category, name, address) | Use Claude to generate keyword suggestions based on business context. No third-party keyword API needed -- the AI suggestions are "good enough" for GBP optimization (confirmed as project decision). |
| Multi-step onboarding wizard | Guided flow replaces the manual "go optimize each field" approach; ensures nothing is missed across 100-200 profiles | Medium | All optimization features | Steps: select profile -> logo -> keywords -> cities -> description -> services -> attributes -> social profiles -> post frequency. Each step saves independently. |
| Keywords feed into post generation | Keywords set during onboarding automatically inform all future AI-generated posts, creating a coherent SEO strategy | Low | Keywords stored on profile, existing post-generator | Modify `post-generator.ts` to include profile keywords and cities in the Claude prompt. Currently only uses name, category, address. |
| Approve-then-push workflow for GBP updates | AI generates content, human reviews it, only then does it push to live GBP -- prevents bad AI output from going live | Medium | GBP API write endpoints | Critical for trust. Same pattern as existing post approval flow. Store draft description/services, show diff, push on approval. |

## Anti-Features

Features to explicitly NOT build in this milestone. Each has been considered and rejected for a specific reason.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Social profile links via API | GBP API does NOT support social links programmatically (confirmed: "cannot be added via the API, bulk upload sheets, or most bulk management tools"). Building a fake version that just stores data locally without pushing to GBP is misleading. | Store social links locally for reference. Display a note that social links must be set manually in GBP dashboard. Provide direct link to GBP edit page. |
| Optimization score / completeness gauge | Explicitly out of scope per PROJECT.md. Scores create anxiety and false urgency. The wizard itself ensures completeness. | The wizard's step-by-step flow IS the completeness check. Mark steps as done/skipped. |
| Keyword search volume / difficulty data | Requires third-party API (SEMrush, Ahrefs, Google Ads API) adding cost and complexity. AI suggestions are sufficient for GBP keyword targeting. | AI-suggested keywords based on business context. If a keyword is relevant to the business, it belongs in the GBP -- volume data does not change that. |
| Auto-push without approval | Pushing AI-generated descriptions directly to live GBP profiles is too risky for a tool managing 100-200 client businesses | Always require human approval before any GBP write operation. Draft -> Review -> Approve -> Push. |
| Bulk onboarding (wizard for multiple profiles at once) | The wizard is profile-specific by nature; each business has unique keywords, services, and descriptions | Onboard profiles one at a time through the wizard. The wizard should be fast enough (5-10 minutes per profile) that bulk is unnecessary. |
| Photo/media optimization beyond logo | PROJECT.md marks this as manual. Photo AI analysis and optimization is a separate, complex domain. | Logo upload only during onboarding. All other photos managed manually in GBP. |
| GBP category management | Changing a business's primary category has major ranking implications and should be done carefully by an SEO expert, not automated | Read-only display of current category. Use category data to inform keyword suggestions and service lookups. |
| Hours of operation management | Risk of corrupting hours data across 200 profiles; hours are rarely optimized -- they are factual | Read-only display. Edit in GBP directly. |

## Feature Details

### 1. Multi-Step Onboarding Wizard

**What it does:** Guides team through optimizing a newly connected GBP profile step-by-step.

**Expected flow:**
1. **Select profile** -- pick from synced but un-onboarded profiles
2. **Logo upload** -- upload business logo via GBP Media API (category: LOGO)
3. **Keywords** -- AI suggests 10 keywords; team can edit, add, remove, reorder
4. **Target cities** -- select up to 3 cities/service areas (auto-suggest from address)
5. **Business description** -- AI generates 750-char SEO description using keywords + cities; team edits and approves; pushes to GBP
6. **Services** -- fetch available structured services for category; AI generates descriptions for each; team reviews; push entire service list to GBP
7. **Attributes** -- fetch available attributes for category; toggle relevant ones; push to GBP
8. **Social profiles** -- enter social links (stored locally only; manual GBP entry required)
9. **Post frequency** -- set weekly/monthly cadence for auto-generation

**Key UX decisions:**
- Each step saves independently (not all-or-nothing)
- Steps can be skipped and revisited
- Progress persists across sessions
- Wizard state stored in database, not just client-side

### 2. AI Keyword Suggestions

**What it does:** Claude analyzes business name, category, address, and website to suggest 10 relevant target keywords.

**How it works:**
- Input: profile name, category, address, website URL (all from existing profile data)
- AI prompt: "Suggest 10 target keywords for this local business that would help it rank in Google Maps and local search results"
- Output: ranked list of keywords with brief rationale
- Team can accept, reject, edit, or add their own
- Keywords stored as JSON array on profile

**GBP description optimization context:**
- First 250 characters are visible in search results -- front-load primary keywords and location
- Full description is 750 characters max
- Structure: who you are + what you do + where you do it
- Natural keyword inclusion, not stuffing
- No URLs, HTML, or promotional content allowed by Google

### 3. Business Description Generation

**What it does:** AI generates a 750-character SEO-optimized business description using the profile's keywords and target cities.

**GBP API integration:**
- Read current: `GET locations/{id}?readMask=profile` (the `profile.description` field)
- Write: `PATCH locations/{id}?updateMask=profile.description`
- Auth scope: `https://www.googleapis.com/auth/business.manage`

**AI generation rules:**
- Max 750 characters (hard limit)
- Front-load primary keyword + primary city in first 250 characters
- Include business name, category, key services
- Weave in target keywords naturally
- End with a call to action or unique value proposition
- No URLs, HTML, prices, or promotional language (Google policy)

### 4. Service Descriptions Optimization

**What it does:** Fetches available services for the business's GBP category, lets team select which are offered, and generates keyword-rich descriptions for each.

**GBP API integration:**
- Discover available services: `GET /v1/categories?regionCode=US&languageCode=en&filter=displayname={categoryName}&view=FULL`
- Read current: `GET locations/{id}?readMask=serviceItems`
- Write: `PATCH locations/{id}?updateMask=serviceItems`
- CRITICAL: Must send entire `serviceItems` array on update (no individual service updates)
- Check `canModifyServiceList` metadata before attempting writes

**Service item types:**
- `structuredServiceItem`: uses Google's predefined `serviceTypeId` (preferred -- better for SEO)
- `freeFormServiceItem`: custom service with `categoryId` and display name (for services not in Google's list)

**AI generation approach:**
- For each selected service, generate a concise description incorporating relevant keywords
- Descriptions should be specific to the business, not generic
- Include target city names where natural

### 5. GBP Attributes Management

**What it does:** Fetches available attributes for the business's category and lets team toggle them on/off.

**GBP API integration:**
- List available: `GET /v1/attributes?categoryName={gcid}&regionCode=US&languageCode=en` or `parent=locations/{id}`
- Read current: `GET locations/{id}?readMask=attributes`
- Write: `PATCH /v1/locations/{id}?attributeMask={attribute_names}`

**Attribute value types:**
- `BOOL`: simple on/off (e.g., wheelchair accessible, has WiFi)
- `ENUM`: single selection (e.g., WiFi type: free vs paid)
- `REPEATED_ENUM`: multi-select (e.g., payment types accepted)
- `URL`: link values (e.g., menu URL, order URL)

**UX approach:**
- Group attributes by heading (Google provides grouping metadata)
- Show only attributes relevant to the business's category
- Pre-populate with current values from GBP
- Toggle/select interface per value type

### 6. Logo Upload

**What it does:** Upload business logo during onboarding via the GBP Media API.

**GBP API integration:**
- Still uses v4 API: `POST accounts/{accountId}/locations/{locationId}/media`
- Two upload methods: from URL (`sourceUrl` param) or from bytes (3-step process)
- Set `mediaFormat: PHOTO` and category: `LOGO`
- Requirements: JPG or PNG, 10 KB - 5 MB, recommended 1080x1080px

**Simpler approach:** Accept file upload in wizard, upload to GBP via URL method (store temporarily, send URL to Google). Avoid the byte-upload complexity unless URL method fails.

### 7. Post Frequency Configuration

**What it does:** Set how many posts per month should be auto-generated for each profile.

**Integration with existing system:**
- Store `postFrequency` on Profile model (e.g., 4, 8, 12 posts/month)
- Existing BullMQ scheduling reads this value when queuing next generation batch
- Default: 4 posts/month (1/week)

## Feature Dependencies

```
Profile sync (exists) -> Onboarding wizard entry point
                      |
                      v
              Keywords + Cities (step 2-3)
                      |
          +-----------+-----------+
          |           |           |
          v           v           v
    Description   Services   Post generation
    generation    optimization  (existing, enhanced)
          |           |
          v           v
    Approve+Push  Approve+Push
    to GBP        to GBP

Attributes management -- independent (no keyword dependency)
Logo upload -- independent
Social profiles -- independent (local storage only)
Post frequency -- independent (config change)
```

**Critical path:** Keywords -> Description -> Services (this ordering matters because descriptions and services both consume keywords)

**Independent features:** Attributes, logo, social profiles, and post frequency can be built in any order and do not depend on the keyword/description/services chain.

## Complexity Assessment

| Feature | Complexity | Rationale |
|---------|------------|-----------|
| Keywords + cities storage | Low | New fields on Profile model, simple CRUD UI |
| AI keyword suggestions | Medium | New Claude prompt, structured output parsing, editable list UI |
| AI description generation | Medium | Claude prompt with constraints (750 char, keyword inclusion), GBP API write, approval UI |
| AI service optimization | High | Category-based service discovery API call, structured vs freeform service types, full-array replacement requirement, per-service AI generation, bulk approval UI |
| GBP attributes management | Medium | Dynamic attribute fetching per category, 4 different value types to render, grouped UI |
| Logo upload | Medium | File upload handling, GBP Media API (still v4), image validation |
| Social profiles | Low | Local-only storage, simple form with platform dropdown + URL input |
| Post frequency | Low | Single field on profile, dropdown selector |
| Onboarding wizard shell | Medium | Multi-step form state management, progress tracking, skip/revisit logic, persistence |
| Re-optimization | Low | Re-invoke existing generation functions with current keywords |
| Keywords in post generation | Low | Modify existing prompt template to include keywords array |

## MVP Recommendation for v1.1

**Priority 1 -- Core optimization pipeline (build first):**
1. Keywords + cities on Profile model (foundation for everything)
2. AI keyword suggestions (makes the wizard valuable immediately)
3. AI business description generation + approve + push to GBP (highest-impact single optimization)
4. Keywords integrated into existing post generation (immediate ROI from keywords)

**Priority 2 -- Full wizard experience:**
5. AI service descriptions + approve + push to GBP (high complexity, high value)
6. Onboarding wizard shell wrapping all steps
7. Post frequency configuration
8. Re-optimization from profile page

**Priority 3 -- Nice-to-have completeness:**
9. GBP attributes management
10. Logo upload
11. Social profiles (local storage only)

**Rationale:** The keyword + description pipeline is the highest-value, lowest-risk path. Services optimization is highest complexity due to the category-based service discovery and full-array replacement requirement. Attributes, logo, and social profiles add completeness but don't drive core SEO value.

## Sources

- [GBP Business Information API - locations.patch](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/patch) (HIGH confidence)
- [GBP API - Add Services](https://developers.google.com/my-business/content/services) (HIGH confidence)
- [GBP API - Add Attributes](https://developers.google.com/my-business/content/attributes) (HIGH confidence)
- [GBP API - Upload Media](https://developers.google.com/my-business/content/upload-photos) (HIGH confidence)
- [GBP API - Work with Location Data](https://developers.google.com/my-business/content/location-data) (HIGH confidence)
- [Social links not available via API](https://gmbapi.com/news/add-social-media-links-to-google-business-profile/) (HIGH confidence)
- [GBP Description Best Practices - BrightLocal](https://www.brightlocal.com/learn/google-business-profile-description/) (MEDIUM confidence)
- [GBP Services Optimization - OllyOlly](https://www.ollyolly.com/tutorials/how-to-optimize-google-business-profile-services/) (MEDIUM confidence)
- [GBP Attributes Guide 2026](https://daltonluka.com/blog/google-my-business-attributes) (MEDIUM confidence)
- [Google Support - Social Media Links](https://support.google.com/business/answer/13580646?hl=en) (HIGH confidence)
