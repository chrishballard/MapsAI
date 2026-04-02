# Phase 14: Score Library & Dependencies - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-02
**Phase:** 14-Score Library & Dependencies
**Areas discussed:** Score signal weights, Score function input shape, Attribute handling, Chart dependency strategy

---

## Score Signal Weights

| Option | Description | Selected |
|--------|-------------|----------|
| Equal weights | Each signal counts equally (~14.3 points each for 7, or 20 each for 5). Simple, transparent, easy to explain. | ✓ |
| Tiered weights | Group signals into impact tiers (high/medium/low). More nuanced but harder to explain. | |
| You decide | Claude picks based on SEO best practices. | |

**User's choice:** Equal weights
**Notes:** None

### Follow-up: Images Signal

| Option | Description | Selected |
|--------|-------------|----------|
| Skip images signal for now | Don't include images — no photo data in DB. Add later when photo tracking exists. | ✓ |
| Accept optional attribute data | Score function accepts optional hasPhotos boolean. Caller fetches from API. | |
| Include as always-zero placeholder | Signal exists but scores 0 with 'not tracked yet' status. | |

**User's choice:** Skip images signal for now
**Notes:** Reduces active signals from 7 to 6 (then 5 after attributes also skipped)

---

## Score Function Input Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Prisma profile-with-includes | Accept full Prisma Profile type with relations. One query with includes. Type-safe. | ✓ |
| Pre-shaped summary object | Custom input type decoupled from Prisma. Every caller must map data. | |
| You decide | Claude picks. | |

**User's choice:** Prisma profile-with-includes
**Notes:** Matches existing codebase patterns

### Follow-up: Time Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed rolling window | Hardcode 30-day window for frequency signals. Function filters internally. | ✓ |
| Configurable date param | Accept optional 'since' date. More flexible but no use case yet. | |
| You decide | Claude picks. | |

**User's choice:** Fixed rolling window (30 days)
**Notes:** None

---

## Attribute Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Skip attributes signal | Don't include — no ProfileAttribute model, requires API call per profile. | ✓ |
| Accept optional attribute data | Score accepts optional { attributeCount, totalAvailable }. Partial purity. | |
| Add ProfileAttribute model | Create DB model to track pushed attributes. More work but enables signal. | |

**User's choice:** Skip attributes signal
**Notes:** Combined with images skip, active signals are: review frequency, post frequency, rating, description, services (5 total, 20 pts each)

---

## Chart Dependency Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Dual-library | Keep chart.js for PDF, add recharts for browser. Different rendering targets. | ✓ |
| Migrate everything to recharts | Replace chart.js in PDF too. Consistency but risky refactor. | |
| You decide | Claude picks. | |

**User's choice:** Dual-library (chart.js for PDF, recharts for browser)
**Notes:** None

### Follow-up: Validation Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal smoke test | Dev-only test page with one chart and one QR code. Verify next build. | ✓ |
| Unit test only | Jest/Vitest render test. Doesn't catch SSR hydration issues. | |
| You decide | Claude picks. | |

**User's choice:** Minimal smoke test
**Notes:** None

---

## Claude's Discretion

- Signal benchmarks (what counts as good/warning/critical per signal)
- Check[] item structure details
- Required Prisma includes for the score function type
- Test page route and cleanup approach

## Deferred Ideas

- Images signal (needs photo tracking in DB)
- Attributes signal (needs ProfileAttribute model)
- Configurable time windows (no use case yet)
- Tiered weighted scoring (equal weights chosen for simplicity)
