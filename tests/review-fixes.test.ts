import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computeBlastRadius } from '../src/commands/diff.js';
import { runDiffDiagnosis } from '../src/commands/diff.js';
import { diffReportSchema } from '../src/schema/report.v1.js';
import { createRepositorySnapshot } from '../src/intake/snapshot.js';
import { saveBaseline, runDiagnosis } from '../src/pipeline/diagnose.js';
import { IntakeError } from '../src/shared/errors.js';
import { redactDiffReport } from '../src/shared/redaction.js';
import { resolveStorageDir } from '../src/shared/storage-paths.js';
import { ConfigError } from '../src/shared/errors.js';
import { analyzeTrend } from '../src/operations/trend.js';
import type { TrendEntry } from '../src/schema/report.v1.js';

const root = path.dirname(fileURLToPath(import.meta.url));

describe('review fixes', () => {
  it('rejects storage directories that escape repository root', () => {
    expect(() => resolveStorageDir('/repo', '..', 'baselineDir')).toThrow(ConfigError);
  });

  it('computes blast radius paths without import edge kind field', () => {
    const files = [
      { relativePath: 'src/a.ts' },
      { relativePath: 'src/b.ts' },
    ];
    const radius = computeBlastRadius(['src/a.ts'], '/repo', files);
    expect(diffReportSchema.shape.comparison.shape.blastRadius.element.safeParse(radius[0]).success).toBe(true);
  });

  it('redacts diff comparison paths and signal identifiers', async () => {
    const diff = diffReportSchema.parse({
      schemaVersion: 1,
      current: {
        metadata: {
          schemaVersion: 1,
          assessmentContractVersion: 2,
          generatedAt: '2026-01-01T00:00:00.000Z',
          inputId: 'c',
          repositoryPath: '/tmp/secret-repo',
          analyzers: [],
          truncated: false,
          unevaluatedAreas: [],
        },
        repository: { regressionRiskScore: 10, confidence: 1, disclaimer: 'd' },
        axes: [],
        clusters: [],
        evidence: [],
        semanticFindings: [],
        interventions: [],
        capabilities: [],
      },
      base: {
        metadata: {
          schemaVersion: 1,
          assessmentContractVersion: 2,
          generatedAt: '2026-01-01T00:00:00.000Z',
          inputId: 'b',
          repositoryPath: '/tmp/secret-repo',
          analyzers: [],
          truncated: false,
          unevaluatedAreas: [],
        },
        repository: { regressionRiskScore: 5, confidence: 1, disclaimer: 'd' },
        axes: [],
        clusters: [],
        evidence: [],
        semanticFindings: [],
        interventions: [],
        capabilities: [],
      },
      comparison: {
        compatible: true,
        changedFiles: ['secret-repo/src/a.ts'],
        blastRadius: [{
          changedFile: 'secret-repo/src/a.ts',
          directDependents: [],
          directDependencies: [],
          transitiveDependents: [],
          transitiveDependencies: [],
          paths: [],
        }],
        newSignals: [{
          evidenceId: 'evidence:dep-cycle:secret-repo/src/a.ts',
          signalId: 'dep-cycle',
          path: 'secret-repo/src/a.ts',
          currentSeverity: 'high',
          message: 'secret-repo cycle',
        }],
        worsenedSignals: [],
        improvedSignals: [],
      },
    });

    const redacted = redactDiffReport(diff, ['secret-repo']);
    expect(JSON.stringify(redacted)).not.toContain('secret-repo');
  });

  it('rejects missing repository roots with intake error', async () => {
    await expect(createRepositorySnapshot('/path/that/does/not/exist/reg-score')).rejects.toBeInstanceOf(IntakeError);
  });

  it('suppresses score comparison when no stored baseline exists', async () => {
    const diff = await runDiffDiagnosis(path.join(root, 'fixtures', 'stable-cart'), 'HEAD~1');
    expect(diff.comparison.compatible).toBe(false);
    expect(diff.comparison.reason).toContain('no stored baseline manifest');
    expect(diff.comparison.riskDelta).toBeUndefined();
  });

  it('compares against stored baseline when manifest exists', async () => {
    const repoRoot = path.join(root, '..');
    const snapshot = await createRepositorySnapshot(repoRoot);
    const report = await runDiagnosis(snapshot);
    const baselinePath = await saveBaseline(snapshot, report);
    try {
      const diff = await runDiffDiagnosis(repoRoot, 'HEAD~1');
      expect(diff.comparison.compatible).toBe(true);
      expect(diff.comparison.baselineId).toBeDefined();
    } finally {
      await rm(baselinePath, { force: true });
    }
  });

  it('finds degradation start across interim improvements', () => {
    const entries: TrendEntry[] = [
      { schemaVersion: 1, generatedAt: '2026-01-01T00:00:00.000Z', inputId: 'a', score: 10, confidence: 1, contractVersion: 2, topClusters: [] },
      { schemaVersion: 1, generatedAt: '2026-01-02T00:00:00.000Z', inputId: 'b', score: 20, confidence: 1, contractVersion: 2, topClusters: [] },
      { schemaVersion: 1, generatedAt: '2026-01-03T00:00:00.000Z', inputId: 'c', score: 15, confidence: 1, contractVersion: 2, topClusters: [] },
      { schemaVersion: 1, generatedAt: '2026-01-04T00:00:00.000Z', inputId: 'd', score: 25, confidence: 1, contractVersion: 2, topClusters: [] },
      { schemaVersion: 1, generatedAt: '2026-01-05T00:00:00.000Z', inputId: 'e', score: 24, confidence: 1, contractVersion: 2, topClusters: [] },
    ];
    expect(analyzeTrend(entries).degradationStartAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
