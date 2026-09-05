# Provider Adapter 契約 v1

Phase 5 成果物。評価モデルを変えずに差し替え可能な外部依存。

## LLM Provider (`src/semantic/provider.ts`)

```ts
type SemanticProvider = {
  name: string;
  analyze(snapshot, evidence): Promise<SemanticFinding[]>;
};
```

デフォルト: `NullSemanticProvider`（LLM 無効時）。

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
