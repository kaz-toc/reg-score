import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/;

export type GitProvider = {
  listChangedFiles(repositoryPath: string, baseRef: string): Promise<string[]>;
  resolveHeadCommit(repositoryPath: string): Promise<string | undefined>;
};

function normalizeChangedFiles(lines: string[]): string[] {
  return [...new Set(lines.map((line) => line.trim()).filter((line) => SOURCE_FILE_PATTERN.test(line)))].sort();
}

async function runGit(repositoryPath: string, args: string[]): Promise<string[]> {
  const { stdout } = await execFileAsync('git', args, { cwd: repositoryPath });
  return stdout.split('\n');
}

async function listUntrackedFiles(repositoryPath: string): Promise<string[]> {
  try {
    const lines = await runGit(repositoryPath, ['ls-files', '--others', '--exclude-standard']);
    return normalizeChangedFiles(lines);
  } catch {
    return [];
  }
}

export class DefaultGitProvider implements GitProvider {
  async listChangedFiles(repositoryPath: string, baseRef: string): Promise<string[]> {
    const collected = new Set<string>();

    const commands: string[][] = [
      ['diff', '--name-only', baseRef],
      ['diff', '--cached', '--name-only', baseRef],
      ['diff', '--name-only', `${baseRef}...HEAD`],
    ];

    for (const args of commands) {
      try {
        for (const line of await runGit(repositoryPath, args)) {
          if (SOURCE_FILE_PATTERN.test(line.trim())) {
            collected.add(line.trim());
          }
        }
      } catch {
        continue;
      }
    }

    for (const line of await listUntrackedFiles(repositoryPath)) {
      collected.add(line);
    }

    return [...collected].sort();
  }

  async resolveHeadCommit(repositoryPath: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repositoryPath });
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }
}
