import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { ConfigError } from '../shared/errors.js';

export type SafeStorageDirectory = Readonly<{
  path: string;
  repositoryRealPath: string;
  configuredDir: string;
  label: string;
  device: number;
  inode: number;
}>;

const SHARED_OR_CONTROL_DIRECTORIES = new Set([
  '.git',
  '.github',
  '.r3-doctor',
  'build',
  'coverage',
  'dist',
  'docs',
  'node_modules',
  'src',
  'test',
  'tests',
]);

function isWithinRepository(repositoryRealPath: string, storageRealPath: string): boolean {
  const relative = path.relative(repositoryRealPath, storageRealPath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function aliasesSharedOrControlDirectory(
  repositoryRealPath: string,
  storageRealPath: string,
  storageDevice: number,
  storageInode: number,
): Promise<boolean> {
  const physicalSegments = path.relative(repositoryRealPath, storageRealPath).split(path.sep).filter(Boolean);
  if (physicalSegments.length !== 1) {
    return false;
  }
  for (const protectedName of SHARED_OR_CONTROL_DIRECTORIES) {
    const protectedStat = await lstat(path.join(repositoryRealPath, protectedName)).catch(() => null);
    if (protectedStat && protectedStat.dev === storageDevice && protectedStat.ino === storageInode) {
      return true;
    }
  }
  return false;
}

export async function resolveSafeStorageDir(
  repositoryPath: string,
  configuredDir: string,
  label: string,
  create: boolean,
): Promise<SafeStorageDirectory> {
  if (path.isAbsolute(configuredDir)) {
    throw new ConfigError(configuredDir, `${label} must be a relative repository path`);
  }

  const repositoryRealPath = await realpath(repositoryPath);
  const lexicalStoragePath = path.resolve(repositoryRealPath, configuredDir);
  const lexicalRelative = path.relative(repositoryRealPath, lexicalStoragePath);
  if (lexicalRelative.startsWith('..') || path.isAbsolute(lexicalRelative)) {
    throw new ConfigError(configuredDir, `${label} escapes repository root`);
  }
  const storageSegments = lexicalRelative.split(path.sep).filter(Boolean);
  if (storageSegments.length === 0) {
    throw new ConfigError(configuredDir, `${label} must not be the repository root`);
  }
  if (storageSegments.length === 1 && SHARED_OR_CONTROL_DIRECTORIES.has(storageSegments[0] ?? '')) {
    throw new ConfigError(configuredDir, `${label} must not use a shared or control directory`);
  }

  let component = repositoryRealPath;
  for (const segment of storageSegments) {
    component = path.join(component, segment);
    const componentStat = await lstat(component).catch(() => null);
    if (componentStat?.isSymbolicLink()) {
      throw new ConfigError(configuredDir, `${label} contains a symbolic link`);
    }
  }

  if (create) {
    await mkdir(lexicalStoragePath, { recursive: true });
  }

  const storageRealPath = await realpath(lexicalStoragePath);
  if (!isWithinRepository(repositoryRealPath, storageRealPath)) {
    throw new ConfigError(configuredDir, `${label} escapes repository root`);
  }
  const storageStat = await lstat(storageRealPath);
  if (!storageStat.isDirectory() || storageStat.isSymbolicLink()) {
    throw new ConfigError(configuredDir, `${label} must resolve to a regular directory`);
  }
  if (
    await aliasesSharedOrControlDirectory(
      repositoryRealPath,
      storageRealPath,
      storageStat.dev,
      storageStat.ino,
    )
  ) {
    throw new ConfigError(configuredDir, `${label} must not alias a shared or control directory`);
  }

  return {
    path: storageRealPath,
    repositoryRealPath,
    configuredDir,
    label,
    device: storageStat.dev,
    inode: storageStat.ino,
  };
}

export async function assertSafeStorageDir(boundary: SafeStorageDirectory): Promise<void> {
  const currentStat = await lstat(boundary.path).catch(() => null);
  if (!currentStat?.isDirectory() || currentStat.isSymbolicLink()) {
    throw new ConfigError(boundary.configuredDir, `${boundary.label} changed after validation`);
  }
  const currentRealPath = await realpath(boundary.path).catch(() => null);
  if (
    currentRealPath !== boundary.path ||
    !currentRealPath ||
    !isWithinRepository(boundary.repositoryRealPath, currentRealPath) ||
    currentStat.dev !== boundary.device ||
    currentStat.ino !== boundary.inode
  ) {
    throw new ConfigError(boundary.configuredDir, `${boundary.label} changed after validation`);
  }
}
