# Research Summary: MapsAI v1.1 -- Onboarding & Profile Optimization

**Synthesized:** 2026-03-04
**Research files:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md

## Executive Summary

MapsAI v1.1 adds a guided onboarding wizard and AI-powered GBP profile optimization to an existing, shipping Next.js application that already handles OAuth, posts, reviews, and reports. The core value proposition is a keyword-driven optimization pipeline: AI suggests target keywords, those keywords feed into SEO-optimized business descriptions and service descriptions, and all content follows a draft-approve-push workflow before touching live Google profiles. The existing stack (Next.js 16, Prisma, BullMQ, Anthropic SDK, googleapis) handles every requirement with only one new dependency: `sharp` for server-side image resizing during logo upload.

The recommended approach is to build the keyword foundation first (storage + AI generation), then layer description and service optimization on top, since both consume keywords. The wizard shell wraps these features into a step-by-step flow that persists progress to the database. GBP write operations use the same `googleapis` client already in the codebase -- `mybusinessbusinessinformation` v1 for descriptions, services, and attributes; My Business v4 for media uploads. All writes are direct API calls (not queued via BullMQ) since the user is waiting for confirmation during onboarding.

The primary risks are: (1) the GBP service update API replaces the entire service list, meaning a careless push can delete existing services; (2) a hard 10-edits-per-minute-per-profile rate limit that cannot be increased; (3) Google's own automated systems overwriting API-pushed optimizations without notice. All three are well-documented and have clear mitigations: always fetch-merge-push for services, consolidate writes and space API calls, and implement drift detection by comparing pushed content against synced content.

## Key Findings

### From STACK.md

- **Zero new npm packages required** for core functionality. The existing `googleapis`, `@anthropic-ai/sdk`, Zod, and Next.js native `Request.formData()` cover all needs.
- **One recommended addition: `sharp` (^0.33.x)** for resizing logos to GBP's 720x720px requirement. Already a transitive dependency of Next.js.
- **GBP write operations** use the same `mybusinessbusinessinformation` v1 client already used for reads. `locations.patch` with `updateMask` handles descriptions, services, and profile fields.
- **Media upload** still uses GBP v4 API (not deprecated). Two methods: URL-based (simpler) or byte-upload (3-step process).
- **Social profile links are NOT writable via the GBP API.** Store locally only, with a clear UI note directing users to the GBP dashboard.
- **No form library needed.** The wizard has 2-5 fields per step; `useState` + Zod is sufficient.

### From FEATURES.md

**Table stakes (must build):**
- Target keywords and cities per profile (foundation for all optimization)
- AI-generated business description (750 chars, highest-impact single field)
- AI-optimized service descriptions (high complexity due to full-list replacement)
- Configurable post frequency
- Re-optimization on demand

**Differentiators (should build):**
- AI-suggested keywords (zero manual research needed)
- Multi-step onboarding wizard (guided flow for 100-200 profiles)
- Keywords feeding into post generation (coherent SEO strategy)
- Approve-then-push workflow (trust and safety)

**Anti-features (do NOT build):**
- Social links via API (not possible)
- Optimization score/completeness gauge (out of scope)
- Keyword volume/difficulty data (deferred; adds cost without proportional value)
- Auto-push without approval (too risky for 200 client profiles)
- Bulk onboarding (wizard is inherently per-profile)
- Photo optimization beyond logo, category management, hours management

**Critical path:** Keywords -> Description -> Services. Independent features (attributes, logo, social profiles, post frequency) can be built in any order.

### From ARCHITECTURE.md

- **Data flow:** Wizard UI -> API Route -> AI Generator -> Draft Record (DB) -> User Approves -> GBP API Wrapper -> Google (push live). Mirrors existing post/review pattern.
- **5 new Prisma models:** ProfileKeyword, ProfileCity, ProfileDescription, ProfileService, OnboardingProgress. Plus new fields on Profile.
- **8 new API routes** under `/api/onboarding/` (keywords, cities, description, services, attributes, logo, progress, settings).
- **3 new lib modules** for AI generation (keyword-generator, description-generator, service-generator).
- **3 new GBP wrapper modules** (google-business-info, google-attributes, google-media).
- **Wizard state:** Client-side React state with DB persistence at step boundaries. No URL-based step routing, no Redux/Zustand.
- **Direct GBP calls** for onboarding pushes (not BullMQ). User is waiting; onboarding is one-time, not scheduled.
- **Key anti-patterns to avoid:** Wizard state in URL params, monolithic onboarding API route, pushing without approval, caching attributes locally, BullMQ for onboarding writes, partial service replacement.

### From PITFALLS.md

