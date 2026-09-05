import { describe, expect, it } from 'vitest';

import { diagnosisReportSchema, semanticFindingSchema } from '../src/schema/report.v1.js';
import { validateSemanticFindings } from '../src/semantic/provider.js';

describe('schema reference integrity', () => {
  it('rejects semantic findings without path or related evidence', () => {
    const result = semanticFindingSchema.safeParse({
      findingId: 'finding:1',
      axisId: 'semantic-ambiguity',
      summary: 'ambiguous',
      relatedEvidenceIds: [],
      confidence: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects dangling evidence references in report', () => {
    const result = diagnosisReportSchema.safeParse({
      metadata: {
        schemaVersion: 1,
        assessmentContractVersion: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        inputId: 'x',
        repositoryPath: '/tmp',
        analyzers: [],
        truncated: false,
        unevaluatedAreas: [],
      },
      repository: {
        regressionRiskScore: 1,
        confidence: 1,
        disclaimer: 'test',
      },
      axes: [],
      clusters: [{
        clusterId: 'cluster:structural-fragility:dependency-cycle:1',
        title: 't',
        score: 1,
        confidence: 1,
        axisId: 'structural-fragility',
        mechanismId: 'dependency-cycle',
        paths: [],
        failureMechanism: 'm',
        triggerChanges: [],
        evidenceIds: ['evidence:missing'],
      }],
      evidence: [],
      semanticFindings: [],
      interventions: [],
      capabilities: [],
    });
    expect(result.success).toBe(false);
  });

  it('validates semantic provider output and rejects dangling evidence', () => {
    const snapshot = {
      repositoryPath: '/tmp/repo',
      files: [],
      inputId: 'x',
      gitAvailable: false,
      truncated: false,
      intakeIssues: [],
      config: { schemaVersion: 1 },
    } as never;

    expect(() =>
      validateSemanticFindings(
        [{ axisId: 'semantic-ambiguity', summary: 'x', relatedEvidenceIds: ['evidence:missing'], confidence: 0.5 }],
        snapshot,
        [],
      ),
    ).toThrow(/dangling evidence reference/);
  });
});
