# PR #2 レビュー修正設計

## 目的

PR #2 の再レビューで確認された、保存先境界、baseline 比較、redaction、semantic provider、capability、calibration policy、CI 検証の欠陥を、既存の Repository Intake、Risk Assessment、Reporting 境界を維持して修正する。

本変更は未リリース版を対象とする。旧 baseline、trend、calibration データとの後方互換は提供せず、旧形式は明示的な契約不一致または schema error として扱う。

## 非目標

- 実 LLM provider の追加
- 新しいリスクシグナルまたはスコア方式の追加
- GitHub Actions 以外の CI provider 対応
- 旧永続化形式の自動 migration

## 境界

```text
Repository Intake ─> Evidence / Semantic ─> Risk Assessment
                                              │
                                              v
Git + Baseline Store ─> Comparison ─> Diff Report ─> Reporting
                               │
Policy + Calibration ──────────┘
```

- Risk Assessment は単一診断の score、axis、cluster、confidence を所有する。
- Comparison は二つの比較可能な診断の選択、signal change、risk delta を所有する。
- Persistence は baseline、trend、retention と保存先境界を所有する。
- Reporting は Diff Report を変更せず、console、Markdown、JSON、GitHub形式へ変換する。
- Pipeline は各境界の呼び出し順だけを所有する。

## 保存先と retention

### 保存先検証

baselineDir と trendDir はリポジトリ相対パスに限定する。保存または削除の前に次をすべて検証する。

1. lexical にリポジトリ配下である。
2. 既存の各 path component が symbolic link ではない。
3. directory 作成後の realpath が repository realpath 配下である。
4. 削除対象が検証済み storage directory の直下にある通常ファイルである。

検証失敗は `ConfigError` とし、書込み・削除は一切行わない。retention は再帰削除を使わない。

### baseline retention

baseline entryは1ファイル1entryとし、期限切れの通常JSONファイルだけを削除する。対象外拡張子、directory、symbolic linkは変更しない。

### trend retention

`history.jsonl` を行単位でschema検証し、`generatedAt` が期限内のentryだけを同一directory内のtemporary fileへ書き、renameする。破損行は行番号付きerrorとし、履歴全体を消去しない。

retention結果は、対象種別、理由、削除entry数を含む構造化結果として返す。CLIは結果をstderrの監査メッセージへ変換する。

`saveBaseline` と `appendTrend` は保存先とretention監査結果を含む `PersistenceResult` を返す。保存処理自身はstderrへ書かず、CLI境界だけが監査メッセージを表示する。

## Baseline契約とDiff

### Baseline Entry

baseline entryは次の比較metadataを必須とする。

```ts
type BaselineEntry = {
  schemaVersion: 2;
  inputId: string;
  generatedAt: string;
  assessmentContractVersion: number;
  sourceCommitSha?: string;
  redactionPolicyFingerprint: string;
  report: DiagnosisReport;
};
```

Git repositoryで保存する場合は`sourceCommitSha`を必須とする。非Git repositoryでは省略できるが、Git refを指定するDiffの比較baselineには使用できない。

旧schemaや旧assessment contractのentryは黙って無視せず、要求されたbaseに該当する場合は明示的なschemaまたはcontract mismatchを返す。

### Baseline選択

`--base`をcommit SHAへ解決し、同じ`sourceCommitSha`を持つ最新baselineだけを比較対象にする。該当baselineがない場合はscoreとsignal比較を抑止する。

Diff Report schemaをv2へ更新し、`base`をoptionalにする。compatibleな場合、`DiffReport.base`、`riskDelta`、signal changes、`baselineId`はすべて同じ保存baselineから導出する。比較可能な保存baselineがない場合は`base`を省略する。Git baseの再解析は行わず、Git refは変更ファイルの列挙とbaseline commitの照合にだけ使用する。

### Redactionと比較

baseline reportは保存前にredactする。baselineにはredaction policyを正規化したfingerprintを保存する。

Diff時は現在policyのfingerprintがbaselineと一致する場合だけ比較する。比較用にcurrent reportのコピーへ同じredactionを適用し、保存baselineと比較する。raw current reportは変更しない。policy fingerprintが異なる場合は比較を抑止し、理由を返す。

## Semantic Provider

名前だけを登録するglobal registryは削除する。既定factoryは、LLM無効、provider未指定、実装未注入のすべてを`unavailable`として返す。

実providerは既存の`SemanticProviderFactory` interfaceを依存注入して利用する。availableを返すfactoryは、実際の`SemanticProvider` instanceを返さなければならない。

## Capability

capability negotiationは言語だけでなくsnapshotの実行環境を考慮する。Gitが利用できないsnapshotでは`git-churn`をsupportedSignalsから外し、対応axisを未評価として扱う。他の言語で同axisを評価できる場合だけaxis全体を評価済みにする。

Risk Assessmentはplugin実装helperへ依存せず、versioned `CapabilityResult`だけからaxisの評価可否を決める。

## Calibration Policy

policyに`requiredCalibrationConditions: string[]`、calibration datasetに`satisfiedConditions: string[]`を追加する。gate eligibilityは既存の必須品質条件に加え、policyの全required conditionがdatasetで満たされる場合だけtrueとする。

conditionは空文字を禁止し、重複を正規化またはschema errorにする。旧calibration形式は後方互換を提供せずschema errorとする。

## CIとテスト

Gitを使うテストはambient checkoutへ依存しない。各テストがtemporary directoryでGit repositoryを初期化し、user設定、base/currentの2コミット、必要なbaselineを構築する。

追加する回帰契約:

- storage directoryおよび途中componentがsymlinkの場合、外部ファイルを変更しない。
- trend retentionは期限切れentryだけを除去し、期限内entryを保持する。
- `--base`とbaseline commitが一致しない場合、比較を抑止する。
- compatible時は`base.score + riskDelta === current.score`になる。
- redaction対象を含む同一診断同士でsignal changesが空になる。
- 旧baselineは`no baseline`ではなく明示的なmismatch/errorになる。
- 未注入semantic providerはunavailable、注入providerだけがavailableになる。
- non-Git snapshotではgit-churnが未評価になる。
- policy追加条件の不足時はgateEligibleがfalseになる。
- shallow checkout相当でも全テストが成功する。

## 完了条件

1. 上記回帰テストを修正前に失敗させ、修正後に成功させる。
2. `npm run validate`がNode 22の通常checkoutとdepth 1 checkoutで成功する。
3. `reg-score diff`のbaselineなし、一致、不一致、redactionありをCLI smoke testする。
4. symlink escape再現で外部fixtureが保持される。
5. `npm pack --dry-run`と`git diff --check`が成功する。
6. PRのrequired checksが成功する。