**Critical (must address immediately):**
1. **Service updates replace entire list** -- always fetch, merge, show diff, then push. Store pre-update snapshot for rollback.
2. **10 edits/min/profile hard limit** -- consolidate writes into fewer API calls, space sequential calls with delays.
3. **No approval before GBP push** -- enforce draft-approve-push for all AI-generated content.
4. **Google Updates overwrite optimizations** -- store expected state, compare on sync, alert on drift.

**Moderate (design for from start):**
5. Wizard state lost on navigation -- persist to DB per step, not just on final submit.
6. Attributes vary by category/country -- always fetch dynamically, never hardcode.
7. Re-optimization overwrites manual edits -- show side-by-side comparison, selective updates.
8. Logo upload hitting payload limits -- client-side validation + resize, configure server limits.
9. Description length exceeds 750 chars -- enforce in AI prompt, client counter, server validation.

**Minor (address during implementation):**
10. Generic AI keyword suggestions -- feed rich context (address, category, existing data).
11. Schema migration breaks existing profiles -- all new fields nullable or defaulted.
12. Structured vs. free-form service confusion -- show structured as checklist, free-form for custom.
13. Keywords not flowing into post generation -- update prompts immediately, not as afterthought.

## Implications for Roadmap

### Suggested Phase Structure

**Phase 1: Data Foundation**
- Prisma schema additions (5 new models + Profile field extensions)
- Database migration (all fields nullable/defaulted for existing profiles)
- OnboardingProgress API + wizard shell UI (step indicator, navigation, progress persistence)
- Delivers: the skeleton that everything else plugs into
- Features: OnboardingProgress model, wizard shell component
- Pitfalls to avoid: Schema migration breaking existing profiles (Pitfall 11); wizard state loss (Pitfall 5)
- Rationale: Every subsequent phase depends on these models and the wizard framework existing

**Phase 2: Keyword Pipeline**
- Keyword generator (AI) + keywords API route + step UI
- Cities API route + step UI
- Integrate keywords/cities into existing post generation prompts
- Delivers: the foundational data that description, services, and posts all consume
- Features: AI keyword suggestions, target cities, keywords in post generation
- Pitfalls to avoid: Generic keyword suggestions (Pitfall 10); keywords not flowing into posts (Pitfall 13)
- Rationale: Keywords are the dependency for description and service generation. Building this first means you can test the AI pipeline end-to-end before tackling GBP writes.

**Phase 3: Description Optimization + GBP Writes**
- Description generator (AI) + description API route + step UI
- `google-business-info.ts` wrapper (locations.patch for descriptions)
- Approve-then-push workflow with confirmation dialog
- Drift detection: store pushed content, compare on sync
- Delivers: the highest-impact single optimization (GBP description is the most visible field)
- Features: AI description generation, approve-and-push workflow, GBP write capability
- Pitfalls to avoid: Description length validation (Pitfall 9); pushing without approval (Pitfall 3); Google Updates overwriting (Pitfall 4); rate limiting (Pitfall 2)
- Rationale: Description is highest-impact, medium-complexity. Proves the full write pipeline (AI generate -> approve -> push -> verify) before tackling the harder services step.

**Phase 4: Service Optimization**
- Service generator (AI) + services API route + step UI
- Structured vs. free-form service handling
- Fetch-merge-push workflow with diff view
- Pre-update snapshot storage for rollback
- Delivers: the second-highest-impact optimization, completing the core SEO pipeline
- Features: AI service descriptions, structured service discovery, service merge workflow
- Pitfalls to avoid: Service list replacement (Pitfall 1 -- the most critical pitfall); structured vs. free-form confusion (Pitfall 12); rate limiting (Pitfall 2)
- Rationale: Highest complexity feature. By this phase, the GBP write pipeline is proven from Phase 3. The merge-and-diff pattern is unique to services and needs careful implementation.

**Phase 5: Attributes, Logo, Settings**
- `google-attributes.ts` wrapper + attributes step UI (dynamic per category)
- `google-media.ts` wrapper + logo upload step (with sharp resize)
- Settings step (post frequency, social links note)
- Review/complete step + mark onboardingCompletedAt
- Delivers: wizard completeness, all GBP-writable fields covered
- Features: Attribute management, logo upload, post frequency config, social profiles (local only)
- Pitfalls to avoid: Hardcoded attributes (Pitfall 6); logo payload limits (Pitfall 8)
- Rationale: These are independent features that don't depend on the keyword pipeline. Lower SEO impact but needed for a complete onboarding experience.

