# Phase 14: Score Library & Dependencies - Research

**Researched:** 2026-04-02
**Domain:** TypeScript pure functions, recharts v3, shadcn chart primitives, Prisma indexes, vitest
**Confidence:** HIGH

## Summary

Phase 14 is a pure foundational layer with no user-facing UI. It has three independent deliverables: (1) a pure TypeScript score function in `src/lib/`, (2) browser chart/QR dependency installation and smoke-test validation, and (3) two Prisma schema index additions with migration.

The score function follows the exact same pattern as existing `src/lib/` utilities (`keyword-generator.ts`, `description-generator.ts`) — plain TypeScript module with named exports and a clear input/output contract. No new architecture is needed; the pattern is already established in the project.

The recharts installation requires special handling because the project runs React 19 but recharts 3.8.1's peer dependency for `react-is` is only declared up to React 19 (`^19.0.0`), which is satisfied. The `react-is` package at version 19.2.4 is already transitively installed. No `--legacy-peer-deps` flag is needed. The shadcn `chart` component has already been partially configured — `globals.css` already defines all five `--chart-*` CSS variables, meaning `npx shadcn@latest add chart` will only need to create `src/components/ui/chart.tsx`.

The Prisma schema already has `@@unique([profileId, date])` on `DailyMetric` which doubles as a composite index. The only true gap is `ProfileDescription` having no index on `(profileId, isApproved)`. A single `@@index` directive and migration closes this.

Vitest is the correct unit test choice for the pure score function — zero configuration complexity, no React component testing needed for a pure function, and the project has no existing test infrastructure so Wave 0 must install it.

**Primary recommendation:** Three separate tasks: (1) score function + unit tests, (2) dep install + smoke page + build verify, (3) schema index + migration. Execute in any order — they are independent.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Equal weighting across all active signals. 5 active signals at 20 points each = 100 total.
- **D-02:** Active signals: review frequency, post frequency, rating, description completeness, services completeness.
- **D-03:** Skip images signal — no photo data in DB. Defer to future phase when photo tracking is built.
- **D-04:** Skip attributes signal — no ProfileAttribute model in DB, attributes were pushed directly to GBP in v1.1. Defer to future phase if attribute tracking is added.
- **D-05:** Score thresholds: green >= 70, amber 40-69, red < 40 (from ROADMAP.md).
- **D-06:** Accept full Prisma Profile type with relations included (reviews, posts, descriptions, services, cities, keywords). Callers do one Prisma query with includes.
- **D-07:** Return type: `{ total: number, grade: string, checks: Check[] }` where each Check has signal name, score, max, status, and recommendation.
- **D-08:** Fixed 30-day rolling window for time-based signals (post frequency, review frequency). Function filters internally — caller just passes full data.
- **D-09:** Dual-library approach: keep chart.js for existing PDF reports (server-side), add recharts for all new browser UI charts (Phases 17-19).
- **D-10:** Install recharts, qrcode.react, and run `npx shadcn@latest add chart` for shadcn chart primitives.
- **D-11:** Validate with minimal smoke test — dev-only test page with one recharts chart and one QR code, verify `next build` succeeds without hydration errors.

### Claude's Discretion

- Exact benchmarks per signal (e.g., what post frequency counts as "good" vs "warning" vs "critical")
- Check[] item structure details (fields, status enum values)
- Which Prisma includes are required for the score function's type
- Test page route structure and cleanup approach

### Deferred Ideas (OUT OF SCOPE)

