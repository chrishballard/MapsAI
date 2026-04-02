---
phase: 15
slug: business-cards-view
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-02
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.2 |
| **Config file** | vitest.config.mts |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx vitest run && npm run build` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run && npm run build`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 15-01-01 | 01 | 1 | CARD-01, CARD-02, CARD-04 | build | `npm run build` | ✅ | ⬜ pending |
| 15-01-02 | 01 | 1 | CARD-03 | build | `npm run build` | ✅ | ⬜ pending |
| 15-01-03 | 01 | 1 | SC-5 | build | `npm run build` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. vitest already configured from Phase 14.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Card grid renders 4 columns on xl viewport | CARD-01 | Visual layout verification | Open /dashboard/profiles on xl viewport, confirm 4-column grid |
| Score badges show correct colors | CARD-04 | Visual color verification | Check green/amber/red badges match score thresholds |
| Search filters cards in real time | CARD-02 | Interactive behavior | Type in search bar, confirm cards filter instantly |
| Add Business button navigates to onboarding | CARD-03 | Navigation verification | Click "Add a Business", confirm redirect to onboarding |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
