# MapsAI -- Roadmap

## Milestone v1.1: Onboarding & Optimization

**Phases:** 6 (Phase 8-13, continuing from Milestone 1)
**Requirements:** 22 v1.1 requirements
**Coverage:** 22/22 mapped

## Phases

- [ ] **Phase 8: Wizard Shell & Data Foundation** - Onboarding wizard skeleton with step navigation, progress persistence, and database schema for all optimization data
- [ ] **Phase 9: Keywords & Cities** - AI keyword suggestions, target city configuration, and keyword injection into post generation
- [x] **Phase 10: Description Optimization** - AI-generated SEO business descriptions with approve-then-push to GBP (completed 2026-03-05)
- [ ] **Phase 11: Service Optimization** - AI-optimized service descriptions with category-based discovery and fetch-merge-push workflow
- [ ] **Phase 12: Attributes & Profile Settings** - GBP attribute management, post frequency configuration, and wizard completion step
- [ ] **Phase 13: Re-optimization** - On-demand re-optimization from profile detail page with live-vs-suggested comparison

## Phase Details

### Phase 8: Wizard Shell & Data Foundation
**Goal**: User can start onboarding a profile and navigate through a multi-step wizard that remembers progress across sessions
**Depends on**: Nothing (first phase of milestone)
**Requirements**: ONBRD-01, ONBRD-02, ONBRD-03
**Success Criteria** (what must be TRUE):
  1. User can click "Add Business" and see a list of synced profiles that have not been onboarded
  2. User sees a step indicator showing which step they are on and which steps are complete
  3. User can navigate back to completed steps without losing data
  4. User can close the browser, return later, and resume the wizard from where they left off
**Plans:** 2 plans
Plans:
- [ ] 08-01-PLAN.md -- Database schema (5 new Prisma models) + onboarding progress API + un-onboarded profiles API
- [ ] 08-02-PLAN.md -- Wizard shell UI with step indicator, navigation, and progress persistence

### Phase 9: Keywords & Cities
**Goal**: User can configure target keywords and cities for a profile, and those keywords automatically improve all future AI-generated content
**Depends on**: Phase 8
**Requirements**: KWRD-01, KWRD-02, KWRD-03, KWRD-04
**Success Criteria** (what must be TRUE):
  1. User can generate AI keyword suggestions and see relevant, specific keywords based on the business's name, category, and location
  2. User can edit, add, remove, and reorder keywords before saving (up to 10)
  3. User can set up to 3 target cities or service areas for the profile
  4. After saving keywords and cities, newly generated posts for that profile incorporate those keywords naturally
**Plans:** 2 plans
Plans:
- [ ] 09-01-PLAN.md -- Backend: AI keyword generator, keywords/cities CRUD APIs, post generator integration
- [ ] 09-02-PLAN.md -- Frontend: Keywords & Cities wizard step UI + wizard shell wiring

### Phase 10: Description Optimization
**Goal**: User can generate an SEO-optimized business description and push it live to Google Business Profile
**Depends on**: Phase 9 (keywords feed into description generation)
**Requirements**: DESC-01, DESC-02, DESC-03
**Success Criteria** (what must be TRUE):
  1. User can generate an AI business description that incorporates their stored keywords and cities (max 750 characters)
  2. User can review, edit, and approve the description before anything touches the live GBP
  3. After approval, the description is pushed to the live GBP and user sees clear success or failure feedback
**Plans:** 2/2 plans complete
Plans:
- [ ] 10-01-PLAN.md -- Backend: AI description generator, GBP business info read/write, description CRUD + generate + push APIs
- [ ] 10-02-PLAN.md -- Frontend: Description wizard step UI + wizard shell wiring

### Phase 11: Service Optimization
**Goal**: User can discover available services for their business category and push AI-optimized service descriptions to GBP without losing existing services
**Depends on**: Phase 10 (GBP write pipeline proven)
**Requirements**: SRVC-01, SRVC-02, SRVC-03, SRVC-04
**Success Criteria** (what must be TRUE):
  1. User sees structured services available for their business category fetched from GBP (not hardcoded)
  2. User can generate AI-optimized descriptions for selected services that incorporate target keywords
  3. User can approve service descriptions individually or in bulk before pushing
  4. After pushing, existing services that were not being optimized are still present on the live GBP (no data loss)