**Phase 6: Re-optimization + Polish**
- Re-optimization button on profile detail page
- Side-by-side comparison (current live vs. AI suggestion)
- Selective re-optimization (description only, services only, etc.)
- Content version history
- Dashboard indicators for onboarding status
- Delivers: ongoing optimization capability beyond initial onboarding
- Features: Re-optimization on demand, content versioning
- Pitfalls to avoid: Overwriting manual edits (Pitfall 7)
- Rationale: Re-optimization reuses all API routes and generators from earlier phases. It is a UX layer on top of existing capabilities.

### Research Flags

**Needs `/gsd:research-phase` during planning:**
- Phase 3 (Description + GBP Writes): Rate limiting strategy and drift detection need detailed design. The 10-edits/min constraint affects how writes are sequenced.
- Phase 4 (Service Optimization): The fetch-merge-push workflow, structured vs. free-form handling, and rollback capability are complex enough to warrant phase-level research.

**Standard patterns (skip research):**
- Phase 1 (Data Foundation): Standard Prisma migration + React wizard shell. Well-documented patterns.
- Phase 2 (Keyword Pipeline): Standard AI prompt engineering + CRUD. Follows existing post-generator pattern.
- Phase 5 (Attributes, Logo, Settings): Straightforward API integration + file upload. Documented patterns.
- Phase 6 (Re-optimization): Reuses existing infrastructure. UX design decisions, not technical unknowns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies for core features. googleapis client already in use. Only addition is sharp (near-zero risk). |
| Features | HIGH | Feature set well-scoped with clear table stakes vs. differentiators. Anti-features explicitly identified with rationale. Critical path (keywords -> description -> services) is clear. |
| Architecture | HIGH | Extends proven patterns already in the codebase (draft-first, API route per resource, structured AI output with Zod). Data model is detailed and follows existing conventions. |
| Pitfalls | HIGH | All 13 pitfalls sourced from official Google documentation or well-known patterns. The critical pitfalls (service replacement, rate limits, approval workflow, drift detection) have concrete prevention strategies. |

### Gaps to Address During Planning

1. **GBP v4 Media API longevity** -- v4 media endpoints are "still active" but Google has been deprecating v4 piecemeal. No deprecation date announced for media, but worth monitoring. Fallback plan: direct HTTP upload using the v1 media endpoint if/when it becomes available.

2. **Social links API availability** -- confirmed unavailable now, but Google could add it. The architecture correctly stores links locally and surfaces a manual-edit note. Re-check periodically.

3. **Service description character limits** -- the GBP service description max length is not as clearly documented as the 750-char business description limit. Community sources suggest ~300 characters. Needs validation during Phase 4 implementation.

4. **Logo upload method preference** -- URL-based upload is simpler but requires temporarily hosting the image at a public URL. Byte upload is more complex but avoids the hosting step. The architecture suggests trying URL method first -- this decision should be validated during Phase 5.

5. **Google Updates Pub/Sub** -- mentioned as an option for real-time drift detection, but integration complexity is unknown. Start with sync-time comparison; evaluate Pub/Sub as a future enhancement.

## Sources

Aggregated from research files (duplicates removed):

**Official Google Documentation (HIGH confidence):**
- [GBP API locations.patch](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/patch)
- [GBP API attributes guide](https://developers.google.com/my-business/content/attributes)
- [GBP API services guide](https://developers.google.com/my-business/content/services)
- [GBP API media upload guide](https://developers.google.com/my-business/content/upload-photos)
- [GBP API usage limits](https://developers.google.com/my-business/content/limits)
- [GBP API deprecation schedule](https://developers.google.com/my-business/content/sunset-dates)
- [GBP location data guide](https://developers.google.com/my-business/content/location-data)
- [GBP description limit](https://support.google.com/business/answer/3039617)
- [Google Updates management](https://developers.google.com/my-business/content/accept-or-reject-updates)
- [Google Support - Social Media Links](https://support.google.com/business/answer/13580646?hl=en)
- [googleapis Node.js client](https://googleapis.dev/nodejs/googleapis/latest/mybusinessbusinessinformation/classes/Mybusinessbusinessinformation.html)

**Industry Sources (MEDIUM confidence):**
- [BrightLocal GBP Description Best Practices](https://www.brightlocal.com/learn/google-business-profile-description/)
- [OllyOlly GBP Services Optimization](https://www.ollyolly.com/tutorials/how-to-optimize-google-business-profile-services/)
- [GBP Attributes Guide 2026](https://daltonluka.com/blog/google-my-business-attributes)
- [Social links not available via API](https://gmbapi.com/news/add-social-media-links-to-google-business-profile/)
- [Next.js file upload patterns](https://www.pronextjs.dev/next-js-file-uploads-server-side-solutions)
- [GMB Services Character Limit Discussion](https://localsearchforum.com/threads/gmb-services-character-limit-change.56072/)
