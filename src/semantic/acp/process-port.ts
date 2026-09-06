import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

import type { LlmLaunchSpec } from './provider-types.js';

export type LlmProcess = Pick<ChildProcess, 'kill'> & {
  stdin: Writable;
  stdout: Readable;
  once(event: 'error', listener: (error: Error & { code?: string }) => void): LlmProcess;
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): LlmProcess;
};

export type LlmSpawn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; shell: false; stdio: ['pipe', 'pipe', 'ignore'] },
) => LlmProcess;

export function spawnLlmProcess(spec: LlmLaunchSpec, spawn: LlmSpawn = nodeSpawn as LlmSpawn): LlmProcess {
  return spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    shell: false,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
}
