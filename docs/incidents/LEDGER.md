# Incident Ledger

テンプレートにはプロダクト incident は含まれません。コピー先プロダクトは、確認済みのユーザー影響障害ごとに 1 行追加します。

## 保護状態

- `protected`: 既知の bad behavior または同等 mutant に対して実行可能テストが失敗し、active 回帰ケースが証拠を結ぶ
- `partially protected`: 関連パスの一部はテストされているが、元の観測可能な障害が証明されていない
- `unprotected`: 既知の障害を検出する実行可能契約がない

## Ledger

| Incident | User impact | Status | Root cause | Fix | Regression contract | Protection | Follow-up |
|---|---|---|---|---|---|---|---|

証拠なしに root cause を推測しない。調査で確定するまで `unknown` を使う。
