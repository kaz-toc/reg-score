import path from 'node:path';

import { ConfigError } from './errors.js';

export function resolveStorageDir(repositoryPath: string, configuredDir: string, label: string): string {
  if (path.isAbsolute(configuredDir)) {
    throw new ConfigError(configuredDir, `${label} must be a relative repository path`);
  }

  const resolvedRepository = path.resolve(repositoryPath);
  const resolvedDir = path.resolve(resolvedRepository, configuredDir);
  const relative = path.relative(resolvedRepository, resolvedDir);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ConfigError(configuredDir, `${label} escapes repository root`);
  }

  return resolvedDir;
}

export function assertRetentionTarget(repositoryPath: string, targetPath: string, allowedDir: string): void {
  const resolvedRepository = path.resolve(repositoryPath);
  const resolvedTarget = path.resolve(targetPath);
  const resolvedAllowed = path.resolve(resolvedRepository, allowedDir);
  const relative = path.relative(resolvedAllowed, resolvedTarget);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ConfigError(targetPath, 'retention target escapes allowed storage directory');
  }
}
