# reg-score

reg-score は、コードベースが将来の変更でデグレを起こしやすい状態かを、決定論的なコード解析と LLM による意味解析で評価する開発者向け診断ツールです。

現在の不具合を探すのではなく、次の変更で壊れやすい構造、関係するファイル群、想定原因、優先すべき打ち手を Regression Risk Score と根拠付きのリスクマップとして示すことを目指します。

## 現在の状態

プロダクトは企画・評価設計段階です。アプリケーションコードと公開パッケージはまだありません。段階的な成果物と完了条件は [ROADMAP.md](ROADMAP.md) を参照してください。

## 目指す診断

- リポジトリ全体と評価軸ごとの Regression Risk Score
- デグレしやすい構造と関連ファイルをまとめたリスククラスター
- 想定されるトリガー変更とデグレ発生メカニズム
- コード、依存関係、テスト、変更履歴に結び付いた根拠
- 優先順位、期待効果、確認方法を伴う打ち手
- ベースラインからのリスク差分と診断の確信度

## 対象外

- 現在存在するすべてのバグの検出
- 将来の障害発生確率の保証
- テスト、型検査、静的解析、コードレビューの代替
- 根拠のない LLM 採点や自動リファクタリング

## 初期リリース方針

Node.js 22 以降で動作する TypeScript 製 CLI とし、最初は TypeScript / JavaScript リポジトリの read-only snapshot 診断に限定します。言語固有解析と LLM プロバイダーは adapter として分離し、評価契約を保ったまま段階的に対象を拡張します。

想定する将来の操作例:

```bash
reg-score scan . --format markdown
reg-score diff . --base origin/main --format json
```

## プロジェクト文書

- [PROJECT.md](PROJECT.md) — プロダクトの目的、ユーザー、成果
- [ROADMAP.md](ROADMAP.md) — フェーズ、成果物、完了条件
- [ARCHITECTURE.md](ARCHITECTURE.md) — 境界、所有権、依存方向
- [CONTEXT.md](CONTEXT.md) — 正規用語
- [CONTRIBUTING.md](CONTRIBUTING.md) — 変更ワークフロー
- [AGENTS.md](AGENTS.md) — コーディングエージェントの作業規律

## 開発要件

- Node.js 22 以降
- 現時点のガバナンスハーネスにサードパーティ依存はありません

## 検証

```bash
npm run validate
```

| コマンド | 用途 |
|---|---|
| `npm run harness:test` | ガバナンスハーネスのテスト |
| `npm run harness:validate` | リポジトリポリシーの検証 |
| `npm run harness:report` | read-only 構造レポート |

## リポジトリ

将来の GitHub リポジトリは `kaz-toc/reg-score` を想定していますが、この初期化ではリモートリポジトリの作成、push、npm 公開を行いません。
