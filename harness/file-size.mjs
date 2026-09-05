import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import {
  resolveRepositoryPath,
  toRepositoryPath,
  walkFiles,
} from './paths.mjs';

export function countNonBlankLines(text) {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

export async function collectSourceStats({ root, config }) {
  const paths = new Set();
  for (const sourceRoot of config.sourceRoots) {
    const absoluteRoot = resolveRepositoryPath(root, sourceRoot);
    for (const path of await walkFiles(absoluteRoot, { excludeSegments: config.excludeSegments })) {
      if (config.sourceExtensions.includes(extname(path))) {
        paths.add(path);
      }
    }
  }

  const stats = [];
  for (const path of [...paths].sort((left, right) => left.localeCompare(right))) {
    const text = await readFile(path, 'utf8');
    stats.push({
      path: toRepositoryPath(root, path),
      nonBlankLines: countNonBlankLines(text),
    });
  }
  return stats.sort((left, right) => left.path.localeCompare(right.path));
}

export async function checkFileSize({ root, config }) {
  const stats = await collectSourceStats({ root, config });
  return stats
    .filter(({ nonBlankLines }) => nonBlankLines > config.maxNonBlankLines)
    .map(({ path, nonBlankLines }) => ({
      checkId: 'file-size',
      path,
      message: `${nonBlankLines} nonblank lines exceeds limit ${config.maxNonBlankLines}`,
      actual: nonBlankLines,
      limit: config.maxNonBlankLines,
    }));
}

