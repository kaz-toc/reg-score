import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { trendEntrySchema } from '../schema/report.v1.js';
import { atomicWriteFile } from '../shared/atomic-write.js';
import { ConfigError, RegScoreError } from '../shared/errors.js';

export type RetentionAudit = {
  storage: 'baseline' | 'trend';
  reason: 'expired';
  removedEntries: number;
};

export type PersistenceResult = {
  path: string;
  retention: RetentionAudit[];
};

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export async function retainBaselineEntries(directory: string, cutoff: Date): Promise<RetentionAudit> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (isMissing(error)) {
      return { storage: 'baseline', reason: 'expired', removedEntries: 0 };
    }
    throw error;
  }

  let removedEntries = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }
    const entryPath = path.join(directory, entry);
    const entryStat = await lstat(entryPath).catch(() => null);
    if (entryStat?.isFile() && entryStat.mtimeMs < cutoff.getTime()) {
      await rm(entryPath, { force: true });
      removedEntries += 1;
    }
  }

  return { storage: 'baseline', reason: 'expired', removedEntries };
}

export async function retainTrendEntries(historyPath: string, cutoff: Date): Promise<RetentionAudit> {
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
    await atomicWriteFile(historyPath, content);
  }

  return { storage: 'trend', reason: 'expired', removedEntries: entries.length - retained.length };
}
