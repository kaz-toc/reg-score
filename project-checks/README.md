# Project Checks

このディレクトリはプロダクト固有アーキテクチャチェックの拡張点です。テンプレートには意図的に何も含まれません。

設定された `.mjs` モジュールは次を export します。

```js
export async function check({ root, config }) {
  return [
    {
      checkId: 'architecture/example',
      path: 'src/example.ts',
      message: 'describe the violated invariant',
      line: 1
    }
  ];
}
```

Accepted な ADR または記録済み incident が 1 つの具体的制約を定義した場合のみチェックを追加する。リポジトリ相対パスを `harness.config.json` に列挙する。
