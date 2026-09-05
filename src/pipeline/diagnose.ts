import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { DiagnosisReport } from '../schema/report.v1.js';
import { diagnosisReportSchema } from '../schema/report.v1.js';
import type { RepositorySnapshot } from '../intake/snapshot.js';
import { extractDeterministicEvidence } from '../evidence/deterministic.js';
import { assessRisk } from '../assessment/risk.js';
import { buildInterventions } from '../recommendation/rules.js';
import { runSemanticAnalysis } from '../semantic/provider.js';

export async function runDiagnosis(snapshot: RepositorySnapshot): Promise<DiagnosisReport> {
  const evidence = await extractDeterministicEvidence(snapshot);
  const semanticFindings = await runSemanticAnalysis(snapshot, evidence);
  const report = assessRisk({
    snapshot,
    evidence,
    semanticFindings,
    analyzers: ['typescript-javascript-deterministic-v1'],
    llmProvider: snapshot.config.llm.enabled ? snapshot.config.llm.provider : 'none',
  });
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
  };
  await writeFile(trendPath, `${JSON.stringify(entry)}\n`, { flag: 'a' });
}
