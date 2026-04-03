---
phase: 19
slug: reports-enhancement
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-03
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose && npx next build` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose && npx next build`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | RPT-01 | unit | `npx vitest run tests/lib/report-metrics.test.ts` | ❌ W0 | ⬜ pending |
| 19-01-02 | 01 | 1 | RPT-02 | unit | `npx vitest run tests/lib/report-metrics.test.ts` | ❌ W0 | ⬜ pending |
| 19-01-03 | 01 | 1 | RPT-03,04,05 | unit | `npx vitest run tests/lib/report-metrics.test.ts` | ❌ W0 | ⬜ pending |
| 19-01-04 | 01 | 1 | RPT-06 | unit | `npx vitest run tests/lib/report-metrics.test.ts` | ❌ W0 | ⬜ pending |
| 19-02-01 | 02 | 2 | RPT-01 | build | `npx next build` | ✅ | ⬜ pending |
| 19-02-02 | 02 | 2 | RPT-02 | build | `npx next build` | ✅ | ⬜ pending |
| 19-02-03 | 02 | 2 | RPT-03,04,05 | build | `npx next build` | ✅ | ⬜ pending |
| 19-02-04 | 02 | 2 | RPT-06 | build | `npx next build` | ✅ | ⬜ pending |
| 19-02-05 | 02 | 2 | RPT-07 | build | `npx next build` | ✅ | ⬜ pending |
| 19-03-01 | 03 | 3 | RPT-08 | build | `npx next build` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/lib/report-metrics.test.ts` — stubs for RPT-01 through RPT-06 pure data functions
- [ ] Vitest already configured — no framework install needed

*Existing vitest infrastructure covers test framework requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Recharts sparkline renders correctly | RPT-03,04,05 | Recharts client rendering requires browser | Load /dashboard/reports, verify sparklines visible in each metric card |
| PDF download produces valid file | RPT-08 | PDF binary output needs manual inspection | Click "Download PDF", open file, verify charts and narrative present |
| AI narrative is coherent | RPT-07 | Natural language quality is subjective | Read the 3-sentence summary, verify it references actual metrics |
| Date range selector updates all widgets | RPT-01 | Client interaction testing | Click each preset (7d, 30d, 90d), verify all cards/charts update |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
