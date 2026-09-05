# Analyzer Plugin Contract v1

## Plugin interface

```ts
type AnalyzerPlugin = {
  readonly id: string;
  readonly implementationVersion: string;
  capabilities: AnalyzerCapability[];
  extract(snapshot: RepositorySnapshot): Promise<Evidence[]>;
};

type AnalyzerCapability = {
  readonly language: SourceLanguage;
  readonly contractVersion: number;
  signals: SignalId[];
  completeness: 'full' | 'partial';
};
```

## Capability negotiation

- 未対応シグナルはゼロ点にせず `metadata.unevaluatedAreas` に反映する。
- 各 Evidence は `source: deterministic` と共通 `signalId` を使用する。
- 言語固有解析器は `src/plugins/analyzer.ts` に登録する。

## Versioning

- `AnalyzerCapability.contractVersion` は Evidence の意味・判定契約を表す。契約変更時は必ず更新する。
- `AnalyzerPlugin.implementationVersion` は同じ ID の解析実装リリースを識別する不変値であり、解析結果を変え得る実装変更時は必ず更新する。
- 両方の値はベースライン互換性 fingerprint に含まれる。関数ソース文字列からバージョンを推測しない。
- プラグイン contract は Assessment Contract と独立に進化できる。
