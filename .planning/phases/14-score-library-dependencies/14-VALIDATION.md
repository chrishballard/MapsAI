---
phase: 14
slug: score-library-dependencies
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-02
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.mts (Wave 0 installs) |
| **Quick run command** | `npx vitest run src/lib/__tests__/optimization-score.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/lib/__tests__/optimization-score.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 0 | infra | setup | `npx vitest --version` | ❌ W0 | ⬜ pending |
| 14-02-01 | 02 | 1 | CARD-04/OPT-01 | unit | `npx vitest run src/lib/__tests__/optimization-score.test.ts` | ❌ W0 | ⬜ pending |
| 14-03-01 | 03 | 1 | infra | build | `npx next build` | ✅ | ⬜ pending |
| 14-04-01 | 04 | 1 | infra | migration | `npx prisma validate` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest` and `@vitejs/plugin-react` — test framework installation
- [ ] `vitest.config.mts` — vitest configuration with path aliases
- [ ] `src/lib/__tests__/optimization-score.test.ts` — test stubs for score function

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Chart renders without hydration errors | SC-2 | Requires browser rendering | Run `next build`, then `next start`, visit test page, check browser console for hydration warnings |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
