# Analyzer Plugin Contract v1

## Plugin interface

```ts
type AnalyzerPlugin = {
  id: string;
  capabilities: AnalyzerCapability[];
  extract(snapshot: RepositorySnapshot): Promise<Evidence[]>;
};
```

## Capability negotiation

- 未対応シグナルはゼロ点にせず `metadata.unevaluatedAreas` に反映する。
- 各 Evidence は `source: deterministic` と共通 `signalId` を使用する。
- 言語固有解析器は `src/plugins/analyzer.ts` に登録する。

## Versioning

プラグイン contract は `analyzer-contract` バージョンで管理する。破壊的変更時は major を上げ、Assessment Contract と独立に進化できる。
