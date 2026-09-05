import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { writeGitHubAnnotationsFile, writeGitHubSummaryFile } from '../src/reporting/github.js';
import { diffReportSchema } from '../src/schema/report.v1.js';
import { createRepositorySnapshot } from '../src/intake/snapshot.js';
import { loadBaseline, saveBaseline } from '../src/persistence/baseline-store.js';
import { runDiagnosis } from '../src/pipeline/diagnose.js';
import { loadTrendHistory } from '../src/operations/trend.js';
import {
  formatConsoleReport,
  formatDiffConsoleReport,
  formatDiffMarkdownReport,
  formatJsonReport,
  formatMarkdownReport,
} from '../src/reporting/format.js';
import { baselineEntrySchema } from '../src/schema/report.v1.js';
import { createGitRepository } from './helpers/git-repository.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(root, 'fixtures');

describe('integration: multi-language scan', () => {
  it('negotiates capabilities per detected language', async () => {
    const snapshot = await createRepositorySnapshot(path.join(fixturesRoot, 'mixed-lang'));
    const report = await runDiagnosis(snapshot);
    const languages = report.capabilities.map((entry) => entry.language).sort();
    expect(languages).toEqual(['go', 'python', 'typescript-javascript']);
    expect(report.capabilities.find((entry) => entry.language === 'python')?.completeness).toBe('partial');
    expect(report.capabilities.find((entry) => entry.language === 'go')?.unevaluatedSignals.length).toBeGreaterThan(0);
  });
});

describe('integration: semantic unevaluated', () => {
  it('marks semantic ambiguity unevaluated when LLM is disabled', async () => {
    const report = await runDiagnosis(await createRepositorySnapshot(path.join(fixturesRoot, 'stable-cart')));
    const semanticAxis = report.axes.find((axis) => axis.axisId === 'semantic-ambiguity');
    expect(semanticAxis?.unevaluated).toBe(true);
    expect(report.metadata.semanticProviderStatus).toBe('not-configured');
    expect(report.metadata.unevaluatedAreas.some((area) => area.includes('Semantic Ambiguity') || area === 'Semantic Ambiguity')).toBe(true);
  });
});

describe('integration: Git-dependent capability unevaluated', () => {
  it('marks change volatility unevaluated for a non-Git repository snapshot', async () => {
    const snapshot = await createRepositorySnapshot(path.join(fixturesRoot, 'stable-cart'));
    snapshot.gitAvailable = false;
    const report = await runDiagnosis(snapshot);

    expect(report.capabilities.find((entry) => entry.language === 'typescript-javascript')?.supportedSignals).not.toContain('git-churn');
    expect(report.axes.find((axis) => axis.axisId === 'change-volatility')?.unevaluated).toBe(true);
  });
});

describe('integration: output evidence traceability', () => {
  it('includes evidence details in console, markdown, and json outputs', async () => {
    const report = await runDiagnosis(await createRepositorySnapshot(path.join(fixturesRoot, 'fragile-cart')));
    const consoleOut = formatConsoleReport(report);
    const markdownOut = formatMarkdownReport(report);
    const jsonOut = formatJsonReport(report);

    expect(consoleOut).toContain('mechanism:');
    expect(consoleOut).toContain('evidence:');
    expect(markdownOut).toContain('- Evidence:');
    expect(jsonOut).toContain('"evidenceId"');
    expect(jsonOut).toContain('"capabilities"');
  });
});

describe('integration: baseline atomic round-trip', () => {
  it('persists and reloads a schema-valid baseline entry', async () => {
    const repo = await createGitRepository({ 'src/a.ts': 'export const a = 1;\n' });
    try {
      const snapshot = await createRepositorySnapshot(repo.path);
      const report = await runDiagnosis(snapshot);
      const baseline = await saveBaseline(snapshot, report);
      const raw = await readFile(baseline.path, 'utf8');
      const entry = baselineEntrySchema.parse(JSON.parse(raw));
      const loaded = await loadBaseline(snapshot, repo.headSha);
      expect(entry.sourceCommitSha).toBe(repo.headSha);
      expect(loaded.entry?.inputId).toBe(entry.inputId);
      expect(loaded.entry?.report.metadata.inputId).toBe(report.metadata.inputId);
    } finally {
      await repo.cleanup();
    }
  });
});

