import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { DiagnosisReport } from '../schema/report.v1.js';
import { createRepositorySnapshot } from '../intake/snapshot.js';
import { runDiagnosis } from '../pipeline/diagnose.js';

const execFileAsync = promisify(execFile);

export type DiffResult = {
  current: DiagnosisReport;
  base: DiagnosisReport;
  newSignals: string[];
  worsenedSignals: string[];
  improvedSignals: string[];
  contractMismatch: boolean;
};

async function checkoutRef(repositoryPath: string, ref: string, worktreePath: string): Promise<void> {
  await execFileAsync('git', ['worktree', 'add', '--detach', worktreePath, ref], { cwd: repositoryPath });
}

export async function runDiffDiagnosis(repositoryPath: string, baseRef: string): Promise<DiffResult> {
  const currentSnapshot = await createRepositorySnapshot(repositoryPath);
  const current = await runDiagnosis(currentSnapshot);

  const worktreePath = await mkdtemp(path.join(os.tmpdir(), 'reg-score-diff-'));
  try {
    await checkoutRef(repositoryPath, baseRef, worktreePath);
    const baseSnapshot = await createRepositorySnapshot(worktreePath);
    const base = await runDiagnosis(baseSnapshot);

    const contractMismatch =
      base.metadata.assessmentContractVersion !== current.metadata.assessmentContractVersion;

    const currentSignals = new Map(current.evidence.map((e) => [e.evidenceId, e.severity]));
    const baseSignals = new Map(base.evidence.map((e) => [e.evidenceId, e.severity]));
    const severityRank = { low: 1, medium: 2, high: 3 } as const;

    const newSignals: string[] = [];
    const worsenedSignals: string[] = [];
    const improvedSignals: string[] = [];

    for (const [id, severity] of currentSignals.entries()) {
      const previous = baseSignals.get(id);
      if (!previous) {
        newSignals.push(id);
        continue;
      }
      if (severityRank[severity] > severityRank[previous]) {
        worsenedSignals.push(id);
      } else if (severityRank[severity] < severityRank[previous]) {
        improvedSignals.push(id);
      }
    }

    if (!contractMismatch) {
      current.repository.riskDelta = current.repository.regressionRiskScore - base.repository.regressionRiskScore;
      current.repository.baselineId = base.metadata.inputId;
    }

    return {
      current,
      base,
      newSignals: newSignals.sort(),
      worsenedSignals: worsenedSignals.sort(),
      improvedSignals: improvedSignals.sort(),
      contractMismatch,
    };
  } finally {
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repositoryPath });
    } catch {
      await rm(worktreePath, { recursive: true, force: true });
    }
  }
}

export async function writeGitHubSummary(diff: DiffResult, outputPath: string): Promise<void> {
  const lines = [
    '# reg-score PR Advisory',
    '',
    `Score: ${diff.current.repository.regressionRiskScore}`,
    diff.contractMismatch
      ? 'Contract mismatch — delta suppressed'
      : `Delta vs base: ${diff.current.repository.riskDelta ?? 0}`,
    '',
    '## New signals',
    ...diff.newSignals.map((s) => `- ${s}`),
    '',
    '## Worsened',
    ...diff.worsenedSignals.map((s) => `- ${s}`),
    '',
    '## Improved',
    ...diff.improvedSignals.map((s) => `- ${s}`),
  ];
  await writeFile(outputPath, `${lines.join('\n')}\n`);
}
