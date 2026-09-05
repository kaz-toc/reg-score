import { describe, expect, it } from 'vitest';

import { assessRisk } from '../src/assessment/risk.js';
import { diagnosisReportSchema } from '../src/schema/report.v1.js';
import type { Evidence } from '../src/schema/report.v1.js';

const baseSnapshot = {
  repositoryPath: '/tmp/repo',
  inputId: 'abc',
  files: [],
  gitAvailable: true,
  truncated: false,
  intakeIssues: [],
  config: { schemaVersion: 1, llm: { enabled: false, provider: 'none', maxFiles: 20, sendScope: 'cluster-context' } },
} as const;

describe('assessment contract', () => {
  it('does not dilute high severity when low severity duplicates are added', () => {
    const highOnly: Evidence[] = [{
      evidenceId: 'evidence:dep-cycle:src/a.ts',
      signalId: 'dep-cycle',
      axisId: 'structural-fragility',
      path: 'src/a.ts',
      severity: 'high',
      message: 'cycle',
      source: 'deterministic',
    }];
    const withLowDuplicate: Evidence[] = [
      ...highOnly,
      {
        evidenceId: 'evidence:dep-cycle:src/a.ts-dup',
        signalId: 'dep-cycle',
        axisId: 'structural-fragility',
        path: 'src/a.ts',
        severity: 'low',
        message: 'cycle duplicate',
        source: 'deterministic',
      },
    ];

    const highScore = assessRisk({
      snapshot: baseSnapshot as never,
      evidence: highOnly,
      semanticFindings: [],
      capabilities: [],
      analyzers: ['typescript-javascript-v1'],
      selectedAnalyzers: 1,
      successfulAnalyzers: 1,
      semanticResolution: { status: 'unavailable', reason: 'LLM not configured' },
    }).repository.regressionRiskScore;

    const combinedScore = assessRisk({
      snapshot: baseSnapshot as never,
      evidence: withLowDuplicate,
      semanticFindings: [],
      capabilities: [],
      analyzers: ['typescript-javascript-v1'],
      selectedAnalyzers: 1,
      successfulAnalyzers: 1,
      semanticResolution: { status: 'unavailable', reason: 'LLM not configured' },
    }).repository.regressionRiskScore;

    expect(combinedScore).toBe(highScore);
  });

  it('clusters by mechanism rather than axis only', () => {
    const evidence: Evidence[] = [
      {
        evidenceId: 'evidence:dep-cycle:src/a.ts->src/b.ts',
        signalId: 'dep-cycle',
        axisId: 'structural-fragility',
        path: 'src/a.ts',
        severity: 'high',
        message: 'cycle',
        metrics: { cycle: 'src/a.ts->src/b.ts' },
        source: 'deterministic',
      },
      {
        evidenceId: 'evidence:large-file:src/c.ts',
        signalId: 'large-file',
        axisId: 'structural-fragility',
        path: 'src/c.ts',
        severity: 'medium',
        message: 'large',
        source: 'deterministic',
      },
    ];

    const report = assessRisk({
      snapshot: baseSnapshot as never,
      evidence,
      semanticFindings: [],
      capabilities: [],
      analyzers: ['typescript-javascript-v1'],
      selectedAnalyzers: 1,
      successfulAnalyzers: 1,
      semanticResolution: { status: 'unavailable', reason: 'LLM not configured' },
    });

    expect(report.clusters.some((cluster) => cluster.mechanismId === 'dependency-cycle')).toBe(true);
    expect(report.clusters.some((cluster) => cluster.mechanismId === 'large-file')).toBe(true);
    expect(diagnosisReportSchema.safeParse(report).success).toBe(true);
  });
});
