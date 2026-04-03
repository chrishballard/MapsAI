---
phase: 18
slug: review-metrics-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-03
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (via existing setup) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 1 | RVMT-01 | unit | `npx vitest run tests/lib/review-metrics.test.ts` | ❌ W0 | ⬜ pending |
| 18-01-02 | 01 | 1 | RVMT-02 | unit | `npx vitest run tests/lib/review-metrics.test.ts` | ❌ W0 | ⬜ pending |
| 18-01-03 | 01 | 1 | RVMT-03 | unit | `npx vitest run tests/lib/review-metrics.test.ts` | ❌ W0 | ⬜ pending |
| 18-01-04 | 01 | 1 | RVMT-04 | unit | `npx vitest run tests/lib/review-metrics.test.ts` | ❌ W0 | ⬜ pending |
| 18-01-05 | 01 | 1 | RVMT-05 | unit | `npx vitest run tests/lib/review-metrics.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/lib/review-metrics.test.ts` — stubs for RVMT-01 through RVMT-05 (pure function tests)
- [ ] Vitest already installed — no framework install needed

*Existing vitest infrastructure covers test runner. Only test file stubs needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Chart renders correctly | RVMT-02, RVMT-03, RVMT-05 | Recharts visual output cannot be automated without browser | Load /dashboard/reviews/metrics, verify bar chart and line chart render with correct data |
| "Data through" label visible | SC-5 | Visual DOM check | Verify subtitle shows "Data through [date]" below page heading |
| Sidebar navigation | D-03 | UI navigation flow | Click Review Metrics in sidebar, verify route loads |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