describe('integration: trend corrupt line errors', () => {
  it('reports line number when trend history is corrupt', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'reg-score-trend-'));
    const trendDir = path.join(dir, '.reg-score', 'trends');
    await mkdir(trendDir, { recursive: true });
    const trendPath = path.join(trendDir, 'history.jsonl');
    await writeFile(
      trendPath,
      `${JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        inputId: 'a',
        score: 1,
        confidence: 1,
        contractVersion: 2,
        topClusters: [],
      })}\n{broken\n`,
    );
    await expect(loadTrendHistory(trendPath)).rejects.toThrow(/line 2/);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('integration: diff report contract', () => {
  it('returns versioned DiffReport shape from compareSignalChanges path', () => {
    const diff = diffReportSchema.parse({
      schemaVersion: 2,
      current: {
        metadata: {
          schemaVersion: 1,
          assessmentContractVersion: 2,
          generatedAt: '2026-01-01T00:00:00.000Z',
          inputId: 'c',
          repositoryPath: '/tmp',
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
      comparison: {
        compatible: false,
        reason: 'assessment contract mismatch',
        changedFiles: ['src/a.ts'],
        blastRadius: [],
        newSignals: [],
        worsenedSignals: [],
        improvedSignals: [],
      },
    });
    expect(diff.comparison.compatible).toBe(false);
    expect(diff.base).toBeUndefined();
    expect(diff.comparison.riskDelta).toBeUndefined();
    expect(formatDiffConsoleReport(diff)).not.toContain('Base score:');
    expect(formatDiffMarkdownReport(diff)).not.toContain('Base score:');
  });
});

describe('integration: github outputs', () => {
  it('writes summary and annotations with diagnostic evidence', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'reg-score-gh-'));
    const diff = diffReportSchema.parse({
      schemaVersion: 2,
      current: {
        metadata: {
          schemaVersion: 1,
          assessmentContractVersion: 2,
          generatedAt: '2026-01-01T00:00:00.000Z',
          inputId: 'c',
          repositoryPath: '/tmp',
          analyzers: [],
          truncated: false,
          unevaluatedAreas: [],
        },
        repository: { regressionRiskScore: 80, confidence: 0.9, disclaimer: 'd' },
        axes: [],
        clusters: [],
        evidence: [{
          evidenceId: 'evidence:dep-cycle:src/a.ts',
          signalId: 'dep-cycle',
          axisId: 'structural-fragility',
          path: 'src/a.ts',
          severity: 'high',
          message: 'cycle detected',
          source: 'deterministic',
        }],
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
          repositoryPath: '/tmp',
          analyzers: [],
          truncated: false,
          unevaluatedAreas: [],
        },
        repository: { regressionRiskScore: 50, confidence: 0.9, disclaimer: 'd' },
        axes: [],
        clusters: [],
        evidence: [],
        semanticFindings: [],
        interventions: [],
        capabilities: [],
      },
      comparison: {
        compatible: true,
        riskDelta: 30,
        baselineId: 'b',
        changedFiles: ['src/a.ts'],
        blastRadius: [{
          changedFile: 'src/a.ts',
          directDependents: [],
          directDependencies: [],
          transitiveDependents: [],
          transitiveDependencies: [],
          paths: [],
        }],
        newSignals: [{
          evidenceId: 'evidence:dep-cycle:src/a.ts',
          signalId: 'dep-cycle',
          path: 'src/a.ts',
          currentSeverity: 'high',
          message: 'cycle detected',
        }],
        worsenedSignals: [],
        improvedSignals: [],
      },
    });

    const summaryPath = path.join(dir, 'summary.md');
    const annotationsPath = path.join(dir, 'annotations.txt');
    await writeGitHubSummaryFile(diff, summaryPath);
    await writeGitHubAnnotationsFile(diff, annotationsPath);
    const summary = await readFile(summaryPath, 'utf8');
    const annotations = await readFile(annotationsPath, 'utf8');
    expect(summary).toContain('Baseline: b');
    expect(summary).toContain('Base score: 50');
    expect(summary).toContain('cycle detected');
    expect(annotations).toContain('::error file=src/a.ts');
    expect(formatDiffConsoleReport(diff)).toContain('Base score: 50');
    expect(formatDiffMarkdownReport(diff)).toContain('Base score: 50');
    await rm(dir, { recursive: true, force: true });
  });
});
