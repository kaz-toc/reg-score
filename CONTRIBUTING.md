# コントリビューション

## コード変更前

[PROJECT.md](PROJECT.md)、[ARCHITECTURE.md](ARCHITECTURE.md)、[CONTEXT.md](CONTEXT.md)、関連する [ADR](docs/adr/) を読む。リポジトリの状態を確認し、checkout が共有される可能性がある場合は実装作業を隔離する。

## Issue の形

実装 Issue には、1 成果物、1 不変条件、1 主要境界、実際の blocker、受け入れ基準、正確な検証、明示的な non-goal を含める。詳細は [Issue ライフサイクル](docs/operations/ISSUE-LIFECYCLE.md) を参照。

## 変更種別

- `Behavior` — ユーザー可視の振る舞いまたは外部契約を意図的に変更する
- `Structural` — 振る舞いを保ったまま内部構造を変更する
- `Defect` — すでに期待されていた振る舞いを復元する
- `Test` — 本番振る舞いを変えず実行可能な検証のみを変更する
- `Docs` — ドキュメントのみを変更する

## プルリクエスト

プルリクエストは 1 変更種別と 1 主要境界を記録する。追加境界には、作業を分割できない具体的理由が必要。無関係な変更を入れず、既存チェックを維持する。

## 回帰ワークフロー

確認済み欠陥は incident ledger を更新し、[回帰契約](docs/testing/REGRESSION-CONTRACTS.md) で説明される active ケースを追加または強化する。まず失敗するテストまたは同等の mutant を示し、最小の修正を実装する。

## 境界別検証

[境界マトリクス](docs/verification/BOUNDARY-MATRIX.md) を使う。パッケージ化 dogfood と認証済み canary は、変更された境界に条件付きであり、すべての PR の universal gate ではない。証拠または具体的な `N/A` 理由を記録する。

## 完了

開発中は狭いテストを実行し、次を実行する。

```bash
npm run validate
```

コマンドと結果を報告する。古いまたは部分的な証拠だけで完了を主張しない。
