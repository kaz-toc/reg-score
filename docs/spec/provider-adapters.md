# Provider Adapter 契約 v1

Phase 5 成果物。評価モデルを変えずに差し替え可能な外部依存。

## LLM Provider (`src/semantic/provider.ts`)

```ts
type SemanticProvider = {
  readonly name: string;
  readonly implementationVersion: string;
  analyze(snapshot, evidence): Promise<SemanticFinding[]>;
};
```

デフォルト: `NullSemanticProvider`（LLM 無効時）。

`implementationVersion` は同じ provider 名の実装リリースを識別する不変値である。意味所見またはスコアを変え得る実装・モデル契約変更時は必ず更新し、ベースライン互換性 fingerprint に含める。関数ソース文字列からバージョンを推測しない。

## Git Provider (`src/adapters/git-provider.ts`)

```ts
type GitProvider = {
  listChangedFiles(repositoryPath, baseRef): Promise<string[]>;
  resolveHeadCommit(repositoryPath): Promise<string | undefined>;
};
```

差分診断とトレンド記録が利用。

## Reporter Adapter (`src/adapters/reporter.ts`)

```ts
type ReporterAdapter = {
  format(report, 'json' | 'markdown' | 'console'): string;
};
```

CI summary や CLI 出力の形式を拡張可能。
