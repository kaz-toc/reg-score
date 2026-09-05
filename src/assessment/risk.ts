import type {
  AxisAssessment,
  DiagnosisReport,
  Evidence,
  Intervention,
  RiskAxisId,
  RiskCluster,
  SemanticFinding,
} from '../schema/report.v1.js';
import {
  ASSESSMENT_CONTRACT_VERSION,
  REPORT_SCHEMA_VERSION,
  SCORE_DISCLAIMER,
  diagnosisReportSchema,
} from '../schema/report.v1.js';
import type { RepositorySnapshot } from '../intake/snapshot.js';

const AXIS_NAMES: Record<RiskAxisId, string> = {
  'structural-fragility': 'Structural Fragility',
  'change-blast-radius': 'Change Blast Radius',
  'verification-gap': 'Verification Gap',
  'change-volatility': 'Change Volatility',
  'semantic-ambiguity': 'Semantic Ambiguity',
};

const SEVERITY_WEIGHT = { low: 1, medium: 2, high: 3 } as const;

function axisScoreForEvidence(items: Evidence[]): number {
  if (items.length === 0) {
    return 0;
  }
  const total = items.reduce((sum, item) => sum + SEVERITY_WEIGHT[item.severity], 0);
  return Math.min(100, Math.round((total / items.length) * 25));
}

function clusterScore(items: Evidence[]): number {
  if (items.length === 0) {
    return 0;
  }
  const max = Math.max(...items.map((item) => SEVERITY_WEIGHT[item.severity] * 25));
  const avg = items.reduce((sum, item) => sum + SEVERITY_WEIGHT[item.severity] * 25, 0) / items.length;
  return Math.min(100, Math.round(max * 0.6 + avg * 0.4));
}

function buildClusters(evidence: Evidence[]): RiskCluster[] {
  const byAxis = new Map<RiskAxisId, Evidence[]>();
  for (const item of evidence) {
    const list = byAxis.get(item.axisId) ?? [];
    list.push(item);
    byAxis.set(item.axisId, list);
  }

  const clusters: RiskCluster[] = [];
  for (const [axisId, items] of byAxis.entries()) {
    if (items.length === 0) {
      continue;
    }
    const paths = [...new Set(items.map((item) => item.path).filter(Boolean) as string[])].sort();
    clusters.push({
      clusterId: `cluster:${axisId}`,
      title: `${AXIS_NAMES[axisId]} クラスター`,
      score: clusterScore(items),
      confidence: Math.min(1, items.length / 5),
      axisId,
      paths,
      failureMechanism: `${AXIS_NAMES[axisId]} に関連する構造上の弱点が、小さな変更を広範囲の振る舞い変化へ波及させる。`,
      triggerChanges: [
        '共有モジュールの API 変更',
        '依存関係の追加・削除',
        'テスト未整備領域のリファクタリング',
      ],
      evidenceIds: items.map((item) => item.evidenceId),
    });
  }

  return clusters.sort((a, b) => b.score - a.score);
}

function aggregateRepositoryScore(axes: AxisAssessment[], clusters: RiskCluster[]): number {
  const evaluated = axes.filter((axis) => !axis.unevaluated);
  if (evaluated.length === 0) {
    return 0;
  }
  const axisAvg = evaluated.reduce((sum, axis) => sum + axis.score, 0) / evaluated.length;
  const maxCluster = clusters.length > 0 ? Math.max(...clusters.map((c) => c.score)) : 0;
  return Math.min(100, Math.round(axisAvg * 0.7 + maxCluster * 0.3));
}

function computeConfidence(
  evidence: Evidence[],
  semanticFindings: SemanticFinding[],
  snapshot: RepositorySnapshot,
  axes: AxisAssessment[],
): number {
  const expectedAxes = 5;
  const evaluatedAxes = axes.filter((axis) => !axis.unevaluated).length;
  let confidence = evaluatedAxes / expectedAxes;
  if (evidence.length > 0) {
    confidence = Math.min(1, confidence + 0.2);
  }
  if (semanticFindings.length > 0) {
    confidence = Math.min(1, confidence + 0.1);
  }
  if (!snapshot.gitAvailable) {
    confidence -= 0.1;
  }
  if (snapshot.truncated) {
    confidence -= 0.15;
  }
  return Math.max(0, Math.min(1, Number(confidence.toFixed(2))));
}

export type AssessmentInput = {
  snapshot: RepositorySnapshot;
  evidence: Evidence[];
  semanticFindings: SemanticFinding[];
  analyzers: string[];
  llmProvider?: string;
  baselineScore?: number;
  baselineId?: string;
  contractMismatch?: boolean;
};

export function assessRisk(input: AssessmentInput): DiagnosisReport {
  const axisIds = Object.keys(AXIS_NAMES) as RiskAxisId[];
  const axes: AxisAssessment[] = axisIds.map((axisId) => {
    const axisEvidence = input.evidence.filter((item) => item.axisId === axisId);
    const semantic = input.semanticFindings.filter((item) => item.axisId === axisId);
    const unevaluated = axisId === 'semantic-ambiguity' && semantic.length === 0 && !input.snapshot.config.llm.enabled;
    const score = unevaluated ? 0 : Math.max(axisScoreForEvidence(axisEvidence), semantic.length > 0 ? 20 : 0);
    const confidence = unevaluated ? 0 : Math.min(1, axisEvidence.length / 3);
    return {
      axisId,
      name: AXIS_NAMES[axisId],
      score,
      contribution: 0,
      confidence: Number(confidence.toFixed(2)),
      unevaluated,
    };
  });

  const clusters = buildClusters(input.evidence);
  const repositoryScore = aggregateRepositoryScore(axes, clusters);
  const totalContribution = axes.filter((a) => !a.unevaluated).reduce((sum, a) => sum + a.score, 0) || 1;
  for (const axis of axes) {
    axis.contribution = axis.unevaluated ? 0 : Number((axis.score / totalContribution).toFixed(2));
  }

  const confidence = computeConfidence(input.evidence, input.semanticFindings, input.snapshot, axes);
  const unevaluatedAreas = axes.filter((a) => a.unevaluated).map((a) => a.name);
  if (!input.snapshot.gitAvailable) {
    unevaluatedAreas.push('Git churn (git unavailable)');
  }

  const report: DiagnosisReport = {
    metadata: {
      schemaVersion: REPORT_SCHEMA_VERSION,
      assessmentContractVersion: ASSESSMENT_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      inputId: input.snapshot.inputId,
      repositoryPath: input.snapshot.repositoryPath,
      analyzers: input.analyzers,
      llmProvider: input.llmProvider,
      truncated: input.snapshot.truncated,
      unevaluatedAreas,
    },
    repository: {
      regressionRiskScore: repositoryScore,
      confidence,
      riskDelta: input.contractMismatch
        ? undefined
        : input.baselineScore !== undefined
          ? repositoryScore - input.baselineScore
          : undefined,
      baselineId: input.baselineId,
      disclaimer: SCORE_DISCLAIMER,
    },
    axes,
    clusters,
    evidence: input.evidence,
    semanticFindings: input.semanticFindings,
    interventions: [],
  };

  return diagnosisReportSchema.parse(report);
}
