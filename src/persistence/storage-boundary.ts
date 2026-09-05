import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { ConfigError } from '../shared/errors.js';

export async function resolveSafeStorageDir(
  repositoryPath: string,
  configuredDir: string,
  label: string,
  create: boolean,
): Promise<string> {
  if (path.isAbsolute(configuredDir)) {
    throw new ConfigError(configuredDir, `${label} must be a relative repository path`);
  }

  const repositoryRealPath = await realpath(repositoryPath);
  const lexicalStoragePath = path.resolve(repositoryRealPath, configuredDir);
  const lexicalRelative = path.relative(repositoryRealPath, lexicalStoragePath);
  if (lexicalRelative.startsWith('..') || path.isAbsolute(lexicalRelative)) {
    throw new ConfigError(configuredDir, `${label} escapes repository root`);
  }

  let component = repositoryRealPath;
  for (const segment of lexicalRelative.split(path.sep).filter(Boolean)) {
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
  const relative = path.relative(repositoryRealPath, storageRealPath);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return storageRealPath;
  }

  throw new ConfigError(configuredDir, `${label} escapes repository root`);
}
