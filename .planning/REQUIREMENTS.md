# Requirements: MapsAI

**Defined:** 2026-03-04
**Core Value:** Every client's GBP is fully managed end-to-end -- from initial optimization through ongoing posts, reviews, and reporting.

## v1.1 Requirements

Requirements for Milestone v1.1: Onboarding & Optimization. Each maps to roadmap phases.

### Onboarding Wizard

- [x] **ONBRD-01**: User can start onboarding wizard from an "Add Business" button and select from synced un-onboarded profiles
- [x] **ONBRD-02**: Wizard displays step indicator with progress and supports navigation between completed steps
- [x] **ONBRD-03**: Wizard state persists to database so user can resume across sessions
- [x] **ONBRD-04**: User can review a summary of all optimizations and mark onboarding complete

### Keywords & Cities

- [x] **KWRD-01**: User can generate AI-suggested keywords (up to 10) based on business name, category, address, and existing GBP data
- [x] **KWRD-02**: User can edit, add, remove, and reorder AI-suggested keywords before saving
- [x] **KWRD-03**: User can set up to 3 target cities/service areas per profile
- [x] **KWRD-04**: Stored keywords and cities are injected into post generation prompts for all future AI-generated posts

### Description Optimization

- [x] **DESC-01**: User can generate an AI SEO-optimized business description (max 750 chars) using stored keywords and cities
- [x] **DESC-02**: User can review, edit, and approve the AI-generated description before it pushes to GBP
- [x] **DESC-03**: Approved description is pushed to live GBP via API with success/failure feedback

### Service Optimization

- [x] **SRVC-01**: System fetches available structured services for the profile's GBP category
- [x] **SRVC-02**: User can generate AI-optimized descriptions for each service incorporating target keywords
- [x] **SRVC-03**: User can approve service descriptions individually or in bulk before pushing to GBP
- [x] **SRVC-04**: Services push uses fetch-then-merge to preserve existing services not being optimized

### Attributes

- [x] **ATTR-01**: System fetches available attributes dynamically based on business category (not hardcoded)
- [x] **ATTR-02**: User can view and toggle attribute values (boolean, enum, repeated enum, URL types)
- [x] **ATTR-03**: Updated attributes are pushed to GBP via API

### Profile Settings

- [x] **PROF-01**: User can configure post frequency per profile (posts per month)
- [x] **PROF-02**: Post frequency setting is used by the existing scheduling system when generating posts

### Re-optimization

- [x] **REOPT-01**: User can re-run description and service optimization from the profile detail page
- [x] **REOPT-02**: Re-optimization shows current live GBP content alongside the new AI suggestion for comparison

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Media Management

- **MEDIA-01**: User can upload business logo during onboarding and push to GBP via Media API
- **MEDIA-02**: User can manage cover photos and additional media

### Social Links

- **SOCL-01**: User can store social profile links locally for reference
- **SOCL-02**: System displays note that social links must be set manually in GBP (API limitation)

### Drift Detection

- **DRIFT-01**: System detects when Google auto-overwrites API-pushed optimizations
- **DRIFT-02**: Dashboard alerts when GBP content has drifted from the optimized state

## Out of Scope

| Feature | Reason |
|---------|--------|
| Keyword search volume/difficulty data | Requires third-party API (SEMrush, Ahrefs); AI suggestions are sufficient |
| Optimization score/gauge | Wizard step-by-step flow is sufficient; scores create false urgency |
| Bulk onboarding (multiple profiles at once) | Each profile needs unique keywords/services; one-at-a-time is appropriate |
| Auto-push without approval | Too risky for 100-200 client profiles; draft-first pattern required |
| GBP category management | Changing primary category has major ranking implications; manual only |
| Hours of operation management | Risk of corrupting hours across 200 profiles; factual data, not optimizable |
| Photo/media optimization beyond logo | Complex domain; manual for now |
| Social links via API | GBP API does not support social link writes as of March 2026 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ONBRD-01 | Phase 8 | Complete |
| ONBRD-02 | Phase 8 | Complete |
| ONBRD-03 | Phase 8 | Complete |
| ONBRD-04 | Phase 12 | Complete |
| KWRD-01 | Phase 9 | Complete |
| KWRD-02 | Phase 9 | Complete |
| KWRD-03 | Phase 9 | Complete |
| KWRD-04 | Phase 9 | Complete |
| DESC-01 | Phase 10 | Complete |
| DESC-02 | Phase 10 | Complete |
| DESC-03 | Phase 10 | Complete |
| SRVC-01 | Phase 11 | Complete |
| SRVC-02 | Phase 11 | Complete |
| SRVC-03 | Phase 11 | Complete |
| SRVC-04 | Phase 11 | Complete |
| ATTR-01 | Phase 12 | Complete |
| ATTR-02 | Phase 12 | Complete |
| ATTR-03 | Phase 12 | Complete |
| PROF-01 | Phase 12 | Complete |
| PROF-02 | Phase 12 | Complete |
| REOPT-01 | Phase 13 | Complete |
| REOPT-02 | Phase 13 | Complete |

**Coverage:**
- v1.1 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0

---
*Requirements defined: 2026-03-04*
*Last updated: 2026-03-04 after roadmap creation*
