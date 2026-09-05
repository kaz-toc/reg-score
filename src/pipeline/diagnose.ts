import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { DiagnosisReport } from '../schema/report.v1.js';
import { diagnosisReportSchema } from '../schema/report.v1.js';
import type { RepositorySnapshot } from '../intake/snapshot.js';
import { assessRisk } from '../assessment/risk.js';
import { buildInterventions } from '../recommendation/rules.js';
import { getDefaultPlugins, extractEvidenceWithPlugins, negotiateCapabilities } from '../plugins/analyzer.js';
import { runSemanticAnalysis } from '../semantic/provider.js';

export async function runDiagnosis(snapshot: RepositorySnapshot): Promise<DiagnosisReport> {
  const plugins = getDefaultPlugins();
  const { evidence, analyzerIds, unsupportedSignals } = await extractEvidenceWithPlugins(snapshot, plugins);
  const semanticFindings = await runSemanticAnalysis(snapshot, evidence);
  const negotiation = negotiateCapabilities(plugins);

  const unevaluatedFromPlugins = negotiation.unsupported.map((signal) => `signal:${signal}`);
  const report = assessRisk({
    snapshot,
    evidence,
    semanticFindings,
    analyzers: analyzerIds,
    llmProvider: snapshot.config.llm.enabled ? snapshot.config.llm.provider : 'none',
  });

  report.metadata.unevaluatedAreas = [...new Set([...report.metadata.unevaluatedAreas, ...unevaluatedFromPlugins])];
  if (unsupportedSignals.length > 0) {
    report.metadata.analyzers = [...report.metadata.analyzers, 'capability-negotiation-v1'];
  }

  report.interventions = buildInterventions(report.evidence, report.clusters);
  return diagnosisReportSchema.parse(report);
}

export async function saveBaseline(snapshot: RepositorySnapshot, report: DiagnosisReport): Promise<string> {
  const baselineDir = path.join(snapshot.repositoryPath, snapshot.config.baselineDir);
  await mkdir(baselineDir, { recursive: true });
  const baselinePath = path.join(baselineDir, `${report.metadata.inputId}.json`);
  await writeFile(baselinePath, JSON.stringify(report, null, 2));
  return baselinePath;
}

export async function loadBaseline(
  snapshot: RepositorySnapshot,
  inputId: string,
): Promise<DiagnosisReport | null> {
  const baselinePath = path.join(snapshot.repositoryPath, snapshot.config.baselineDir, `${inputId}.json`);
  try {
    const raw = await readFile(baselinePath, 'utf8');
    return diagnosisReportSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function appendTrend(snapshot: RepositorySnapshot, report: DiagnosisReport): Promise<void> {
  const trendDir = path.join(snapshot.repositoryPath, snapshot.config.trendDir);
  await mkdir(trendDir, { recursive: true });
  const trendPath = path.join(trendDir, 'history.jsonl');
  const entry = {
    generatedAt: report.metadata.generatedAt,
    inputId: report.metadata.inputId,
    score: report.repository.regressionRiskScore,
    confidence: report.repository.confidence,
    contractVersion: report.metadata.assessmentContractVersion,
    topClusters: report.clusters.slice(0, 5).map((cluster) => ({
      clusterId: cluster.clusterId,
      score: cluster.score,
    })),
  };
  await writeFile(trendPath, `${JSON.stringify(entry)}\n`, { flag: 'a' });
}
