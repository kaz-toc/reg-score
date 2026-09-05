# ADR-0001: 軽量ガバナンスコアを使う

## Status

Accepted

## Context

新しいプロダクトは、実装が加速する前に、エージェントと人間向けの共有ルールを必要とする。文書だけでは drift し、包括的ポリシープラットフォームは実リスクが分かる前にコストを生む。

## Decision

人間の判断はリンクされた権威 Markdown 文書に置き、決定論的なリポジトリ事実のみを依存関係のない Node.js 22 ハーネスで強制する。

ファイルサイズ、ポリシー整合性、ガバナンスリンク、回帰レジストリ整合性、証拠ベースの任意 project check から始める。プロダクト固有チェックは Accepted な ADR または記録済み incident からのみ追加する。

## Consequences

開始リポジトリは、アプリケーションフレームワークを選ばずに理解可能でローカル検証できる。変更種別や主要境界など一部の分類はレビュー判断のままである。

新しいリスクを先回りして符号化しない。プロダクトは証拠が蓄積するにつれアーキテクチャとチェックを更新する必要がある。

## Alternatives

文書のみは、bypass と drift が見えないため却下した。

包括的ガバナンスプラットフォームは、セットアップ、誤検知、メンテナンスがプロダクト証拠に先行するため却下した。

## Enforcement

[AGENTS.md](../../AGENTS.md)、[ARCHITECTURE.md](../../ARCHITECTURE.md)、[CONTRIBUTING.md](../../CONTRIBUTING.md)、`harness.config.json`、`npm run harness:validate` がこの決定を強制する。
