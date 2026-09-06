import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { R3DoctorError } from './errors.js';

export type MutationGuard = () => Promise<void>;

export async function atomicWriteFile(
  targetPath: string,
  content: string,
  guard: MutationGuard,
): Promise<void> {
  const dir = path.dirname(targetPath);
  const tempPath = path.join(dir, `.${path.basename(targetPath)}.${randomBytes(8).toString('hex')}.tmp`);
  await guard();
  try {
    await writeFile(tempPath, content, 'utf8');
    await guard();
    await rename(tempPath, targetPath);
    await guard();
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function atomicAppendLine(targetPath: string, line: string, guard: MutationGuard): Promise<void> {
  const dir = path.dirname(targetPath);
  await guard();
  await mkdir(dir, { recursive: true });
  await guard();
  const targetStat = await lstat(targetPath).catch(() => null);
  if (targetStat?.isSymbolicLink()) {
    throw new R3DoctorError(`refusing to append through symbolic link: ${targetPath}`);
  }
  const existing = await readFile(targetPath, 'utf8').catch(() => '');
  await atomicWriteFile(targetPath, `${existing}${line}\n`, guard);
}
