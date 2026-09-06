import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type TestGitRepository = {
  path: string;
  baseSha: string;
  headSha: string;
  write(relativePath: string, content: string): Promise<void>;
  commit(message: string): Promise<string>;
  cleanup(): Promise<void>;
};

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

export async function createGitRepository(files: Record<string, string> = {}): Promise<TestGitRepository> {
  const repositoryPath = await mkdtemp(path.join(os.tmpdir(), 'r3-doctor-git-test-'));
  await git(repositoryPath, ['init']);
  await git(repositoryPath, ['config', 'user.email', 'r3-doctor@example.test']);
  await git(repositoryPath, ['config', 'user.name', 'r3-doctor test']);
  const initialFiles = {
    '.gitignore': '.r3-doctor/baselines/\n.r3-doctor/trends/\n',
    ...files,
  };
  for (const [relativePath, content] of Object.entries(initialFiles)) {
    const absolutePath = path.join(repositoryPath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }
  await git(repositoryPath, ['add', '.']);
  await git(repositoryPath, ['commit', '--allow-empty', '-m', 'base']);
  const baseSha = await git(repositoryPath, ['rev-parse', 'HEAD']);
  await writeFile(path.join(repositoryPath, 'test-head.txt'), 'head\n');
  await git(repositoryPath, ['add', '.']);
  await git(repositoryPath, ['commit', '-m', 'head']);
  const headSha = await git(repositoryPath, ['rev-parse', 'HEAD']);
  const write = async (relativePath: string, content: string): Promise<void> => {
    const absolutePath = path.join(repositoryPath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  };
  const commit = async (message: string): Promise<string> => {
    await git(repositoryPath, ['add', '.']);
    await git(repositoryPath, ['commit', '-m', message]);
    return git(repositoryPath, ['rev-parse', 'HEAD']);
  };
  const cleanup = (): Promise<void> => rm(repositoryPath, { recursive: true, force: true });
  return { path: repositoryPath, baseSha, headSha, write, commit, cleanup };
}
