import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { DefaultGitProvider } from '../adapters/git-provider.js';
import type { RepositorySnapshot } from '../intake/snapshot.js';
import { loadPolicy } from '../operations/policy.js';
import {
  ASSESSMENT_CONTRACT_VERSION,
  BASELINE_SCHEMA_VERSION,
  baselineEntrySchema,
} from '../schema/report.v1.js';
import type { BaselineEntry, DiagnosisReport } from '../schema/report.v1.js';
import { atomicWriteFile } from '../shared/atomic-write.js';
import { ConfigError } from '../shared/errors.js';
import { redactReport, redactionPolicyFingerprint } from '../shared/redaction.js';
import type { PersistenceResult, RetentionAudit } from './retention.js';
import { retainBaselineEntries, retainTrendEntries } from './retention.js';
import { resolveSafeStorageDir } from './storage-boundary.js';

export type BaselineSelection = {
  entry: BaselineEntry | null;
  path?: string;
  reason?: string;
};

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function versionLabel(value: unknown): string {
  return typeof value === 'number' || typeof value === 'string' ? `v${value}` : 'missing';
}

async function applyRetention(
  repositoryPath: string,
  retentionDays: number,
  baselineDir: string,
  trendDir: string,
): Promise<RetentionAudit[]> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const resolvedBaselineDir = await resolveSafeStorageDir(repositoryPath, baselineDir, 'baselineDir', true);
  const resolvedTrendDir = await resolveSafeStorageDir(repositoryPath, trendDir, 'trendDir', true);
  return Promise.all([
    retainBaselineEntries(resolvedBaselineDir, cutoff),
    retainTrendEntries(path.join(resolvedTrendDir, 'history.jsonl'), cutoff),
  ]);
}

export async function saveBaseline(snapshot: RepositorySnapshot, report: DiagnosisReport): Promise<PersistenceResult> {
  const policy = await loadPolicy(snapshot.repositoryPath, snapshot.config.policyFile);
  const retention = await applyRetention(
    snapshot.repositoryPath,
    policy.retentionDays,
    snapshot.config.baselineDir,
    snapshot.config.trendDir,
  );

  const baselineDir = await resolveSafeStorageDir(snapshot.repositoryPath, snapshot.config.baselineDir, 'baselineDir', true);
  const sourceCommitSha = snapshot.gitAvailable
    ? await new DefaultGitProvider().resolveRef(snapshot.repositoryPath, 'HEAD')
    : undefined;
  const redacted = redactReport(report, policy.redactPaths);
  const entry = baselineEntrySchema.parse({
    schemaVersion: BASELINE_SCHEMA_VERSION,
    inputId: redacted.metadata.inputId,
    generatedAt: redacted.metadata.generatedAt,
    assessmentContractVersion: redacted.metadata.assessmentContractVersion,
    sourceCommitSha,
    redactionPolicyFingerprint: redactionPolicyFingerprint(policy.redactPaths),
    report: redacted,
  });
  const storageId = entry.sourceCommitSha ? `${entry.inputId}-${entry.sourceCommitSha}` : entry.inputId;
  const baselinePath = path.join(baselineDir, `${storageId}.json`);
  await atomicWriteFile(baselinePath, JSON.stringify(entry, null, 2));
  return { path: baselinePath, retention };
}

export async function loadBaseline(
  snapshot: RepositorySnapshot,
  resolvedBaseSha: string,
): Promise<BaselineSelection> {
  let baselineDir: string;
  try {
    baselineDir = await resolveSafeStorageDir(snapshot.repositoryPath, snapshot.config.baselineDir, 'baselineDir', false);
  } catch (error) {
    if (isMissing(error)) {
      return {
        entry: null,
        reason: 'no stored baseline manifest — score and signal comparison suppressed',
      };
    }
    throw error;
  }

  const candidateNames = (await readdir(baselineDir)).filter((entry) => entry.endsWith('.json')).sort();
  const diagnostics: string[] = [];
  let best: { entry: BaselineEntry; path: string } | null = null;
  let validEntries = 0;

  for (const fileName of candidateNames) {
    const baselinePath = path.join(baselineDir, fileName);
    const fileStat = await lstat(baselinePath);
    if (!fileStat.isFile()) {
      continue;
    }

    const raw = await readFile(baselinePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ConfigError(baselinePath, `malformed baseline JSON: ${reason}`);
    }

    if (!isRecord(parsed)) {
      throw new ConfigError(baselinePath, 'baseline entry must be a JSON object');
    }
    if (parsed.schemaVersion !== BASELINE_SCHEMA_VERSION) {
      diagnostics.push(
        `baseline schema mismatch at ${fileName}: expected v${BASELINE_SCHEMA_VERSION}, found ${versionLabel(parsed.schemaVersion)}`,
      );
      continue;
    }
    if (parsed.assessmentContractVersion !== ASSESSMENT_CONTRACT_VERSION) {
      diagnostics.push(
        `assessment contract mismatch at ${fileName}: expected v${ASSESSMENT_CONTRACT_VERSION}, found ${versionLabel(parsed.assessmentContractVersion)}`,
      );
      continue;
    }

    const validation = baselineEntrySchema.safeParse(parsed);
    if (!validation.success) {
      throw new ConfigError(baselinePath, `baseline schema validation failed: ${validation.error.message}`);
    }

    validEntries += 1;
    const entry = validation.data;
    if (entry.sourceCommitSha !== resolvedBaseSha) {
      continue;
    }
    if (
      !best ||
      entry.generatedAt.localeCompare(best.entry.generatedAt) > 0 ||
      (entry.generatedAt === best.entry.generatedAt && entry.inputId.localeCompare(best.entry.inputId) > 0)
    ) {
      best = { entry, path: baselinePath };
    }
  }

  if (best) {
    return best;
  }
  if (diagnostics.length > 0) {
    return { entry: null, reason: diagnostics.join('; ') };
  }
  if (candidateNames.length === 0) {
    return { entry: null, reason: 'no stored baseline manifest — score and signal comparison suppressed' };
  }
  if (validEntries > 0) {
    return {
      entry: null,
      reason: `baseline commit mismatch: no saved baseline for resolved base ${resolvedBaseSha}`,
    };
  }
  return { entry: null, reason: 'no stored baseline manifest — score and signal comparison suppressed' };
}
