import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { compareDiagnosis } from '../src/comparison/compare.js';
import { runDiffDiagnosis } from '../src/commands/diff.js';
import { createRepositorySnapshot } from '../src/intake/snapshot.js';
import { saveBaseline } from '../src/persistence/baseline-store.js';
import { runDiagnosis } from '../src/pipeline/diagnose.js';
import { baselineEntrySchema } from '../src/schema/report.v1.js';
import type { BaselineEntry, DiagnosisReport } from '../src/schema/report.v1.js';
import { ConfigError } from '../src/shared/errors.js';
import { redactionPolicyFingerprint } from '../src/shared/redaction.js';
import { createGitRepository } from './helpers/git-repository.js';

const execFileAsync = promisify(execFile);

async function checkout(repositoryPath: string, ref: string): Promise<void> {
  await execFileAsync('git', ['checkout', '--detach', ref], { cwd: repositoryPath });
}

function minimalReport(inputId: string): DiagnosisReport {
  return {
    metadata: {
      schemaVersion: 1,
      assessmentContractVersion: 2,
      generatedAt: '2026-01-01T00:00:00.000Z',
      inputId,
      repositoryPath: '/tmp/secret-repo',
      analyzers: [],
      truncated: false,
      unevaluatedAreas: [],
    },
    repository: { regressionRiskScore: 10, confidence: 1, disclaimer: 'test' },
    axes: [],
    clusters: [],
    evidence: [],
    semanticFindings: [],
    interventions: [],
    capabilities: [],
  };
}

describe('pure comparison', () => {
  it('suppresses baseline-derived values when the redaction policy differs', () => {
    const current = minimalReport('current');
    const baseline: BaselineEntry = {
      schemaVersion: 2,
      inputId: 'baseline',
      generatedAt: '2026-01-01T00:00:00.000Z',
      assessmentContractVersion: 2,
      sourceCommitSha: 'base-sha',
      redactionPolicyFingerprint: 'saved-policy',
      report: minimalReport('baseline'),
    };

    const result = compareDiagnosis(current, baseline, {
      resolvedBaseSha: 'base-sha',
      redactPaths: ['secret-repo'],
      redactionPolicyFingerprint: 'current-policy',
      changedFiles: [],
      blastRadius: [],
    });

    expect(result.base).toBeUndefined();
    expect(result.comparison.compatible).toBe(false);
    expect(result.comparison.reason).toContain('redaction policy mismatch');
    expect(result.comparison.riskDelta).toBeUndefined();
    expect(result.comparison.newSignals).toEqual([]);
    expect(current.metadata.repositoryPath).toBe('/tmp/secret-repo');
  });
});

