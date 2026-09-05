# 回帰契約

回帰契約は、確認済み incident を 1 つの観測可能な不変条件と実行可能な証拠に結びます。

## ワークフロー

1. [ledger](../incidents/LEDGER.md) に incident を記録する。
2. 1 つの観測可能な不変条件を定義する。
3. 既知の bad behavior または同等 mutant で失敗するテストを書く。
4. 最小の修正を適用する。
5. `test-fixtures/regressions/REG-YYYY-NNN/case.json` を作成する。
6. ケースの verification コマンドと `npm run validate` を実行する。
7. ledger の保護状態を更新する。

## ケース形式

```json
{
  "schemaVersion": 1,
  "id": "REG-2026-001",
  "status": "active",
  "title": "Short user-visible failure description",
  "invariant": "One observable behavior that must remain true",
  "incident": "https://github.com/owner/repository/issues/123",
  "productionFiles": ["src/example.ts"],
  "testFiles": ["tests/example.test.ts"],
  "verificationCommands": ["npm test"]
}
```

active ケースは参照ファイルの存在と、すべてのテストファイルにケース ID のリテラルが含まれることを要求する。`retired` は、Accepted な置き換えまたは削除されたプロダクト振る舞いが、不変条件がもはや適用されない理由を説明できる場合のみ使う。

テンプレートには偽の active ケースは含まれません。