- **Images signal** — Add photo tracking to DB and include in score (requires photo management feature)
- **Attributes signal** — Add ProfileAttribute model to track pushed attributes, then include in score
- **Configurable time windows** — Allow custom date ranges for frequency signals (no use case yet)
- **Weighted scoring** — Tiered weights by signal importance (equal weights chosen for simplicity/transparency)
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| recharts | 3.8.1 | Browser-side charts (bar, line, area, pie) | Official dep of shadcn chart; React 19 compatible; v3 is latest stable |
| qrcode.react | 4.2.0 | QR code rendering as React component | Only maintained React QR library; React 19 compatible |
| vitest | 4.1.2 | Unit test runner for pure score function | Zero-config for pure TS functions; faster than jest; Next.js officially recommends it |
| @vitejs/plugin-react | 6.0.1 | React transform for vitest | Required by vitest for JSX/React support |
| vite-tsconfig-paths | 6.1.1 | Resolves `@/` path aliases in tests | Maps tsconfig paths to vitest resolver |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| jsdom | (vitest installs) | Browser environment simulation | Only needed if testing React components — not required for pure function tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| recharts | victory, chart.js (browser) | recharts is the only one shadcn chart wraps; using others would bypass shadcn primitives |
| vitest | jest | jest requires more config with Next.js App Router and ESM; vitest is the Next.js-recommended choice |
| qrcode.react | react-qr-code | qrcode.react is more maintained, same API footprint |

**Installation:**
```bash
npm install recharts qrcode.react
npm install -D vitest @vitejs/plugin-react vite-tsconfig-paths
npx shadcn@latest add chart
```

**Version verification (confirmed 2026-04-02):**
- `recharts@3.8.1` — published to npm, latest stable
- `qrcode.react@4.2.0` — published to npm, latest stable
- `vitest@4.1.2` — published to npm, latest stable

**react-is peer dependency:** recharts 3.8.1 requires `react-is ^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0`. The project's transitive install already has `react-is@16.13.1` (from `@react-pdf/renderer` → `prop-types`). npm will install a second `react-is` resolution at the correct major for recharts — no `--legacy-peer-deps` flag is needed because the declared peer range covers React 19.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   └── optimization-score.ts   # Pure function — new file
├── components/
│   └── ui/
│       └── chart.tsx           # Created by npx shadcn add chart
├── app/
│   └── dashboard/
│       └── _dev/               # Dev-only smoke test page (delete after verify)
│           └── chart-smoke/
│               └── page.tsx
tests/
└── lib/
    └── optimization-score.test.ts   # New — unit tests for score function
vitest.config.mts                    # New — vitest config
```

### Pattern 1: Pure Score Function (matching existing lib style)
**What:** Plain TypeScript module, named exports, no side effects, no imports from framework code.
**When to use:** Any logic that computes derived values from data — the established pattern in this project.
**Example:**
```typescript
// Source: modeled on src/lib/keyword-generator.ts and src/lib/description-generator.ts patterns

// score thresholds: green >= 70, amber 40-69, red < 40
export type ScoreStatus = 'good' | 'warning' | 'critical';
export type ScoreGrade = 'green' | 'amber' | 'red';

export interface ScoreCheck {
  signal: string;        // human-readable name, e.g. "Review Frequency"
  score: number;         // points earned (0-20)
  max: number;           // always 20 for equal-weighted 5-signal model
  status: ScoreStatus;   // 'good' | 'warning' | 'critical'
  value: string;         // current value, e.g. "3 reviews in 30 days"
  benchmark: string;     // target, e.g. "5+ reviews per 30 days"
  recommendation: string; // what to do if not good
}

export interface OptimizationScore {
  total: number;          // 0-100
  grade: ScoreGrade;      // 'green' | 'amber' | 'red'
  checks: ScoreCheck[];   // one entry per active signal
}

export function computeOptimizationScore(profile: ProfileWithRelations): OptimizationScore {
  // ...
}
```

### Pattern 2: recharts Client Component (avoiding hydration errors)
**What:** All recharts components must be in Client Components (files with `'use client'` at top). Never render recharts inside Server Components — it accesses the DOM on mount.
**When to use:** Every chart in the app that uses recharts.
**Example:**
```typescript
// Source: shadcn/ui chart docs + project pattern
'use client';

import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { LineChart, Line, XAxis, YAxis } from 'recharts';

