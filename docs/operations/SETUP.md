# セットアップ手順

この文書は、r3-doctor を**新しいプロダクトのリポジトリ**として初期化する手順です。スケルトン名やテンプレート URL がハードコードされている箇所を、コピー先のプロダクト identity に置き換えることが中心になります。

## 事前に決めること

| 項目 | 例 | 用途 |
|------|-----|------|
| 表示名 | My Product | README タイトル、PROJECT.md |
| リポジトリ名（kebab-case） | `my-product` | `package.json` の `name`、ディレクトリ名、GitHub リポジトリ |
| 初期ランタイム | Node.js 22 + TypeScript | PROJECT.md、CI、harness の `sourceRoots` |

表示名とリポジトリ名は一致させる必要はありません。機械可読な識別子は kebab-case のリポジトリ名を使います。

## 1. コピーする

```bash
git clone https://github.com/kaz-toc/r3-doctor.git my-product
cd my-product
rm -rf .git
```

または `cp -r` でコピーし、`.git` を削除します。

## 2. 自動セットアップ（推奨）

```bash
npm run setup -- --kebab my-product --display "My Product" --github my-org/my-product --init-git --yes
```

`npm run setup` が次を実行します。

| 自動 | 内容 |
|------|------|
| yes | `archive/`、`DESIGN.md`、`PLAN.md`、`.cursorignore` の削除 |
| yes | README / package.json / SETUP.md 等のテンプレート名・URL 置換 |
| yes | `PROJECT.md` の TODO 付き scaffold 生成 |
| yes | 置換漏れ検査（`scripts/setup-product.mjs` を除く） |
| yes | `npm run validate` |
| `--init-git` 時 | `.git` が無い場合に `git init -b main` |

シェルラッパー: [`scripts/setup-product.sh`](../../scripts/setup-product.sh)

### 手動で残る作業

1. `PROJECT.md` の TODO を埋める
2. [`CONTEXT.md`](../../CONTEXT.md) にドメイン用語を定義する
3. [`ARCHITECTURE.md`](../../ARCHITECTURE.md) のテンプレート境界表を置き換える
4. [`harness.config.json`](../../harness.config.json) の `sourceRoots` / `sourceExtensions` を調整する
5. [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) にプロダクト build / test を追加する
6. GitHub Issue フォームで最初の vertical-slice Issue を作成する
7. ベースライン commit、remote 追加、push、branch protection の判断

## 3. 手動セットアップ（参考）

自動セットアップを使わない場合の手順です。

### テンプレート専用の削除（推奨）

コピー先で通常は不要なものです。

| パス | 理由 |
|------|------|
| `archive/` | 英語版スナップショット。現行 authority ではない |
| `DESIGN.md` / `PLAN.md` | スケルトン設計・実装履歴（メタ情報） |

削除後、`.cursorignore` から `archive/en/` 行を削除して構いません。

### プロダクト identity の置き換え（必須）

次の文字列が残っていないか確認します。

- `r3-doctor`（表示名）
- `r3-doctor`（kebab-case 識別子）
- `kaz-toc/r3-doctor`（テンプレート GitHub URL）

検索例:

```bash
rg -n 'r3-doctor|r3-doctor|kaz-toc/r3-doctor' .
```

### 必ず更新するファイル

| ファイル | 変更内容 |
|----------|----------|
| [`README.md`](../../README.md) | タイトル、概要の説明、ディレクトリツリー例、clone URL 例 |
| [`PROJECT.md`](../../PROJECT.md) | プロダクト、ユーザー、成果、ランタイム、コマンド各節を実プロダクト向けに全面置換 |
| [`package.json`](../../package.json) | `"name"` をコピー先リポジトリ名に変更 |

### プロダクト内容に合わせて更新するファイル

| ファイル | 変更内容 |
|----------|----------|
| [`CONTEXT.md`](../../CONTEXT.md) | ドメイン用語と禁止同義語 |
| [`ARCHITECTURE.md`](../../ARCHITECTURE.md) | 境界表、依存方向、所有権 |
| [`harness.config.json`](../../harness.config.json) | `sourceRoots`、`sourceExtensions`（例: `src` を追加） |
| [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) | プロダクトの build / test コマンドを追加 |

### 変更不要なもの

| パス | 理由 |
|------|------|
| `harness/` 本体 | プロダクト名に依存しない。`npm run harness:test` はコピー先でもそのまま動く |
| `harness/governance.mjs` | 日本語見出し検証。文書を日本語のまま使う限り変更不要 |
| `docs/adr/0001-lightweight-governance-core.md` | 軽量ガバナンスコアの決定。多くのプロダクトでそのまま有効 |
| Issue / PR テンプレート | `Behavior` など機械可読タグは英語固定 |

`harness/__tests__/` 内の一時ディレクトリ prefix は `harness-fixture-` であり、プロダクト名とは無関係です。

## 4. ガバナンス文書を初期化する

1. [`PROJECT.md`](../../PROJECT.md) の初期化ルールに従い、テンプレート identity を削除する。
2. [`ARCHITECTURE.md`](../../ARCHITECTURE.md) のテンプレート境界（ガバナンス文書 / ガバナンスハーネス）を、プロダクト固有の境界に置き換える。
3. 最初の永続的な技術選択がある場合は [`docs/adr/`](../../docs/adr/) に ADR を追加する（スケルトン ADR-0001 は残してよい）。

## 5. アプリケーションコードを追加する

```text
src/                 # 例: アプリケーションソース
tests/               # 例: プロダクトテスト
```

`harness.config.json` の `sourceRoots` に追加したパスが、ファイルサイズチェックと policy チェックの対象になります。

## 6. CI を拡張する

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) の `validate` job に、プロダクトの build / test ステップを追加します。ガバナンス検証（`npm run harness:test` / `npm run harness:validate`）は残します。

## 7. ベースラインを確立する

1. GitHub Issue フォーム（Implementation slice）で最初の vertical-slice Issue を 1 件作成する。
2. 次を実行する。

```bash
npm run validate
```

3. 成功したらベースラインを commit する。
4. リモートを追加して push する。
5. 必要なら branch protection または ruleset を設定する。


## 検証に失敗したとき

| 症状 | 確認先 |
|------|--------|
| `governance/missing-heading` | 権威文書の見出しが `harness/governance.mjs` と一致しているか |
| `governance/broken-link` | Markdown 相対リンクのパス |
| `governance/authority-link` | `AGENTS.md` / `CONTRIBUTING.md` の必須リンク |
| `file-size` | 800 非空行超過。責務境界で分割する |
| テンプレート名の残存 | 上記 `rg` コマンドで置換漏れを探す |

## 関連文書

- [README — 利用方法](../../README.md#利用方法)
- [PROJECT.md — 初期化ルール](../../PROJECT.md)
- [CONTRIBUTING.md](../../CONTRIBUTING.md)
- [DESIGN.md §13 ブートストラップ](../../DESIGN.md)（スケルトン設計上の手順）
