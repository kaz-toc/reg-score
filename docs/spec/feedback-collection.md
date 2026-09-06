# 診断フィードバック収集形式 v1

チームが診断の有用性を記録し、校正データへ反映するための JSON 形式。

```json
{
  "schemaVersion": 1,
  "reportInputId": "8bdc00e7b38300bb",
  "submittedAt": "2026-09-05T14:00:00.000Z",
  "outcome": "false-positive",
  "clusterId": "cluster:structural-fragility",
  "signalId": "dep-cycle",
  "notes": "既知の許容サイクル。実際のデグレは発生していない。",
  "linkedIncident": "optional-issue-or-hotfix-id"
}
```

## outcome 値

| 値 | 意味 |
|---|---|
| `confirmed-risk` | 診断どおりデグレが発生または発生しそうだった |
| `false-positive` | リスクは過大評価だった |
| `missed-risk` | 診断が見逃したデグレが発生した |
| `helpful` | 打ち手が有効だった |
| `not-actionable` | 根拠は正しいが実行可能でなかった |

保存先: `.r3-doctor/feedback/*.json`（gitignore 推奨）
