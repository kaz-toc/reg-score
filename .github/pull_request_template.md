## 変更宣言

Change-Kind: Behavior | Structural | Defect | Test | Docs
Primary-Boundary:
Additional-Boundaries: none
Regression-Contract: none
Regression-Rationale:

## Invariant（不変条件）

- [ ] このプルリクエストは、ユーザー可視またはアーキテクチャ上の 1 不変条件を変更または保護する。
- [ ] 追加境界は、作業を分割できない具体的理由とともに列挙されている。

## Scope（範囲）

- [ ] diff に無関係なクリーンアップ、権限変更、ポリシー緩和、依存更新は含まれない。
- [ ] 置き換えられたパスは削除されているか、Accepted な移行 ADR が一時的な保持を説明している。

## Test-first evidence（test-first 証拠）

- [ ] Behavior と Defect 変更には、以前の振る舞いまたは同等 mutant で失敗したテストがある。
- [ ] Structural 変更は影響を受ける自動テストと回帰テストを維持する。

## Verification（検証）

- [ ] `npm run validate`
- [ ] [境界マトリクス](../docs/verification/BOUNDARY-MATRIX.md) で要求される証拠を以下に記録した。
- [ ] すべての `N/A` 結果に具体的理由がある。

### Evidence（証拠）

コマンド、結果、パッケージビルド、UI 観測、canary 実行、または `N/A` 理由を列挙する。