// ChartContainer MUST have a height, min-h-*, or aspect-* class
// This prevents ResponsiveContainer from measuring zero height on first render
export function SmokeChart() {
  return (
    <ChartContainer config={{ value: { label: 'Value', color: 'var(--chart-1)' } }} className="min-h-[200px]">
      <LineChart data={[{ name: 'A', value: 1 }, { name: 'B', value: 2 }]}>
        <XAxis dataKey="name" />
        <YAxis />
        <Line type="monotone" dataKey="value" stroke="var(--chart-1)" />
        <ChartTooltip content={<ChartTooltipContent />} />
      </LineChart>
    </ChartContainer>
  );
}
```

### Pattern 3: Prisma @@index directive
**What:** Explicit composite non-unique index on frequently filtered columns.
**When to use:** When queries filter on a compound of two columns but the compound is not unique (ProfileDescription: multiple rows per profileId, each with isApproved).
**Example:**
```prisma
model ProfileDescription {
  // ... existing fields ...
  @@index([profileId, isApproved])  // ADD THIS
}
```

Note: `DailyMetric` already has `@@unique([profileId, date])` which creates a B-tree index usable by range queries. The CONTEXT.md asks to add a "composite DB index" for DailyMetric — but this already exists as the unique constraint. The only missing index is on ProfileDescription.

### Anti-Patterns to Avoid
- **Server Component recharts:** Importing recharts components in a file without `'use client'` causes build errors or hydration mismatches. Every file that renders a recharts component must be a Client Component.
- **Missing ChartContainer height:** If `ChartContainer` (which wraps `ResponsiveContainer`) has no height, recharts will render zero height with a console warning, and the `next build` snapshot will differ from the client render.
- **Calling `computeOptimizationScore` inside a Server Component that also passes data to Client Components:** Keep the score computation in the server layer (Server Components or API routes) and pass the pre-computed `OptimizationScore` object down to Client Components as props.
- **Importing score function in Client Components with Prisma types:** The score function's input type uses generated Prisma types. Do not import Prisma types inside `'use client'` files — define a leaner input interface the Client Component can receive, and keep the Prisma-typed version server-side only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| QR code generation | Custom canvas-based QR renderer | `qrcode.react` | Error correction levels, quiet zone, version selection are all edge-case sensitive |
| Chart CSS theming | Custom recharts theme injection | `shadcn/ui chart` (ChartContainer + CSS vars) | shadcn chart maps CSS variables to recharts color tokens, handles dark mode automatically |
| TypeScript path aliases in tests | Custom vitest resolve config | `vite-tsconfig-paths` plugin | Reads existing tsconfig.json automatically — zero maintenance |

**Key insight:** The score function itself is the one place custom logic is correct — there is no off-the-shelf library for "compute a weighted GBP optimization score from Prisma data."

## Common Pitfalls

### Pitfall 1: recharts hydration mismatch from missing ChartContainer height
**What goes wrong:** `next build` succeeds but the HTML snapshot from the server render shows an empty SVG while the client render fills it in. This triggers a React hydration warning that can escalate to a full hydration error in React 19 strict mode.
**Why it happens:** `ResponsiveContainer` (used internally by `ChartContainer`) measures its parent's dimensions on mount. If no height is set, it defaults to `0px` on both renders but may differ if the layout has not stabilized.
**How to avoid:** Always set `className="min-h-[200px]"` or an explicit `style={{ height: 300 }}` on every `ChartContainer`.
**Warning signs:** `ResizeObserver loop limit exceeded` in the browser console, or a hydration warning mentioning SVG dimensions.

### Pitfall 2: Prisma type leakage into Client Components
**What goes wrong:** Importing `Profile` from `@/generated/prisma` inside a `'use client'` file causes the Prisma client to be bundled into the browser bundle (or throws a build error).
**Why it happens:** Prisma client includes Node.js-only modules. Next.js detects the `'use client'` boundary and tries to include transitive imports in the browser bundle.
**How to avoid:** The score function's input type should have a plain interface (e.g., `ProfileWithRelations`) that does NOT import from `@/generated/prisma`. Import the Prisma type only in server-side files and cast at the call site.
**Warning signs:** `Module not found: Can't resolve 'fs'` or similar Node built-in errors during `next build`.

