import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import type { DiagnosisReport } from '../schema/report.v1.js';
import { baselineEntrySchema, diagnosisReportSchema } from '../schema/report.v1.js';
import type { RepositorySnapshot } from '../intake/snapshot.js';
import { assessRisk } from '../assessment/risk.js';
import { buildInterventions } from '../recommendation/rules.js';
import { getDefaultPlugins, extractEvidenceWithPlugins, selectPlugins } from '../plugins/analyzer.js';
import { runSemanticAnalysis } from '../semantic/provider.js';
import { DefaultGitProvider } from '../adapters/git-provider.js';
import { atomicAppendLine, atomicWriteFile } from '../shared/atomic-write.js';
import { redactReport } from '../shared/redaction.js';
import { loadPolicy } from '../operations/policy.js';
import { trendEntrySchema } from '../schema/report.v1.js';

export async function runDiagnosis(snapshot: RepositorySnapshot): Promise<DiagnosisReport> {
  const plugins = getDefaultPlugins();
  const selected = selectPlugins(snapshot, plugins);
  const { evidence, analyzerIds, capabilities } = await extractEvidenceWithPlugins(snapshot, plugins);
  const { findings: semanticFindings, resolution: semanticResolution } = await runSemanticAnalysis(snapshot, evidence);

  const report = assessRisk({
    snapshot,
    evidence,
    semanticFindings,
    capabilities,
    analyzers: analyzerIds,
    selectedAnalyzers: selected.length,
    successfulAnalyzers: selected.length,
    semanticResolution,
    llmProvider: snapshot.config.llm.enabled ? snapshot.config.llm.provider : 'none',
  });

  report.interventions = buildInterventions(report.evidence, report.clusters);
  return diagnosisReportSchema.parse(report);
}

async function applyRetention(repositoryPath: string, retentionDays: number, baselineDir: string, trendDir: string): Promise<string[]> {
  const removed: string[] = [];
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  for (const dir of [baselineDir, trendDir]) {
    const absoluteDir = path.join(repositoryPath, dir);
    const entries = await readdir(absoluteDir).catch(() => [] as string[]);
    for (const entry of entries) {
      const entryPath = path.join(absoluteDir, entry);
      const stat = await import('node:fs/promises').then((fs) => fs.stat(entryPath).catch(() => null));
      if (!stat) {
        continue;
      }
      if (stat.mtimeMs < cutoff) {
        await rm(entryPath, { recursive: true, force: true });
        removed.push(entryPath);
      }
    }
  }

  return removed;
}

export async function saveBaseline(snapshot: RepositorySnapshot, report: DiagnosisReport): Promise<string> {
  const policy = await loadPolicy(snapshot.repositoryPath, snapshot.config.policyFile);
  await applyRetention(snapshot.repositoryPath, policy.retentionDays, snapshot.config.baselineDir, snapshot.config.trendDir);

  const baselineDir = path.join(snapshot.repositoryPath, snapshot.config.baselineDir);
  await mkdir(baselineDir, { recursive: true });
  const redacted = redactReport(report, policy.redactPaths);
  const entry = baselineEntrySchema.parse({
    schemaVersion: 1,
    inputId: redacted.metadata.inputId,
    generatedAt: redacted.metadata.generatedAt,
    assessmentContractVersion: redacted.metadata.assessmentContractVersion,
    report: redacted,
  });
  const baselinePath = path.join(baselineDir, `${entry.inputId}.json`);
  await atomicWriteFile(baselinePath, JSON.stringify(entry, null, 2));
  return baselinePath;
}

export async function loadBaseline(
  snapshot: RepositorySnapshot,
  inputId?: string,
): Promise<{ entry: ReturnType<typeof baselineEntrySchema.parse>; path: string } | null> {
  const baselineDir = path.join(snapshot.repositoryPath, snapshot.config.baselineDir);
  const entries = await readdir(baselineDir).catch(() => [] as string[]);
  const candidates = entries.filter((entry) => entry.endsWith('.json'));

  let best: { entry: ReturnType<typeof baselineEntrySchema.parse>; path: string } | null = null;

  for (const fileName of candidates) {
    const baselinePath = path.join(baselineDir, fileName);
    try {
      const raw = await readFile(baselinePath, 'utf8');
      const entry = baselineEntrySchema.parse(JSON.parse(raw));
      if (inputId && entry.inputId !== inputId) {
        continue;
      }
      if (
        !best ||
        entry.generatedAt.localeCompare(best.entry.generatedAt) > 0 ||
        (entry.generatedAt === best.entry.generatedAt &&
          entry.assessmentContractVersion >= best.entry.assessmentContractVersion)
      ) {
        best = { entry, path: baselinePath };
      }
    } catch {
      continue;
    }
  }

  return best;
}

export async function appendTrend(snapshot: RepositorySnapshot, report: DiagnosisReport): Promise<void> {
  const policy = await loadPolicy(snapshot.repositoryPath, snapshot.config.policyFile);
  const removed = await applyRetention(snapshot.repositoryPath, policy.retentionDays, snapshot.config.baselineDir, snapshot.config.trendDir);

  const trendDir = path.join(snapshot.repositoryPath, snapshot.config.trendDir);
  await mkdir(trendDir, { recursive: true });
  const trendPath = path.join(trendDir, 'history.jsonl');
  const git = new DefaultGitProvider();
  const commitSha = snapshot.gitAvailable ? await git.resolveHeadCommit(snapshot.repositoryPath) : undefined;
  const history = await readFile(trendPath, 'utf8').catch(() => '');
  const previousEntry = history
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => trendEntrySchema.parse(JSON.parse(line)))
    .at(-1);
  const changedFiles =
    snapshot.gitAvailable && previousEntry?.commitSha
      ? await git.listChangedFiles(snapshot.repositoryPath, previousEntry.commitSha)
      : [];

  const redacted = redactReport(report, policy.redactPaths);
  const entry = trendEntrySchema.parse({
    schemaVersion: 1,
    generatedAt: redacted.metadata.generatedAt,
    inputId: redacted.metadata.inputId,
    score: redacted.repository.regressionRiskScore,
    confidence: redacted.repository.confidence,
    contractVersion: redacted.metadata.assessmentContractVersion,
    commitSha,
    changedFiles,
    topClusters: redacted.clusters.slice(0, 5).map((cluster) => ({
      clusterId: cluster.clusterId,
      score: cluster.score,
    })),
  });

  await atomicAppendLine(trendPath, JSON.stringify(entry));

  if (removed.length > 0) {
    process.stderr.write(`retention removed ${removed.length} expired entries\n`);
  }
}
