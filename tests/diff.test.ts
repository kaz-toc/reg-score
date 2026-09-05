import { describe, expect, it } from 'vitest';

import { compareSignalChanges, computeBlastRadius } from '../src/commands/diff.js';
import type { DiagnosisReport } from '../src/schema/report.v1.js';

function minimalReport(evidenceIds: Array<{ id: string; severity: 'low' | 'medium' | 'high' }>): DiagnosisReport {
  return {
    metadata: {
      schemaVersion: 1,
      assessmentContractVersion: 2,
      generatedAt: '2026-01-01T00:00:00.000Z',
      inputId: 'test',
      repositoryPath: '/tmp',
      analyzers: [],
      truncated: false,
      unevaluatedAreas: [],
    },
    repository: {
      regressionRiskScore: 10,
      confidence: 1,
      disclaimer: 'test',
    },
    axes: [],
    clusters: [],
    evidence: evidenceIds.map((entry) => ({
      evidenceId: `evidence:dep-cycle:${entry.id}`,
      signalId: 'dep-cycle',
      axisId: 'structural-fragility',
      severity: entry.severity,
      message: entry.id,
      source: 'deterministic',
    })),
    semanticFindings: [],
    interventions: [],
    capabilities: [],
  };
}

describe('diff diagnostics', () => {
  it('classifies new, worsened, and improved signals', () => {
    const base = minimalReport([{ id: 'a', severity: 'low' }, { id: 'b', severity: 'high' }]);
    const current = minimalReport([{ id: 'a', severity: 'medium' }, { id: 'c', severity: 'low' }]);
    const changes = compareSignalChanges(current, base);
    expect(changes.newSignals.map((item) => item.evidenceId)).toContain('evidence:dep-cycle:c');
    expect(changes.worsenedSignals.map((item) => item.evidenceId)).toContain('evidence:dep-cycle:a');
    expect(changes.improvedSignals.map((item) => item.evidenceId)).toContain('evidence:dep-cycle:b');
  });

  it('computes blast radius for changed files', () => {
    const files = [
      { relativePath: 'src/a.ts', absolutePath: '', extension: '.ts', content: '', nonBlankLines: 1 },
      { relativePath: 'src/b.ts', absolutePath: '', extension: '.ts', content: "import './a.js'", nonBlankLines: 1 },
    ];
    const radius = computeBlastRadius(['src/a.ts'], '/repo', files);
    expect(radius[0]?.directDependents).toContain('src/b.ts');
    expect(radius[0]?.transitiveDependents).toContain('src/b.ts');
    expect(radius[0]?.paths.length).toBeGreaterThan(0);
  });
});
