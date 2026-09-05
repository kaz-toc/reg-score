# エージェント作業規約

このファイルは権限と作業規律を定義します。アーキテクチャ規則は [ARCHITECTURE.md](ARCHITECTURE.md) にあり、ここでは重複して記載しません。現行の権威文書はリポジトリルートと `docs/` の日本語版です。

## 必読

本番コードを変更する前に、次を読むこと。

1. [PROJECT.md](PROJECT.md) — プロダクトの目的とコマンド
2. [ARCHITECTURE.md](ARCHITECTURE.md) — 境界、所有権、DDD、SOLID、依存関係
3. [CONTEXT.md](CONTEXT.md) — 正規用語
4. [CONTRIBUTING.md](CONTRIBUTING.md) — 変更ワークフロー
5. [docs/adr/](docs/adr/) の関連する Accepted な決定
6. [回帰契約](docs/testing/REGRESSION-CONTRACTS.md) と [境界検証マトリクス](docs/verification/BOUNDARY-MATRIX.md)

## 権限

観察、診断、計画、実装は別の依頼である。想定外の挙動の報告だけではファイルを変更しない。実装が明示的に依頼された場合のみ変更する。

依頼された範囲内に留まる。無関係な欠陥は報告し、修正しない。既存のユーザー変更を保持し、排他的な所有が確立されていない限り共有 checkout を前提とする。

## 変更規律

- 書き込む前にリポジトリの状態を確認する。
- checkout が共有される可能性がある場合は、隔離されたブランチまたは worktree を使う。
- 現在の default ブランチから開始する。merge 済みブランチを再利用しない。
- 1 プルリクエストにつき、1 成果物、1 不変条件、1 主要境界を保つ。
- 無関係なクリーンアップ、権限変更、CI 緩和、依存更新を混ぜない。
- Behavior および Defect 変更では test-first 開発を使う。
- 確認済み欠陥は実行可能な回帰契約を追加または強化する。
- Accepted な移行 ADR が別途定める場合を除き、置き換えられたパスは同一変更内で削除する。
- アーキテクチャチェックは Accepted な ADR または記録済み incident のみに追加する。

## 検証

開発中は狭いテストを実行し、完了を主張する前にリポジトリの完全な検証コマンドを実行する。

```bash
npm run validate
```

[docs/verification/BOUNDARY-MATRIX.md](docs/verification/BOUNDARY-MATRIX.md) で、パッケージ化、認証、UI、永続化、ポリシーの証拠を選ぶ。非該当の項目にはすべて具体的な理由を記録する。

## 外部操作

明示的な権限なしに、commit、push、merge、GitHub 項目の close/編集、公開、デプロイ、メッセージ送信、プラン変更、外部システムの変更を行わない。

破壊的操作の前に、正確な対象を特定し、復旧可能な証拠を保持する。検証を通すためだけにチェックを弱めない。
