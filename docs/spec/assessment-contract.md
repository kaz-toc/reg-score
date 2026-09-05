# 評価契約 v1

`schemaVersion: 1` の Assessment Contract。スコアは障害発生確率ではなく、同一契約内の優先順位と時系列比較に用いる相対指標である。

## 評価軸

| 軸 ID | 名称 | 方向 | 主シグナル |
|---|---|---|---|
| `structural-fragility` | Structural Fragility | 高いほど危険 | 循環依存、fan-out、責務混在 |
| `change-blast-radius` | Change Blast Radius | 高いほど危険 | 推移依存、共有契約、高 fan-in |
| `verification-gap` | Verification Gap | 高いほど危険 | テスト欠落、境界テスト不足 |
| `change-volatility` | Change Volatility | 高いほど危険 | churn、修正反復 |
| `semantic-ambiguity` | Semantic Ambiguity | 高いほど危険 | LLM 意味所見（決定論のみ時は未評価） |

## スコア集約

1. 各軸は 0–100。シグナル重み付き平均で算出。
2. Repository Regression Risk Score は軸スコアの加重平均。デフォルト重みは均等（各 0.2）。
3. 重大クラスターがある場合、クラスター最大スコアの 30% をブレンドし、局所リスクを隠さない。
4. 未評価軸は集約から除外し、確信度を下げる。ゼロ点として扱わない。

## 確信度

`confidence` は 0–1。次を反映する:

- 利用できた決定論シグナル数 / 期待シグナル数
- LLM 意味解析の有無
- Git 履歴の利用可否
- 解析上限による truncation の有無

## リスククラスター

同一 `failureMechanism` に関与するファイル群。クラスタースコアは関連シグナルの最大値と平均の混合。

## 比較規則

- `assessmentContractVersion` が一致するベースラインのみ差分可能。
- 契約不一致時は `riskDelta` を出力せず、警告を付与する。

## 表示上の免責

すべてのレポートに次を含める:

> Regression Risk Score は将来のデグレ発生確率を保証しません。根拠と確信度とともに優先順位付けに使用してください。
