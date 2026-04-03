---
phase: 17
slug: profile-optimization-page
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-03
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.x (existing) |
| **Config file** | jest.config.ts |
| **Quick run command** | `npx jest --testPathPattern="optimization" --bail` |
| **Full suite command** | `npx jest` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest --testPathPattern="optimization" --bail`
- **After every plan wave:** Run `npx jest`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | OPT-01 | unit | `npx jest --testPathPattern="score-gauge"` | ❌ W0 | ⬜ pending |
| 17-01-02 | 01 | 1 | OPT-02 | unit | `npx jest --testPathPattern="audit-card"` | ❌ W0 | ⬜ pending |
| 17-02-01 | 02 | 2 | OPT-03 | unit | `npx jest --testPathPattern="suggestion"` | ❌ W0 | ⬜ pending |
| 17-02-02 | 02 | 2 | OPT-04 | unit | `npx jest --testPathPattern="bulk-action"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/components/optimization/score-gauge.test.tsx` — stubs for OPT-01
- [ ] `tests/components/optimization/audit-cards.test.tsx` — stubs for OPT-02
- [ ] `tests/components/optimization/suggestions.test.tsx` — stubs for OPT-03, OPT-04

*Existing jest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Radial gauge visual rendering | OPT-01 | Recharts SVG rendering needs browser | Load /dashboard/optimization/[id], verify gauge arc color matches score grade |
| Bulk action confirmation dialog | OPT-04 | Dialog interaction flow | Click "Approve All", verify dialog appears with count, confirm, verify items update |
| Sidebar navigation active state | SC-5 | Visual routing state | Click Optimization in sidebar, verify active highlight and correct route |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
