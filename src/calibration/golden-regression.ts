import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRepositorySnapshot } from '../intake/snapshot.js';
import { runDiagnosis } from '../pipeline/diagnose.js';

export type GoldenSpec = {
  description: string;
  expected: {
    minScore?: number;
    maxScore?: number;
    requiredSignals: string[];
    forbiddenSignals: string[];
    minClusters: number;
  };
};

export type GoldenRegressionResult = {
  fixture: string;
  passed: boolean;
  score: number;
  violations: string[];
};

export type QualityRegressionReport = {
  passed: boolean;
  results: GoldenRegressionResult[];
};

export async function runGoldenAssessmentRegression(fixturesRoot?: string): Promise<QualityRegressionReport> {
  const root =
    fixturesRoot ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'fixtures');
  const goldenPath = path.join(root, 'golden', 'assessments.json');
  const golden = JSON.parse(await readFile(goldenPath, 'utf8')) as Record<string, GoldenSpec>;
  const results: GoldenRegressionResult[] = [];

  for (const [fixture, spec] of Object.entries(golden)) {
    const snapshot = await createRepositorySnapshot(path.join(root, fixture));
    const report = await runDiagnosis(snapshot);
    const signals = new Set(report.evidence.map((item) => item.signalId));
    const violations: string[] = [];

    if (spec.expected.maxScore !== undefined && report.repository.regressionRiskScore > spec.expected.maxScore) {
      violations.push(`score ${report.repository.regressionRiskScore} > max ${spec.expected.maxScore}`);
    }
    if (spec.expected.minScore !== undefined && report.repository.regressionRiskScore < spec.expected.minScore) {
      violations.push(`score ${report.repository.regressionRiskScore} < min ${spec.expected.minScore}`);
    }
    for (const required of spec.expected.requiredSignals) {
      if (!signals.has(required)) {
        violations.push(`missing required signal ${required}`);
      }
    }
    for (const forbidden of spec.expected.forbiddenSignals) {
      if (signals.has(forbidden)) {
        violations.push(`forbidden signal present ${forbidden}`);
      }
    }
    if (report.clusters.length < spec.expected.minClusters) {
      violations.push(`clusters ${report.clusters.length} < min ${spec.expected.minClusters}`);
    }

    results.push({
      fixture,
      passed: violations.length === 0,
      score: report.repository.regressionRiskScore,
      violations,
    });
  }

  return {
    passed: results.every((result) => result.passed),
    results,
  };
}
