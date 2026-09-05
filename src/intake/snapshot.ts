import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { RegScoreConfig } from '../shared/config.js';
import { configSchema, defaultConfig } from '../shared/config.js';

export type SourceFile = {
  relativePath: string;
  absolutePath: string;
  extension: string;
  content: string;
  nonBlankLines: number;
};

export type RepositorySnapshot = {
  repositoryPath: string;
  inputId: string;
  files: SourceFile[];
  gitAvailable: boolean;
  truncated: boolean;
  config: RegScoreConfig;
};

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function countNonBlankLines(content: string): number {
  return content.split('\n').filter((line) => line.trim().length > 0).length;
}

function isExcluded(relativePath: string, exclude: string[]): boolean {
  const segments = relativePath.split(path.sep);
  return exclude.some((pattern) => segments.includes(pattern) || relativePath.includes(pattern));
}

async function walkFiles(
  root: string,
  current: string,
  exclude: string[],
  maxFiles: number,
  collected: SourceFile[],
): Promise<boolean> {
  if (collected.length >= maxFiles) {
    return true;
  }

  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (collected.length >= maxFiles) {
      return true;
    }

    const absolutePath = path.join(current, entry.name);
    const relativePath = path.relative(root, absolutePath);

    if (isExcluded(relativePath, exclude)) {
      continue;
    }

    if (entry.isDirectory()) {
      const truncated = await walkFiles(root, absolutePath, exclude, maxFiles, collected);
      if (truncated) {
        return true;
      }
      continue;
    }

    const extension = path.extname(entry.name);
    if (!SOURCE_EXTENSIONS.has(extension)) {
      continue;
    }

    const content = await readFile(absolutePath, 'utf8');
    collected.push({
      relativePath,
      absolutePath,
      extension,
      content,
      nonBlankLines: countNonBlankLines(content),
    });
  }

  return false;
}

async function gitAvailable(repositoryPath: string): Promise<boolean> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repositoryPath });
    return true;
  } catch {
    return false;
  }
}

export function computeInputId(repositoryPath: string, files: SourceFile[], config: RegScoreConfig): string {
  const hash = createHash('sha256');
  hash.update(repositoryPath);
  hash.update(JSON.stringify(config));
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update(String(file.nonBlankLines));
  }
  return hash.digest('hex').slice(0, 16);
}

export async function loadConfig(repositoryPath: string): Promise<RegScoreConfig> {
  const configPath = path.join(repositoryPath, 'reg-score.config.json');
  try {
    const raw = await readFile(configPath, 'utf8');
    return configSchema.parse(JSON.parse(raw));
  } catch {
    return defaultConfig;
  }
}

export async function createRepositorySnapshot(repositoryPath: string): Promise<RepositorySnapshot> {
  const resolved = path.resolve(repositoryPath);
  const config = await loadConfig(resolved);
  const files: SourceFile[] = [];
  const truncated = await walkFiles(resolved, resolved, config.exclude, config.maxFiles, files);
  const git = await gitAvailable(resolved);

  return {
    repositoryPath: resolved,
    inputId: computeInputId(resolved, files, config),
    files,
    gitAvailable: git,
    truncated,
    config,
  };
}
