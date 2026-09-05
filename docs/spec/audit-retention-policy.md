# 診断結果の保持・秘匿化・監査ポリシー

## 保持

| データ | 既定保存先 | 保持期間 |
|---|---|---|
| ベースライン | `.reg-score/baselines/` | `policy.retentionDays` |
| トレンド | `.reg-score/trends/history.jsonl` | `policy.retentionDays` |
| 校正 | `.reg-score/calibration.json` | リポジトリ寿命 |
| フィードバック | `.reg-score/feedback/` | チーム判断（秘匿推奨） |

## 秘匿化

- `policy.redactPaths` に一致するパスはレポート出力前にマスクする。
- LLM 送信は `llm.enabled: true` かつ `llm.maxFiles` 以内のファイルに限定する。
- 外部送信は adapter 経由のみ。デフォルトは local-first（LLM 無効）。

## 監査

- CI gate 判断は `policy --evaluate` の `reasons` 配列を PR に記録する。
- gate は `requireCalibration: true` かつ `calibration.gateEligible` のときのみ失敗可能。
- 判断根拠は人間が `npm run reg-score -- policy <path> --evaluate` で再現できる。
