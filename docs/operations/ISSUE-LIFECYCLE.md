# Issue ライフサイクル

## 実装 Issue

すべての Issue は次を述べること。

1. **Deliverable（成果物）:** 独立してレビュー可能な 1 成果
2. **Invariant（不変条件）:** ユーザー可視またはアーキテクチャ上の 1 事実
3. **Change kind（変更種別）:** Behavior、Structural、Defect、Test、Docs
4. **Primary boundary（主要境界）:** 主に変更する境界
5. **Dependencies（依存）:** 実際の blocker のみ
6. **Acceptance criteria（受け入れ基準）:** 観測可能な完了条件
7. **Verification（検証）:** 正確なコマンドと手動証拠
8. **Non-goals（対象外）:** 意図的に除外する近接作業

レビュアが 1 成果を承認しながら別成果を却下できる場合は、作業を分割する。

## Frontier

すべての blocker が完了したときのみ Issue は ready である。順序の希望は blocker ではない。

## Defect

確認済み欠陥は [incident ledger](../incidents/LEDGER.md) を更新し、[回帰契約ワークフロー](../testing/REGRESSION-CONTRACTS.md) に従う。

## Closure

すべての受け入れ基準に証拠がある場合のみ Issue を close する。調査で作業が不要と判明した場合は、証拠を記録し、推測的実装なしで close する。