describe('commit-bound baseline comparison', () => {
  it('suppresses every baseline-derived field when the saved commit does not match --base', async () => {
    const repo = await createGitRepository({ 'src/a.ts': 'export const a = 1;\n' });
    try {
      const snapshot = await createRepositorySnapshot(repo.path);
      const saved = await saveBaseline(snapshot, await runDiagnosis(snapshot));

      const unmatched = await runDiffDiagnosis(repo.path, repo.baseSha);

      expect(unmatched.comparison.compatible).toBe(false);
      expect(unmatched.base).toBeUndefined();
      expect(unmatched.comparison.baselineId).toBeUndefined();
      expect(unmatched.comparison.riskDelta).toBeUndefined();
      expect(unmatched.comparison.newSignals).toEqual([]);
      expect(unmatched.comparison.worsenedSignals).toEqual([]);
      expect(unmatched.comparison.improvedSignals).toEqual([]);
      expect(await readFile(saved.path, 'utf8')).toContain(repo.headSha);
    } finally {
      await repo.cleanup();
    }
  });

  it('derives the displayed base and risk delta from the one commit-matched baseline', async () => {
    const repo = await createGitRepository({ 'src/a.ts': 'export const a = 1;\n' });
    try {
      await checkout(repo.path, repo.baseSha);
      const baseSnapshot = await createRepositorySnapshot(repo.path);
      const saved = await saveBaseline(baseSnapshot, await runDiagnosis(baseSnapshot));
      const savedEntry = baselineEntrySchema.parse(JSON.parse(await readFile(saved.path, 'utf8')));
      await checkout(repo.path, repo.headSha);

      const matched = await runDiffDiagnosis(repo.path, repo.baseSha);

      expect(matched.comparison.compatible).toBe(true);
      expect(matched.base?.metadata.inputId).toBe(savedEntry.report.metadata.inputId);
      expect((matched.base?.repository.regressionRiskScore ?? 0) + (matched.comparison.riskDelta ?? 0))
        .toBe(matched.current.repository.regressionRiskScore);
      expect(matched.comparison.baselineId).toBe(savedEntry.inputId);
    } finally {
      await repo.cleanup();
    }
  });

  it('preserves baselines for different commits that have the same analysis input ID', async () => {
    const repo = await createGitRepository({ 'src/a.ts': 'export const a = 1;\n' });
    try {
      await checkout(repo.path, repo.baseSha);
      const baseSnapshot = await createRepositorySnapshot(repo.path);
      const baseSaved = await saveBaseline(baseSnapshot, await runDiagnosis(baseSnapshot));
      const baseEntry = baselineEntrySchema.parse(JSON.parse(await readFile(baseSaved.path, 'utf8')));

      await checkout(repo.path, repo.headSha);
      const headSnapshot = await createRepositorySnapshot(repo.path);
      const headSaved = await saveBaseline(headSnapshot, await runDiagnosis(headSnapshot));
      const headEntry = baselineEntrySchema.parse(JSON.parse(await readFile(headSaved.path, 'utf8')));

      expect(baseEntry.inputId).toBe(headEntry.inputId);
      expect(baseSaved.path).not.toBe(headSaved.path);
      const diff = await runDiffDiagnosis(repo.path, repo.baseSha);
      expect(diff.comparison.compatible).toBe(true);
      expect(diff.base?.metadata.inputId).toBe(baseEntry.report.metadata.inputId);
    } finally {
      await repo.cleanup();
    }
  });

  it('compares a redacted current copy without mutating the raw current report', async () => {
    const repo = await createGitRepository({
      'secret-repo/a.ts': 'export const untested = 1;\n',
    });
    try {
      await mkdir(path.join(repo.path, '.reg-score'), { recursive: true });
      await writeFile(
        path.join(repo.path, '.reg-score', 'policy.json'),
        JSON.stringify({ schemaVersion: 1, redactPaths: ['secret-repo'], requiredCalibrationConditions: [] }),
      );
      const snapshot = await createRepositorySnapshot(repo.path);
      await saveBaseline(snapshot, await runDiagnosis(snapshot));

      const redacted = await runDiffDiagnosis(repo.path, repo.headSha);

      expect(redacted.comparison.compatible).toBe(true);
      expect(redacted.comparison.newSignals).toEqual([]);
      expect(redacted.comparison.worsenedSignals).toEqual([]);
      expect(redacted.comparison.improvedSignals).toEqual([]);
      expect(JSON.stringify(redacted.current)).toContain('secret-repo');
    } finally {
      await repo.cleanup();
    }
  });

  it('keeps reordered overlapping redaction policies compatible without false signal changes', async () => {
    const repo = await createGitRepository({
      'secret-repo/a.ts': 'export const untested = 1;\n',
    });
    try {
      await mkdir(path.join(repo.path, '.reg-score'), { recursive: true });
      const policyPath = path.join(repo.path, '.reg-score', 'policy.json');
      await writeFile(
        policyPath,
        JSON.stringify({ schemaVersion: 1, redactPaths: ['secret', 'secret-repo'], requiredCalibrationConditions: [] }),
      );
      const snapshot = await createRepositorySnapshot(repo.path);
      await saveBaseline(snapshot, await runDiagnosis(snapshot));
      await writeFile(
        policyPath,
        JSON.stringify({ schemaVersion: 1, redactPaths: ['secret-repo', 'secret', 'secret-repo'], requiredCalibrationConditions: [] }),
      );

      const diff = await runDiffDiagnosis(repo.path, repo.headSha);

      expect(diff.comparison.compatible).toBe(true);
      expect(diff.comparison.newSignals).toEqual([]);
      expect(diff.comparison.worsenedSignals).toEqual([]);
      expect(diff.comparison.improvedSignals).toEqual([]);
    } finally {
      await repo.cleanup();
    }
  });

  it('does not fall back to an older compatible baseline when the newest same-commit entry is incompatible', async () => {
    const repo = await createGitRepository({ 'src/a.ts': 'export const a = 1;\n' });
    try {
      const snapshot = await createRepositorySnapshot(repo.path);
      const report = await runDiagnosis(snapshot);
      const baselineDir = path.join(repo.path, '.reg-score', 'baselines');
      await mkdir(baselineDir, { recursive: true });
      await writeFile(
        path.join(baselineDir, 'older-compatible.json'),
        JSON.stringify({
          schemaVersion: 2,
          inputId: 'older-compatible',
          generatedAt: '2026-01-01T00:00:00.000Z',
          assessmentContractVersion: 2,
          sourceCommitSha: repo.baseSha,
          redactionPolicyFingerprint: redactionPolicyFingerprint([]),
          report,
        }),
      );
      await writeFile(
        path.join(baselineDir, 'newer-incompatible.json'),
        JSON.stringify({
          schemaVersion: 1,
          inputId: 'newer-incompatible',
          generatedAt: '2026-01-02T00:00:00.000Z',
          assessmentContractVersion: 2,
          sourceCommitSha: repo.baseSha,
          redactionPolicyFingerprint: redactionPolicyFingerprint([]),
          report,
        }),
      );

      const diff = await runDiffDiagnosis(repo.path, repo.baseSha);

      expect(diff.comparison.compatible).toBe(false);
      expect(diff.comparison.reason).toContain('baseline schema mismatch');
      expect(diff.base).toBeUndefined();
    } finally {
      await repo.cleanup();
    }
  });

  it('does not report schema diagnostics from incompatible entries saved for another commit', async () => {
    const repo = await createGitRepository({ 'src/a.ts': 'export const a = 1;\n' });
    try {
      const snapshot = await createRepositorySnapshot(repo.path);
      const report = await runDiagnosis(snapshot);
      const baselineDir = path.join(repo.path, '.reg-score', 'baselines');
      await mkdir(baselineDir, { recursive: true });
      await writeFile(
        path.join(baselineDir, 'unrelated-old.json'),
        JSON.stringify({
          schemaVersion: 1,
          inputId: 'unrelated-old',
          generatedAt: '2026-01-02T00:00:00.000Z',
          assessmentContractVersion: 2,
          sourceCommitSha: repo.headSha,
          redactionPolicyFingerprint: redactionPolicyFingerprint([]),
          report,
        }),
      );

      const diff = await runDiffDiagnosis(repo.path, repo.baseSha);

      expect(diff.comparison.compatible).toBe(false);
      expect(diff.comparison.reason).toContain('baseline commit mismatch');
      expect(diff.comparison.reason).not.toContain('baseline schema mismatch');
      expect(diff.base).toBeUndefined();
    } finally {
      await repo.cleanup();
    }
  });

  it('reports a parseable old baseline schema as incompatible instead of absent', async () => {
    const repo = await createGitRepository({ 'src/a.ts': 'export const a = 1;\n' });
    try {
      const snapshot = await createRepositorySnapshot(repo.path);
      const report = await runDiagnosis(snapshot);
      const baselineDir = path.join(repo.path, '.reg-score', 'baselines');
      await mkdir(baselineDir, { recursive: true });
      await writeFile(
        path.join(baselineDir, 'old.json'),
        JSON.stringify({
          schemaVersion: 1,
          inputId: report.metadata.inputId,
          generatedAt: report.metadata.generatedAt,
          assessmentContractVersion: report.metadata.assessmentContractVersion,
          sourceCommitSha: repo.baseSha,
          report,
        }),
      );

      const diff = await runDiffDiagnosis(repo.path, repo.baseSha);

      expect(diff.comparison.compatible).toBe(false);
      expect(diff.comparison.reason).toContain('baseline schema mismatch');
      expect(diff.comparison.reason).not.toContain('no stored baseline');
      expect(diff.base).toBeUndefined();
    } finally {
      await repo.cleanup();
    }
  });

  it('reports a parseable old assessment contract as incompatible instead of absent', async () => {
    const repo = await createGitRepository({ 'src/a.ts': 'export const a = 1;\n' });
    try {
      const snapshot = await createRepositorySnapshot(repo.path);
      const report = await runDiagnosis(snapshot);
      const oldContractReport = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
      (oldContractReport.metadata as Record<string, unknown>).assessmentContractVersion = 1;
      const baselineDir = path.join(repo.path, '.reg-score', 'baselines');
      await mkdir(baselineDir, { recursive: true });
      await writeFile(
        path.join(baselineDir, 'old-contract.json'),
        JSON.stringify({
          schemaVersion: 2,
          inputId: report.metadata.inputId,
          generatedAt: report.metadata.generatedAt,
          assessmentContractVersion: 1,
          sourceCommitSha: repo.baseSha,
          redactionPolicyFingerprint: 'old-contract-policy',
          report: oldContractReport,
        }),
      );

      const diff = await runDiffDiagnosis(repo.path, repo.baseSha);

      expect(diff.comparison.compatible).toBe(false);
      expect(diff.comparison.reason).toContain('assessment contract mismatch');
      expect(diff.comparison.reason).not.toContain('no stored baseline');
      expect(diff.base).toBeUndefined();
    } finally {
      await repo.cleanup();
    }
  });

  it('raises ConfigError for malformed baseline JSON', async () => {
    const repo = await createGitRepository({ 'src/a.ts': 'export const a = 1;\n' });
    try {
      const baselineDir = path.join(repo.path, '.reg-score', 'baselines');
      await mkdir(baselineDir, { recursive: true });
      await writeFile(path.join(baselineDir, 'broken.json'), '{broken');

      await expect(runDiffDiagnosis(repo.path, repo.baseSha)).rejects.toBeInstanceOf(ConfigError);
    } finally {
      await repo.cleanup();
    }
  });
});
