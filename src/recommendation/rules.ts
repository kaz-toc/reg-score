import type { Evidence, Intervention, RiskCluster, SignalId } from '../schema/report.v1.js';

const RULES: Array<{
  signalId: SignalId;
  kind: Intervention['kind'];
  title: string;
  description: string;
  expectedEffect: string;
  verification: string;
  cost: Intervention['cost'];
  priority: number;
}> = [
  {
    signalId: 'dep-cycle',
    kind: 'structure',
    title: '循環依存を解消する',
    description: '依存方向を一方向に整理し、共有契約を境界モジュールへ移す。',
    expectedEffect: 'structural-fragility と change-blast-radius の低下',
    verification: 'reg-score scan を再実行し dep-cycle シグナルが消えること',
    cost: 'medium',
    priority: 1,
  },
  {
    signalId: 'missing-test-pair',
    kind: 'test',
    title: '変更前に境界テストを追加する',
    description: '高 fan-in モジュールまたは共有契約に対し、回帰を検出するテストを先に追加する。',
    expectedEffect: 'verification-gap の低下',
    verification: 'missing-test-pair が解消され、関連クラスタースコアが下がること',
    cost: 'low',
    priority: 2,
  },
  {
    signalId: 'high-fan-in',
    kind: 'structure',
    title: '共有モジュールの表面積を縮小する',
    description: '公開 API を狭め、内部実装を隠蔽するファサードを導入する。',
    expectedEffect: 'change-blast-radius の低下',
    verification: 'fan-in カウントとクラスタースコアの再診断',
    cost: 'high',
    priority: 3,
  },
  {
    signalId: 'large-file',
    kind: 'structure',
    title: '責務ごとにモジュールを分割する',
    description: '単一ファイルへの責務集中を解消し、変更単位を小さくする。',
    expectedEffect: 'structural-fragility の低下',
    verification: 'large-file シグナル解消とファイル行数の低下',
    cost: 'medium',
    priority: 4,
  },
  {
    signalId: 'git-churn',
    kind: 'process',
    title: '高 churn 領域の変更手順を固定する',
    description: '頻繁に壊れる領域に対し、変更チェックリストと小さな PR 単位を強制する。',
    expectedEffect: 'change-volatility の安定化',
    verification: '次回診断で churn シグナルが減少すること',
    cost: 'low',
    priority: 5,
  },
];

export function buildInterventions(evidence: Evidence[], clusters: RiskCluster[]): Intervention[] {
  const interventions: Intervention[] = [];
  let counter = 0;

  for (const rule of RULES) {
    const linkedEvidence = evidence.filter((item) => item.signalId === rule.signalId);
    if (linkedEvidence.length === 0) {
      continue;
    }
    counter += 1;
    const targetPaths = [...new Set(linkedEvidence.map((item) => item.path).filter(Boolean) as string[])].sort();
    const linkedClusters = clusters
      .filter((cluster) => cluster.evidenceIds.some((id) => linkedEvidence.some((e) => e.evidenceId === id)))
      .map((cluster) => cluster.clusterId);

    interventions.push({
      interventionId: `intervention:${rule.signalId}`,
      priority: rule.priority,
      title: rule.title,
      description: rule.description,
      kind: rule.kind,
      targetPaths,
      linkedSignalIds: [rule.signalId],
      linkedClusterIds: linkedClusters,
      expectedEffect: rule.expectedEffect,
      verification: rule.verification,
      cost: rule.cost,
    });
  }

  return interventions.sort((a, b) => a.priority - b.priority);
}
