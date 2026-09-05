import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type GitProvider = {
  listChangedFiles(repositoryPath: string, baseRef: string): Promise<string[]>;
  resolveHeadCommit(repositoryPath: string): Promise<string | undefined>;
};

export class DefaultGitProvider implements GitProvider {
  async listChangedFiles(repositoryPath: string, baseRef: string): Promise<string[]> {
    const patterns = [`${baseRef}...HEAD`, null] as const;
    for (const range of patterns) {
      try {
        const args = range ? ['diff', '--name-only', range] : ['diff', '--name-only', baseRef, 'HEAD'];
        const { stdout } = await execFileAsync('git', args, { cwd: repositoryPath });
        return stdout
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/.test(line))
          .sort();
      } catch {
        continue;
      }
    }
    return [];
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
