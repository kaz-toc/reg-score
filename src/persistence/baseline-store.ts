import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { DefaultGitProvider } from '../adapters/git-provider.js';
import type { RepositorySnapshot } from '../intake/snapshot.js';
import { diagnosisContextFingerprint } from '../intake/analysis-context.js';
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
import type { PersistenceResult } from './retention.js';
import { baselineEntryFileName, retainBaselineEntries } from './retention.js';
import { assertSafeStorageDir, resolveSafeStorageDir } from './storage-boundary.js';

export type BaselineSelection = {
  entry: BaselineEntry | null;
  path?: string;
  reason?: string;
};

type BaselineCandidate = {
  fileName: string;
  path: string;
  value: Record<string, unknown>;
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

function assertReportMatchesSnapshot(snapshot: RepositorySnapshot, report: DiagnosisReport): void {
  if (
    report.metadata.inputId !== snapshot.inputId ||
    report.metadata.repositoryPath !== snapshot.repositoryPath ||
    report.metadata.unitId !== snapshot.unitId
  ) {
    throw new ConfigError(snapshot.repositoryPath, 'diagnosis report does not match the repository snapshot');
  }
}

export async function saveBaseline(snapshot: RepositorySnapshot, report: DiagnosisReport): Promise<PersistenceResult> {
  assertReportMatchesSnapshot(snapshot, report);
  const policy = await loadPolicy(snapshot.repositoryPath, snapshot.config.policyFile);
  let sourceCommitSha: string | undefined;
  if (snapshot.gitAvailable) {
    if (!snapshot.sourceCommitSha) {
      throw new ConfigError(snapshot.repositoryPath, 'Git commit identity was not captured during intake');
    }
    if (snapshot.gitDirty) {
      throw new ConfigError(snapshot.repositoryPath, 'refusing to save a commit-bound baseline from a dirty worktree');
    }
    const currentGit = await new DefaultGitProvider().inspectRepository(snapshot.repositoryPath);
    if (!currentGit || currentGit.headSha !== snapshot.sourceCommitSha) {
      throw new ConfigError(snapshot.repositoryPath, 'Git HEAD changed after repository intake');
    }
    if (currentGit.statusFingerprint !== snapshot.gitStatusFingerprint) {
      throw new ConfigError(snapshot.repositoryPath, 'Git worktree state changed after repository intake');
    }
    if (currentGit.dirty) {
      throw new ConfigError(snapshot.repositoryPath, 'worktree became dirty after repository intake');
    }
    sourceCommitSha = snapshot.sourceCommitSha;
  }
  const redacted = redactReport(report, policy.redactPaths);
  const entry = baselineEntrySchema.parse({
    schemaVersion: BASELINE_SCHEMA_VERSION,
    kind: 'reg-score/baseline',
    inputId: redacted.metadata.inputId,
    generatedAt: redacted.metadata.generatedAt,
    assessmentContractVersion: redacted.metadata.assessmentContractVersion,
    sourceCommitSha,
    redactionPolicyFingerprint: redactionPolicyFingerprint(policy.redactPaths),
    analysisContextFingerprint: diagnosisContextFingerprint(snapshot.analysisContextFingerprint, report),
    report: redacted,
  });
  const baselineDir = await resolveSafeStorageDir(snapshot.repositoryPath, snapshot.config.baselineDir, 'baselineDir', true);
  const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);
  const retention = [await retainBaselineEntries(baselineDir, cutoff)];
  const baselinePath = path.join(baselineDir.path, baselineEntryFileName(entry));
  await atomicWriteFile(
    baselinePath,
    JSON.stringify(entry, null, 2),
    () => assertSafeStorageDir(baselineDir),
  );
  return { path: baselinePath, retention };
}

export async function loadBaseline(
  snapshot: RepositorySnapshot,
  resolvedBaseSha: string,
): Promise<BaselineSelection> {
  let baselineDir: Awaited<ReturnType<typeof resolveSafeStorageDir>>;
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

  await assertSafeStorageDir(baselineDir);
  const candidateNames = (await readdir(baselineDir.path)).filter((entry) => entry.endsWith('.json')).sort();
  const candidates: BaselineCandidate[] = [];

  for (const fileName of candidateNames) {
    await assertSafeStorageDir(baselineDir);
    const baselinePath = path.join(baselineDir.path, fileName);
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
    candidates.push({ fileName, path: baselinePath, value: parsed });
  }

  if (candidates.length === 0) {
    return { entry: null, reason: 'no stored baseline manifest — score and signal comparison suppressed' };
  }

  const matching = candidates
    .filter((candidate) => candidate.value.sourceCommitSha === resolvedBaseSha)
    .sort((left, right) => {
      const leftGeneratedAt = typeof left.value.generatedAt === 'string' ? left.value.generatedAt : '';
      const rightGeneratedAt = typeof right.value.generatedAt === 'string' ? right.value.generatedAt : '';
      return rightGeneratedAt.localeCompare(leftGeneratedAt) || right.fileName.localeCompare(left.fileName);
    });
  const selected = matching[0];
  if (!selected) {
    return {
      entry: null,
      reason: `baseline commit mismatch: no saved baseline for resolved base ${resolvedBaseSha}`,
    };
  }
  if (selected.value.schemaVersion !== BASELINE_SCHEMA_VERSION) {
    return {
      entry: null,
      reason: `baseline schema mismatch at ${selected.fileName}: expected v${BASELINE_SCHEMA_VERSION}, found ${versionLabel(selected.value.schemaVersion)}`,
    };
  }
  if (selected.value.assessmentContractVersion !== ASSESSMENT_CONTRACT_VERSION) {
    return {
      entry: null,
      reason: `assessment contract mismatch at ${selected.fileName}: expected v${ASSESSMENT_CONTRACT_VERSION}, found ${versionLabel(selected.value.assessmentContractVersion)}`,
    };
  }

  const validation = baselineEntrySchema.safeParse(selected.value);
  if (!validation.success) {
    throw new ConfigError(selected.path, `baseline schema validation failed: ${validation.error.message}`);
  }
  return { entry: validation.data, path: selected.path };
}