### Pitfall 3: shadcn chart CSS variable syntax (v2 vs v3)
**What goes wrong:** Old shadcn chart examples use `hsl(var(--chart-1))` but recharts v3 / shadcn chart v3 uses `var(--chart-1)` directly. Mixing them causes colors to render as `hsl(#7c3aed)` which is invalid CSS.
**Why it happens:** In v2, `--chart-1` was defined as HSL components (e.g., `280 83% 57%`). In the current project, `globals.css` defines `--chart-1: #7c3aed` (hex value). Using `hsl(var(--chart-1))` on a hex value is invalid.
**How to avoid:** Always use `var(--chart-1)` (not `hsl(var(--chart-1))`). The project's `globals.css` already uses hex values for chart variables.
**Warning signs:** Charts render with no color (transparent strokes/fills).

### Pitfall 4: `npx shadcn@latest add chart` runs in interactive mode and asks to overwrite files
**What goes wrong:** If run non-interactively (in a script or CI), shadcn CLI may prompt for confirmation and hang.
**Why it happens:** shadcn CLI is designed for interactive terminal use.
**How to avoid:** Run with the `--yes` flag to auto-confirm: `npx shadcn@latest add chart --yes`. Verify `src/components/ui/chart.tsx` was created after the command.

### Pitfall 5: Smoke test page left in production build
**What goes wrong:** The dev-only smoke test page (`/dashboard/_dev/chart-smoke`) ships to production Railway deployment.
**Why it happens:** Next.js App Router includes all page.tsx files in the build by default.
**How to avoid:** Either delete the smoke test page after confirming `next build` succeeds, or gate the route with a middleware check on `process.env.NODE_ENV`. Deletion is simpler and cleaner.

## Code Examples

Verified patterns from official sources and project conventions:

### Score function skeleton (pure TypeScript)
```typescript
// src/lib/optimization-score.ts
// Score thresholds: green >= 70 | amber 40-69 | red < 40

export type ScoreStatus = 'good' | 'warning' | 'critical';
export type ScoreGrade = 'green' | 'amber' | 'red';

export interface ScoreCheck {
  signal: string;
  score: number;
  max: number;
  status: ScoreStatus;
  value: string;
  benchmark: string;
  recommendation: string;
}

export interface OptimizationScore {
  total: number;
  grade: ScoreGrade;
  checks: ScoreCheck[];
}

// Input: profile with all needed relations. Do NOT import Prisma types here
// to keep this file importable in both server and client contexts (as plain data).
export interface ProfileInput {
  reviews: Array<{ rating: number; reviewDate: Date }>;
  posts: Array<{ publishedAt: Date | null; status: string }>;
  descriptions: Array<{ isApproved: boolean; isPushed: boolean }>;
  services: Array<{ isApproved: boolean; isPushed: boolean }>;
}

const WINDOW_DAYS = 30; // D-08: fixed rolling window

export function computeOptimizationScore(profile: ProfileInput): OptimizationScore {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const checks: ScoreCheck[] = [
    scoreReviewFrequency(profile.reviews, windowStart),
    scorePostFrequency(profile.posts, windowStart),
    scoreRating(profile.reviews),
    scoreDescriptionCompleteness(profile.descriptions),
    scoreServicesCompleteness(profile.services),
  ];

  const total = checks.reduce((sum, c) => sum + c.score, 0);
  const grade: ScoreGrade = total >= 70 ? 'green' : total >= 40 ? 'amber' : 'red';

  return { total, grade, checks };
}
```

### Vitest config (vitest.config.mts)
```typescript
// vitest.config.mts — place in project root
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'node',  // pure function — no DOM needed
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    globals: true,
  },
});
```

### Unit test skeleton
```typescript
// tests/lib/optimization-score.test.ts
import { describe, it, expect } from 'vitest';
import { computeOptimizationScore } from '@/lib/optimization-score';

describe('computeOptimizationScore', () => {
  it('returns 100 for a perfect profile', () => {
    const now = new Date();
    const recent = (offset: number) => new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
    const profile = {
      reviews: Array.from({ length: 10 }, (_, i) => ({ rating: 5, reviewDate: recent(i * 2) })),
      posts: Array.from({ length: 5 }, (_, i) => ({ publishedAt: recent(i * 5), status: 'PUBLISHED' })),
      descriptions: [{ isApproved: true, isPushed: true }],
      services: Array.from({ length: 5 }, () => ({ isApproved: true, isPushed: true })),
    };
    const result = computeOptimizationScore(profile);
    expect(result.total).toBe(100);
    expect(result.grade).toBe('green');
  });

  it('grades amber for total 40-69', () => {
    // partial profile with 2 signals fully passing, 3 failing
    // ...
    expect(result.grade).toBe('amber');
  });

  it('grades red for total below 40', () => {
    // empty profile
    const result = computeOptimizationScore({ reviews: [], posts: [], descriptions: [], services: [] });
    expect(result.total).toBeLessThan(40);
    expect(result.grade).toBe('red');
  });
});
```

