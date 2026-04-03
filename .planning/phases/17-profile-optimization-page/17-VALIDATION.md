---
phase: 17
slug: profile-optimization-page
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-03
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.2 (existing) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/lib/optimization-utils.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/lib/optimization-utils.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | OPT-02 | unit | `npx vitest run tests/lib/optimization-utils.test.ts` | ❌ W0 (created by TDD task) | ⬜ pending |
| 17-01-02 | 01 | 1 | — | build | `npx next build` | ✅ | ⬜ pending |
| 17-02-01 | 02 | 1 | OPT-01, OPT-02 | typecheck | `npx tsc --noEmit --pretty` | ✅ | ⬜ pending |
| 17-02-02 | 02 | 1 | OPT-01, OPT-02 | build | `npx next build` | ✅ | ⬜ pending |
| 17-03-01 | 03 | 2 | OPT-03, OPT-04 | typecheck | `npx tsc --noEmit --pretty` | ✅ | ⬜ pending |
| 17-03-02 | 03 | 2 | OPT-03, OPT-04 | build | `npx next build` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/lib/optimization-utils.test.ts` — created by Plan 01 Task 1 (TDD: write tests then implement)

*Existing vitest infrastructure covers framework needs. Plan 01 Task 1 creates the test file as part of its TDD workflow.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Radial gauge visual rendering | OPT-01 | Recharts SVG rendering needs browser | Load /dashboard/optimization/[id], verify gauge arc color matches score grade |
| Bulk action confirmation dialog | OPT-04 | Dialog interaction flow | Click "Approve All", verify dialog appears with count, confirm, verify items update |
| Sidebar navigation active state | SC-5 | Visual routing state | Click Optimization in sidebar, verify active highlight and correct route |

---

## Scope Notes

- **Attribute suggestions (OPT-03):** Phase 12 wrote attributes directly to GBP without an approval workflow. No `/api/reoptimize/attributes` endpoint exists. OPT-03 is satisfied by description + services coverage. If attribute suggestion approval is added in a future phase, it can be surfaced on this page then.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-03
