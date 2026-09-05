# ROADMAP 追跡表

設計仕様 `2026-09-06-roadmap-completion-design.md` の完了条件とテストの対応。

| ROADMAP Phase / 成功条件 | テスト |
|---|---|
| Phase 0: schema と golden fixtures | `tests/schema.test.ts`, `tests/golden.test.ts` |
| Phase 1: scan と決定論的診断 | `tests/scan.test.ts`, `tests/evidence.test.ts`, `tests/intake.test.ts` |
| Phase 2: intervention と before/after | `tests/intervention.test.ts` |
| Phase 3: diff / blast radius / GitHub | `tests/diff.test.ts`, `.github/workflows/reg-score-advisory.yml` |
| Phase 4: calibration / golden regression | `tests/calibration.test.ts`, `tests/redaction.test.ts` |
| Phase 5: plugin capability negotiation | `tests/phases.test.ts`, `tests/operations.test.ts`, `tests/integration.test.ts` |
| Phase 6: trend / policy / retention | `tests/operations.test.ts`, `tests/redaction.test.ts` |
| 成功条件 1: scan が capability を報告 | `tests/scan.test.ts`, `tests/phases.test.ts` |
| 成功条件 2: diff が DiffReport を返す | `tests/diff.test.ts` |
| 成功条件 3: schema 参照整合性 | `tests/schema.test.ts` |
| 成功条件 4: mechanism-based clustering | `tests/assessment.test.ts`, `tests/scan.test.ts` |
| 成功条件 5: Risk Assessment が score を確定 | `tests/assessment.test.ts` |
| 成功条件 6: 言語 capability negotiation | `tests/phases.test.ts` |
| 成功条件 7: semantic 未評価 fallback | `tests/scan.test.ts` |
| 成功条件 8: redaction / retention / gate | `tests/redaction.test.ts`, `tests/phases.test.ts` |
| 成功条件 9: 全出力に根拠 | `tests/scan.test.ts`, `tests/integration.test.ts` |
| 成功条件 10: validate + 境界テスト | `npm run validate`, `tests/integration.test.ts`, `docs/verification/BOUNDARY-MATRIX.md` |
