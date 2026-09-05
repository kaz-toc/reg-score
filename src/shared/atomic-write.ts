import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { RegScoreError } from './errors.js';

export async function atomicWriteFile(targetPath: string, content: string): Promise<void> {
  const dir = path.dirname(targetPath);
  const tempPath = path.join(dir, `.${path.basename(targetPath)}.${randomBytes(8).toString('hex')}.tmp`);
  await writeFile(tempPath, content, 'utf8');
  await rename(tempPath, targetPath);
}

export async function atomicAppendLine(targetPath: string, line: string): Promise<void> {
  const dir = path.dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const targetStat = await lstat(targetPath).catch(() => null);
  if (targetStat?.isSymbolicLink()) {
    throw new RegScoreError(`refusing to append through symbolic link: ${targetPath}`);
  }
  const existing = await readFile(targetPath, 'utf8').catch(() => '');
  await atomicWriteFile(targetPath, `${existing}${line}\n`);
}