**Plans:** 2 plans
Plans:
- [ ] 11-01-PLAN.md -- Backend: AI batch service generator, GBP service read/write (fetch-merge-push), service CRUD + generate + push APIs
- [ ] 11-02-PLAN.md -- Frontend: Services wizard step UI with card-based approve/push + wizard shell wiring

### Phase 12: Attributes & Profile Settings
**Goal**: User can manage GBP attributes, configure post frequency, and complete the onboarding wizard
**Depends on**: Phase 8 (wizard shell)
**Requirements**: ATTR-01, ATTR-02, ATTR-03, PROF-01, PROF-02, ONBRD-04
**Success Criteria** (what must be TRUE):
  1. User sees available attributes for their business category (fetched dynamically, not hardcoded) and can toggle values
  2. Updated attributes are pushed to GBP with success/failure feedback
  3. User can set a post frequency (posts per month) and the scheduling system uses it for future post generation
  4. User can review a summary of all optimizations made and mark onboarding complete
**Plans**: TBD

### Phase 13: Re-optimization
**Goal**: User can re-run optimization for any previously onboarded profile and compare new suggestions against what is currently live
**Depends on**: Phase 10, Phase 11 (description and service optimization must exist to re-run them)
**Requirements**: REOPT-01, REOPT-02
**Success Criteria** (what must be TRUE):
  1. User can trigger re-optimization of description and/or services from the profile detail page
  2. User sees current live GBP content side-by-side with the new AI suggestion before deciding to approve
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 8. Wizard Shell & Data Foundation | 2/2 | Complete | 2026-03-05 |
| 9. Keywords & Cities | 0/2 | Planned | - |
| 10. Description Optimization | 2/2 | Complete   | 2026-03-05 |
| 11. Service Optimization | 2/2 | Complete | 2026-03-05 |
| 12. Attributes & Profile Settings | 0/? | Not started | - |
| 13. Re-optimization | 0/? | Not started | - |

## Coverage Map

```
ONBRD-01 -> Phase 8
ONBRD-02 -> Phase 8
ONBRD-03 -> Phase 8
ONBRD-04 -> Phase 12
KWRD-01  -> Phase 9
KWRD-02  -> Phase 9
KWRD-03  -> Phase 9
KWRD-04  -> Phase 9
DESC-01  -> Phase 10
DESC-02  -> Phase 10
DESC-03  -> Phase 10
SRVC-01  -> Phase 11
SRVC-02  -> Phase 11
SRVC-03  -> Phase 11
SRVC-04  -> Phase 11
ATTR-01  -> Phase 12
ATTR-02  -> Phase 12
ATTR-03  -> Phase 12
PROF-01  -> Phase 12
PROF-02  -> Phase 12
REOPT-01 -> Phase 13
REOPT-02 -> Phase 13

Mapped: 22/22
Orphaned: 0
```

## Research Flags

Phases that may benefit from `/gsd:research-phase` before planning:

- **Phase 10** (Description Optimization): Rate limiting strategy (10 edits/min/profile), GBP write error handling, drift detection design
- **Phase 11** (Service Optimization): Fetch-merge-push workflow, structured vs. free-form service handling, rollback capability, GBP service API field formats

Phases with standard patterns (skip research):
- **Phase 8**: Standard Prisma migration + React wizard shell
- **Phase 9**: Standard AI prompt engineering + CRUD, follows existing post-generator pattern
- **Phase 12**: Straightforward API integration, follows patterns from Phase 10-11
- **Phase 13**: Reuses existing infrastructure, UX layer only

## Dependency Graph

```
Phase 8 (Wizard Shell)
  |
  v
Phase 9 (Keywords & Cities)
  |
  v
Phase 10 (Description Optimization)
  |
  v
Phase 11 (Service Optimization)

Phase 8 ---------> Phase 12 (Attributes & Settings)

Phase 10 + 11 ---> Phase 13 (Re-optimization)
```

Note: Phase 12 depends only on Phase 8 (the wizard shell) and can run in parallel with Phases 9-11. However, sequential execution is recommended since this is a solo developer workflow.

---
*Roadmap created: 2026-03-04*
*Milestone: v1.1 Onboarding & Optimization*
*Phases 1-7 were Milestone 1 (MVP) -- completed*
