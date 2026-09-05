import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { baselineEntrySchema, trendEntrySchema } from '../schema/report.v1.js';
import { atomicWriteFile } from '../shared/atomic-write.js';
import { ConfigError, RegScoreError } from '../shared/errors.js';
import { assertSafeStorageDir } from './storage-boundary.js';
import type { SafeStorageDirectory } from './storage-boundary.js';

export type RetentionAudit = {
  storage: 'baseline' | 'trend';
  reason: 'expired';
  removedEntries: number;
};

export type PersistenceResult = {
  path: string;
  retention: RetentionAudit[];
};

export function baselineEntryFileName(entry: {
  inputId: string;
  sourceCommitSha?: string;
}): string {
  return `baseline-${entry.inputId}-${entry.sourceCommitSha ?? 'non-git'}.json`;
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export async function retainBaselineEntries(
  directory: SafeStorageDirectory,
  cutoff: Date,
): Promise<RetentionAudit> {
  let entries: string[];
  try {
    await assertSafeStorageDir(directory);
    entries = await readdir(directory.path);
  } catch (error) {
    if (isMissing(error)) {
      return { storage: 'baseline', reason: 'expired', removedEntries: 0 };
    }
    throw error;
  }

  let removedEntries = 0;
  for (const entry of entries) {
    if (!entry.startsWith('baseline-') || !entry.endsWith('.json')) {
      continue;
    }
    await assertSafeStorageDir(directory);
    const entryPath = path.join(directory.path, entry);
    const entryStat = await lstat(entryPath).catch(() => null);
    if (!entryStat?.isFile() || entryStat.mtimeMs >= cutoff.getTime()) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(entryPath, 'utf8'));
    } catch {
      continue;
    }
    const validated = baselineEntrySchema.safeParse(parsed);
    if (!validated.success || baselineEntryFileName(validated.data) !== entry) {
      continue;
    }
    await assertSafeStorageDir(directory);
    await rm(entryPath, { force: true });
    await assertSafeStorageDir(directory);
    removedEntries += 1;
  }

  return { storage: 'baseline', reason: 'expired', removedEntries };
}

export async function retainTrendEntries(
  directory: SafeStorageDirectory,
  cutoff: Date,
): Promise<RetentionAudit> {
  await assertSafeStorageDir(directory);
  const historyPath = path.join(directory.path, 'history.jsonl');
  const historyStat = await lstat(historyPath).catch(() => null);
  if (!historyStat) {
    return { storage: 'trend', reason: 'expired', removedEntries: 0 };
  }
  if (historyStat.isSymbolicLink()) {
    throw new ConfigError(historyPath, 'trend history must not be a symbolic link');
  }
  if (!historyStat.isFile()) {
    return { storage: 'trend', reason: 'expired', removedEntries: 0 };
  }

  const raw = await readFile(historyPath, 'utf8');
  const entries = [] as ReturnType<typeof trendEntrySchema.parse>[];
  const lines = raw.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    try {
      entries.push(trendEntrySchema.parse(JSON.parse(line)));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new RegScoreError(`trend history parse error at line ${index + 1}: ${reason}`);
    }
  }

  const retained = entries.filter((entry) => entry.generatedAt >= cutoff.toISOString());
  if (retained.length !== entries.length) {
    const content = retained.length === 0 ? '' : `${retained.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
    await atomicWriteFile(historyPath, content, () => assertSafeStorageDir(directory));
  }

  return { storage: 'trend', reason: 'expired', removedEntries: entries.length - retained.length };
}