### Prisma schema addition
```prisma
model ProfileDescription {
  id          String    @id @default(cuid())
  profileId   String
  profile     Profile   @relation(fields: [profileId], references: [id], onDelete: Cascade)
  content     String    @db.Text
  isApproved  Boolean   @default(false)
  isPushed    Boolean   @default(false)
  pushedAt    DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([profileId, isApproved])  // ADD: enables fast lookup of approved descriptions per profile
}
```

After editing `schema.prisma`: `npx prisma migrate dev --name add-profile-description-index`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| recharts v2 (hsl CSS vars) | recharts v3 (hex/direct CSS vars) | ~2024 | Change `hsl(var(--chart-N))` to `var(--chart-N)` in all color references |
| jest for Next.js unit tests | vitest (official recommendation) | 2024 | vitest is now the officially documented Next.js test runner |
| shadcn chart wraps recharts with abstraction | shadcn chart is a thin styled wrapper only | v1.0 always | You compose recharts directly; shadcn adds ChartContainer + tooltip styling |

**Deprecated/outdated:**
- `hsl(var(--chart-N))` syntax: replaced by `var(--chart-N)` — this project's `globals.css` already uses hex values, so the old HSL pattern should never appear.

## Open Questions

1. **Score benchmarks per signal (Claude's Discretion)**
   - What we know: 5 signals, 20 pts each, 30-day window for time-based signals
   - What's unclear: At what counts/values does each signal transition from critical → warning → good?
   - Recommendation: Use industry-standard GBP benchmarks. Suggested starting point: review frequency (good: 4+ in 30d, warning: 1-3, critical: 0), post frequency (good: 4+ in 30d, warning: 1-3, critical: 0), rating (good: ≥4.0, warning: 3.0-3.9, critical: <3.0), description (good: isPushed=true, warning: isApproved but not pushed, critical: neither), services (good: ≥3 pushed, warning: 1-2 pushed, critical: 0 pushed). These are adjustable without breaking the API contract.

2. **Smoke test page route and cleanup approach (Claude's Discretion)**
   - What we know: Must be dev-only, must survive `next build` without hydration errors, must be deleted or gated after verification
   - What's unclear: Whether to delete immediately after verifying build, or leave gated with NODE_ENV check
   - Recommendation: Create at `src/app/dashboard/_dev/chart-smoke/page.tsx`, verify `next build`, then delete the `_dev/` directory entirely. Clean is better than gated.

3. **DailyMetric composite index (from CONTEXT.md)**
   - What we know: `@@unique([profileId, date])` already exists on DailyMetric — this IS a B-tree composite index
   - What's unclear: Whether the CONTEXT.md's mention of this index means "verify it exists" or "add an additional non-unique @@index"
   - Recommendation: The existing `@@unique` constraint satisfies the index requirement for `DailyMetric(profileId, date)`. No migration needed for this model. Document this finding clearly in the plan so no spurious migration is added.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | vitest, npm | ✓ | v24.13.0 | — |
| npm | package install | ✓ | (bundled with Node) | — |
| npx / shadcn CLI | `npx shadcn@latest add chart` | ✓ | shadcn@4.0.0 installed | — |
| PostgreSQL (Railway) | Prisma migration | ✓ (Railway) | — | Run `npx prisma migrate dev` locally with DATABASE_URL set |
| recharts | Browser charts | ✗ (not yet installed) | — | Install via npm |
| qrcode.react | QR code rendering | ✗ (not yet installed) | — | Install via npm |
| vitest | Unit tests | ✗ (not yet installed) | — | Install via npm |

**Missing dependencies with no fallback:**
- None — all required packages can be installed from npm.

**Missing dependencies with fallback:**
- All three missing packages (recharts, qrcode.react, vitest) are installable; no blocking issues.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 (not yet installed — Wave 0 gap) |
| Config file | `vitest.config.mts` (does not exist — Wave 0 gap) |
| Quick run command | `npx vitest run tests/lib/optimization-score.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

This phase has no formal requirement IDs but has concrete success criteria:

| Success Criterion | Behavior | Test Type | Automated Command | File Exists? |
|-------------------|----------|-----------|-------------------|-------------|
| SC-1: Score function exists and is correct | `computeOptimizationScore` returns correct total, grade, checks for known inputs | unit | `npx vitest run tests/lib/optimization-score.test.ts` | ❌ Wave 0 |
| SC-2: recharts renders without hydration errors | `next build` completes without hydration-related errors | smoke/build | `npm run build` (manual review of output) | ❌ Wave 0 |
| SC-3: DB index migration succeeds | `prisma migrate dev` applies cleanly | migration | `npx prisma migrate dev` | ❌ Wave 0 |
| SC-4: Score thresholds in code comments | green ≥70, amber 40-69, red <40 appear as comments | code review | (manual) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/lib/optimization-score.test.ts`
- **Per wave merge:** `npx vitest run && npm run build`
- **Phase gate:** All unit tests green + `npm run build` exits 0 before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/lib/optimization-score.test.ts` — covers SC-1 (pure function correctness, all three grade bands, all five signals)
- [ ] `vitest.config.mts` — vitest configuration in project root
- [ ] Install vitest ecosystem: `npm install -D vitest @vitejs/plugin-react vite-tsconfig-paths`
- [ ] Add `"test": "vitest run"` script to `package.json`

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 14 |
|-----------|-------------------|
| Do not use pandoc or Ruby GDocs scripts | Not applicable (no doc generation in this phase) |
| Use Node.js docx library for SOP docs | Not applicable |
| Google Docs: use MCP tools only | Not applicable |

No CLAUDE.md directives conflict with any Phase 14 decisions.

## Sources

### Primary (HIGH confidence)
- `prisma/schema.prisma` (project file) — confirmed existing indexes: `@@unique([profileId, date])` on DailyMetric, no index on ProfileDescription
- `package.json` (project file) — confirmed recharts, qrcode.react, vitest NOT installed; chart.js, chartjs-node-canvas, @react-pdf/renderer present
- `src/app/globals.css` (project file) — confirmed `--chart-1` through `--chart-5` CSS variables already defined as hex values
- `components.json` (project file) — confirmed base-nova style, RSC enabled, tailwind CSS variables enabled
- npm registry (2026-04-02): recharts@3.8.1, qrcode.react@4.2.0, vitest@4.1.2, @vitejs/plugin-react@6.0.1

### Secondary (MEDIUM confidence)
- [shadcn/ui chart docs](https://ui.shadcn.com/docs/components/chart) — ChartContainer height requirement, CSS var syntax, `npx shadcn add chart` output
- [wisp.blog vitest Next.js 15 guide](https://www.wisp.blog/blog/setting-up-vitest-for-nextjs-15) — verified against official Next.js docs structure
- [Next.js testing guide](https://nextjs.org/docs/app/guides/testing) — vitest as recommended test runner

### Tertiary (LOW confidence)
- WebSearch results on recharts React 19 peer deps — confirmed `react-is` range covers React 19, but not independently verified against recharts v3.8.1 changelog

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified from npm registry on research date
- Architecture: HIGH — score function pattern directly mirrors existing `src/lib/` files in this project
- Prisma indexes: HIGH — schema read directly, presence/absence of indexes confirmed
- recharts hydration: MEDIUM — pattern well-documented in shadcn official docs; smoke test validation catches any remaining issues
- Vitest setup: HIGH — config from official Next.js documentation

**Research date:** 2026-04-02
**Valid until:** 2026-05-02 (recharts/shadcn move quickly; re-verify chart CSS var syntax if >30 days)
