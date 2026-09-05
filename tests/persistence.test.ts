import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadTrendHistory } from '../src/operations/trend.js';
import { retainBaselineEntries, retainTrendEntries } from '../src/persistence/retention.js';
import { resolveSafeStorageDir } from '../src/persistence/storage-boundary.js';
import { ConfigError, RegScoreError } from '../src/shared/errors.js';

describe('persistence storage boundary', () => {
  it('rejects a storage directory symlink without touching its target', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'reg-score-storage-'));
    const repositoryPath = path.join(root, 'repository');
    const outsideDir = path.join(root, 'outside');
    const victimPath = path.join(outsideDir, 'victim.txt');
    await mkdir(path.join(repositoryPath, '.reg-score'), { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await writeFile(victimPath, 'keep me');
    await symlink(outsideDir, path.join(repositoryPath, '.reg-score', 'baselines'));

    try {
      await expect(resolveSafeStorageDir(repositoryPath, '.reg-score/baselines', 'baselineDir', false))
        .rejects.toBeInstanceOf(ConfigError);
      expect(await readFile(victimPath, 'utf8')).toBe('keep me');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a trend history symlink without reading its target', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'reg-score-storage-'));
    const outsideHistoryPath = path.join(root, 'outside-history.jsonl');
    const historyPath = path.join(root, 'history.jsonl');
    const outsideContent = `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: '2026-02-01T00:00:00.000Z',
      inputId: 'outside',
      score: 1,
      confidence: 1,
      contractVersion: 2,
      topClusters: [],
    })}\n`;
    await writeFile(outsideHistoryPath, outsideContent);
    await symlink(outsideHistoryPath, historyPath);

    try {
      await expect(loadTrendHistory(historyPath)).rejects.toBeInstanceOf(RegScoreError);
      expect(await readFile(outsideHistoryPath, 'utf8')).toBe(outsideContent);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('persistence retention', () => {
  it('removes only expired baseline entry files', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'reg-score-baseline-retention-'));
    const expiredPath = path.join(directory, 'expired.json');
    const freshPath = path.join(directory, 'fresh.json');
    const ignoredPath = path.join(directory, 'notes.txt');
    const nestedDirectory = path.join(directory, 'nested.json');
    await writeFile(expiredPath, '{}');
    await writeFile(freshPath, '{}');
    await writeFile(ignoredPath, 'keep');
    await mkdir(nestedDirectory);
    await writeFile(path.join(nestedDirectory, 'child.txt'), 'keep');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const cutoff = new Date();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(freshPath, '{}');

    try {
      const audit = await retainBaselineEntries(directory, cutoff);
      await expect(lstat(expiredPath)).rejects.toThrow();
      expect((await lstat(freshPath)).isFile()).toBe(true);
      expect(await readFile(ignoredPath, 'utf8')).toBe('keep');
      expect((await lstat(nestedDirectory)).isDirectory()).toBe(true);
      expect(audit).toEqual({ storage: 'baseline', reason: 'expired', removedEntries: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('removes only expired trend entries', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'reg-score-trend-retention-'));
    const historyPath = path.join(directory, 'history.jsonl');
    await writeFile(historyPath, [
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        inputId: 'expired',
        score: 1,
        confidence: 1,
        contractVersion: 2,
        topClusters: [],
      }),
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-02-01T00:00:00.000Z',
        inputId: 'fresh',
        score: 2,
        confidence: 1,
        contractVersion: 2,
        topClusters: [],
      }),
    ].join('\n'));

    try {
      const audit = await retainTrendEntries(historyPath, new Date('2026-02-01T00:00:00.000Z'));
      expect((await loadTrendHistory(historyPath)).map((entry) => entry.inputId)).toEqual(['fresh']);
      expect(audit).toEqual({ storage: 'trend', reason: 'expired', removedEntries: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps malformed trend history unchanged and reports its line number', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'reg-score-trend-retention-'));
    const historyPath = path.join(directory, 'history.jsonl');
    const content = `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: '2026-01-01T00:00:00.000Z',
      inputId: 'expired',
      score: 1,
      confidence: 1,
      contractVersion: 2,
      topClusters: [],
    })}\n{broken\n`;
    await writeFile(historyPath, content);

    try {
      await expect(retainTrendEntries(historyPath, new Date('2026-02-01T00:00:00.000Z')))
        .rejects.toBeInstanceOf(RegScoreError);
      await expect(retainTrendEntries(historyPath, new Date('2026-02-01T00:00:00.000Z')))
        .rejects.toThrow(/line 2/);
      expect(await readFile(historyPath, 'utf8')).toBe(content);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
