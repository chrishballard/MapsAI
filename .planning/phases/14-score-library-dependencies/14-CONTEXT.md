# Phase 14: Score Library & Dependencies - Context

**Gathered:** 2026-04-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a pure optimization score function (`src/lib/optimization-score.ts`), install chart/QR browser dependencies (recharts, qrcode.react, shadcn chart), add missing composite DB indexes, and validate the setup with a smoke test. No user-facing UI — this is a foundational enabler for Phases 15-19.

</domain>

<decisions>
## Implementation Decisions

### Score Signal Weights
- **D-01:** Equal weighting across all active signals. 5 active signals at 20 points each = 100 total.
- **D-02:** Active signals: review frequency, post frequency, rating, description completeness, services completeness.
- **D-03:** Skip images signal — no photo data in DB. Defer to future phase when photo tracking is built.
- **D-04:** Skip attributes signal — no ProfileAttribute model in DB, attributes were pushed directly to GBP in v1.1. Defer to future phase if attribute tracking is added.
- **D-05:** Score thresholds: green >= 70, amber 40-69, red < 40 (from ROADMAP.md).

### Score Function Input Shape
- **D-06:** Accept full Prisma Profile type with relations included (reviews, posts, descriptions, services, cities, keywords). Callers do one Prisma query with includes.
- **D-07:** Return type: `{ total: number, grade: string, checks: Check[] }` where each Check has signal name, score, max, status, and recommendation.
- **D-08:** Fixed 30-day rolling window for time-based signals (post frequency, review frequency). Function filters internally — caller just passes full data.

### Chart Dependency Strategy
- **D-09:** Dual-library approach: keep chart.js for existing PDF reports (server-side), add recharts for all new browser UI charts (Phases 17-19).
- **D-10:** Install recharts, qrcode.react, and run `npx shadcn@latest add chart` for shadcn chart primitives.
- **D-11:** Validate with minimal smoke test — dev-only test page with one recharts chart and one QR code, verify `next build` succeeds without hydration errors.

### Claude's Discretion
- Exact benchmarks per signal (e.g., what post frequency counts as "good" vs "warning" vs "critical")
- Check[] item structure details (fields, status enum values)
- Which Prisma includes are required for the score function's type
- Test page route structure and cleanup approach

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Schema & Models
- `prisma/schema.prisma` — Profile model (line 44), DailyMetric (line 162), ProfileDescription (line 239), ProfileService (line 251). Check existing indexes and add missing ones.

### Existing Libraries
- `package.json` — Current deps include chart.js, chartjs-node-canvas (PDF), @react-pdf/renderer. Do not remove these.
- `components.json` — shadcn config (base-nova style, RSC enabled, lucide icons)

### Score Consumer Context
- `.planning/ROADMAP.md` — Phase 15 (CARD-04: score badge on cards), Phase 17 (OPT-01-04: score gauge + audit cards), Phase 18 (review metrics). These are the downstream consumers of the score function.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/ui/card.tsx` — Card component (used across the app)
- `src/components/ui/badge.tsx` — Badge component (can be used for score grade display)
- `src/lib/prisma.ts` — Prisma client singleton
- `src/lib/utils.ts` — Utility functions (cn helper, etc.)

### Established Patterns
- Prisma queries with includes used throughout (e.g., profile with reviews, posts)
- Pure utility functions in `src/lib/` (e.g., `keyword-generator.ts`, `description-generator.ts`)
- shadcn UI components in `src/components/ui/`

### Integration Points
- Score function will be imported by: Phase 15 (business cards), Phase 16 (dashboard), Phase 17 (optimization page)
- DB indexes affect query performance for: DailyMetric lookups, ProfileDescription filtering
- shadcn chart primitives will be used by: Phase 17 (score gauge), Phase 18 (review charts), Phase 19 (report charts)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches for the score formula benchmarks and test validation.

</specifics>

<deferred>
## Deferred Ideas

- **Images signal** — Add photo tracking to DB and include in score (requires photo management feature)
- **Attributes signal** — Add ProfileAttribute model to track pushed attributes, then include in score
- **Configurable time windows** — Allow custom date ranges for frequency signals (no use case yet)
- **Weighted scoring** — Tiered weights by signal importance (equal weights chosen for simplicity/transparency)

</deferred>

---

*Phase: 14-score-library-dependencies*
*Context gathered: 2026-04-02*
