import { describe, expect, it } from 'vitest';

import { assessRisk } from '../src/assessment/risk.js';
import { formatConsoleReport, formatMarkdownReport } from '../src/reporting/format.js';
import { diagnosisReportSchema } from '../src/schema/report.v1.js';
import type { Evidence } from '../src/schema/report.v1.js';
import { TypeScriptAnalyzerPlugin, negotiateCapabilities } from '../src/plugins/analyzer.js';

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
  it('does not derive or expose comparison values from legacy assessment inputs', () => {
    const report = assessRisk({
      snapshot: baseSnapshot as never,
      evidence: [],
      semanticFindings: [],
      capabilities: [],
      analyzers: ['typescript-javascript-v1'],
      selectedAnalyzers: 1,
      successfulAnalyzers: 1,
      semanticResolution: { status: 'unavailable', reason: 'LLM not configured' },
      baselineScore: 5,
      baselineId: 'legacy-baseline',
      contractMismatch: false,
    } as unknown as Parameters<typeof assessRisk>[0]);

    expect(report.repository).not.toHaveProperty('riskDelta');
    expect(report.repository).not.toHaveProperty('baselineId');
    expect(formatConsoleReport(report)).not.toContain('Risk delta:');
    expect(formatMarkdownReport(report)).not.toContain('| Risk Delta |');
  });

  it('rejects legacy comparison values in a diagnosis report', () => {
    const report = assessRisk({
      snapshot: baseSnapshot as never,
      evidence: [],
      semanticFindings: [],
      capabilities: [],
      analyzers: ['typescript-javascript-v1'],
      selectedAnalyzers: 1,
      successfulAnalyzers: 1,
      semanticResolution: { status: 'unavailable', reason: 'LLM not configured' },
    });
    const legacyReport = {
      ...report,
      repository: {
        ...report.repository,
        riskDelta: 5,
        baselineId: 'legacy-baseline',
      },
    };

    expect(diagnosisReportSchema.safeParse(legacyReport).success).toBe(false);
  });

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

  it('marks change volatility unevaluated when Git-backed signals are unavailable', () => {
    const nonGitSnapshot = { ...baseSnapshot, gitAvailable: false };
    const capabilities = negotiateCapabilities(
      {
        ...nonGitSnapshot,
        files: [{ relativePath: 'src/a.ts', absolutePath: '/tmp/repo/src/a.ts', extension: '.ts', content: '', contentHash: 'a', nonBlankLines: 1 }],
      } as never,
      [new TypeScriptAnalyzerPlugin()],
    ).capabilities;

    const report = assessRisk({
      snapshot: nonGitSnapshot as never,
      evidence: [],
      semanticFindings: [],
      capabilities,
      analyzers: ['typescript-javascript-v1'],
      selectedAnalyzers: 1,
      successfulAnalyzers: 1,
      semanticResolution: { status: 'unavailable', reason: 'LLM not configured' },
    });

    expect(report.axes.find((axis) => axis.axisId === 'change-volatility')?.unevaluated).toBe(true);
  });

  it('does not let unsupported git churn evidence override capability negotiation', () => {
    const nonGitSnapshot = { ...baseSnapshot, gitAvailable: false };
    const capabilities = negotiateCapabilities(
      {
        ...nonGitSnapshot,
        files: [{ relativePath: 'src/a.ts', absolutePath: '/tmp/repo/src/a.ts', extension: '.ts', content: '', contentHash: 'a', nonBlankLines: 1 }],
      } as never,
      [new TypeScriptAnalyzerPlugin()],
    ).capabilities;

    const report = assessRisk({
      snapshot: nonGitSnapshot as never,
      evidence: [
        {
          evidenceId: 'evidence:git-churn:src/a.ts',
          signalId: 'git-churn',
          axisId: 'change-volatility',
          path: 'src/a.ts',
          severity: 'high',
          message: 'manually supplied churn evidence',
          source: 'deterministic',
        },
      ],
      semanticFindings: [],
      capabilities,
      analyzers: ['typescript-javascript-v1'],
      selectedAnalyzers: 1,
      successfulAnalyzers: 1,
      semanticResolution: { status: 'unavailable', reason: 'LLM not configured' },
    });

    expect(report.axes.find((axis) => axis.axisId === 'change-volatility')).toMatchObject({
      unevaluated: true,
      score: 0,
    });
    expect(report.clusters.some((cluster) => cluster.axisId === 'change-volatility')).toBe(false);
    expect(report.repository.regressionRiskScore).toBe(0);
  });

  it('scores only supported signals when an axis has mixed capability support', () => {
    const report = assessRisk({
      snapshot: baseSnapshot as never,
      evidence: [
        {
          evidenceId: 'evidence:dep-cycle:src/a.ts->src/b.ts',
          signalId: 'dep-cycle',
          axisId: 'structural-fragility',
          path: 'src/a.ts',
          severity: 'high',
          message: 'manually supplied dependency cycle',
          source: 'deterministic',
        },
        {
          evidenceId: 'evidence:large-file:src/c.ts',
          signalId: 'large-file',
          axisId: 'structural-fragility',
          path: 'src/c.ts',
          severity: 'low',
          message: 'supported large file',
          source: 'deterministic',
        },
      ],
      semanticFindings: [],
      capabilities: [
        {
          language: 'typescript-javascript',
          completeness: 'partial',
          supportedSignals: ['large-file'],
          unevaluatedSignals: ['dep-cycle'],
          analyzerId: 'typescript-javascript-v1',
        },
      ],
      analyzers: ['typescript-javascript-v1'],
      selectedAnalyzers: 1,
      successfulAnalyzers: 1,
      semanticResolution: { status: 'unavailable', reason: 'LLM not configured' },
    });

    expect(report.axes.find((axis) => axis.axisId === 'structural-fragility')).toMatchObject({
      unevaluated: false,
      score: 25,
    });
    expect(report.clusters.some((cluster) => cluster.mechanismId === 'dependency-cycle')).toBe(false);
    expect(report.clusters.some((cluster) => cluster.mechanismId === 'large-file')).toBe(true);
    expect(report.repository.regressionRiskScore).toBe(25);
  });

  it('does not let unsupported semantic evidence affect clusters or repository score', () => {
    const report = assessRisk({
      snapshot: baseSnapshot as never,
      evidence: [
        {
          evidenceId: 'evidence:semantic-ambiguity:src/a.ts',
          signalId: 'semantic-ambiguity',
          axisId: 'semantic-ambiguity',
          path: 'src/a.ts',
          severity: 'high',
          message: 'manually supplied semantic evidence',
          source: 'semantic',
        },
      ],
      semanticFindings: [],
      capabilities: [
        {
          language: 'typescript-javascript',
          completeness: 'partial',
          supportedSignals: ['large-file'],
          unevaluatedSignals: ['semantic-ambiguity'],
          analyzerId: 'typescript-javascript-v1',
        },
      ],
      analyzers: ['typescript-javascript-v1'],
      selectedAnalyzers: 1,
      successfulAnalyzers: 1,
      semanticResolution: { status: 'unavailable', reason: 'LLM not configured' },
    });

    expect(report.axes.find((axis) => axis.axisId === 'semantic-ambiguity')).toMatchObject({
      unevaluated: true,
      score: 0,
    });
    expect(report.clusters.some((cluster) => cluster.axisId === 'semantic-ambiguity')).toBe(false);
    expect(report.repository.regressionRiskScore).toBe(0);
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
      capabilities: [
        {
          language: 'typescript-javascript',
          completeness: 'full',
          supportedSignals: ['dep-cycle', 'large-file'],
          unevaluatedSignals: [],
          analyzerId: 'typescript-javascript-v1',
        },
      ],
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
