---
phase: 16
slug: dashboard-upgrades
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-02
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | DASH-01 | unit | `npx vitest run tests/dashboard` | ❌ W0 | ⬜ pending |
| 16-01-02 | 01 | 1 | DASH-02 | unit | `npx vitest run tests/dashboard` | ❌ W0 | ⬜ pending |
| 16-01-03 | 01 | 1 | DASH-03 | unit | `npx vitest run tests/dashboard` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/dashboard/automations-feed.test.ts` — stubs for DASH-01 (automations feed with 20 items)
- [ ] `tests/dashboard/tasks-table.test.ts` — stubs for DASH-02 (expanded task types)
- [ ] `tests/dashboard/business-filter.test.ts` — stubs for DASH-03 (filter coverage)

*Existing test infrastructure (vitest) covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Suspense skeleton rendering | SC-4 | Visual streaming behavior cannot be unit tested | Load dashboard with slow network (DevTools throttle), verify skeletons appear before data |
| Business filter updates all widgets | DASH-03 | Requires full page render with real data | Select a profile from dropdown, verify all sections update |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
