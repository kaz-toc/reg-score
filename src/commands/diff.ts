import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { DiagnosisReport } from '../schema/report.v1.js';
import { buildImportGraph } from '../evidence/deterministic.js';
import { createRepositorySnapshot } from '../intake/snapshot.js';
import { runDiagnosis } from '../pipeline/diagnose.js';

const execFileAsync = promisify(execFile);

export type BlastRadiusEntry = {
  changedFile: string;
  directDependents: string[];
  directDependencies: string[];
};

export type DiffResult = {
  current: DiagnosisReport;
  base: DiagnosisReport;
  changedFiles: string[];
  blastRadius: BlastRadiusEntry[];
  newSignals: string[];
  worsenedSignals: string[];
  improvedSignals: string[];
  contractMismatch: boolean;
};

export function compareSignalChanges(
  current: DiagnosisReport,
  base: DiagnosisReport,
): Pick<DiffResult, 'newSignals' | 'worsenedSignals' | 'improvedSignals'> {
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

  for (const id of baseSignals.keys()) {
    if (!currentSignals.has(id)) {
      improvedSignals.push(id);
    }
  }

  return {
    newSignals: [...new Set(newSignals)].sort(),
    worsenedSignals: [...new Set(worsenedSignals)].sort(),
    improvedSignals: [...new Set(improvedSignals)].sort(),
  };
}

export function computeBlastRadius(
  changedFiles: string[],
  repositoryPath: string,
  snapshotFiles: { relativePath: string }[],
): BlastRadiusEntry[] {
  const snapshot = { files: snapshotFiles, repositoryPath, inputId: '', gitAvailable: false, truncated: false, config: {} as never };
  const edges = buildImportGraph(snapshot as never);
  const normalizedChanged = new Set(changedFiles.map((file) => file.replace(/\\/g, '/')));

  return [...normalizedChanged].sort().map((changedFile) => {
    const directDependents = edges
      .filter((edge) => edge.to === changedFile || edge.to.endsWith(`/${changedFile}`))
      .map((edge) => edge.from)
      .sort();
    const directDependencies = edges
      .filter((edge) => edge.from === changedFile)
      .map((edge) => edge.to)
      .filter((target) => !target.startsWith('.'))
      .sort();
    return { changedFile, directDependents, directDependencies };
  });
}

async function listChangedFiles(repositoryPath: string, baseRef: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', `${baseRef}...HEAD`], {
      cwd: repositoryPath,
    });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(line))
      .sort();
  } catch {
    try {
      const { stdout } = await execFileAsync('git', ['diff', '--name-only', baseRef, 'HEAD'], {
        cwd: repositoryPath,
      });
      return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(line))
        .sort();
    } catch {
      return [];
    }
  }
}

async function checkoutRef(repositoryPath: string, ref: string, worktreePath: string): Promise<void> {
  await execFileAsync('git', ['worktree', 'add', '--detach', worktreePath, ref], { cwd: repositoryPath });
}

export async function runDiffDiagnosis(repositoryPath: string, baseRef: string): Promise<DiffResult> {
  const resolved = path.resolve(repositoryPath);
  const currentSnapshot = await createRepositorySnapshot(resolved);
  const current = await runDiagnosis(currentSnapshot);
  const changedFiles = await listChangedFiles(resolved, baseRef);
  const blastRadius = computeBlastRadius(changedFiles, resolved, currentSnapshot.files);

  const worktreePath = await mkdtemp(path.join(os.tmpdir(), 'reg-score-diff-'));
  try {
    await checkoutRef(resolved, baseRef, worktreePath);
    const baseSnapshot = await createRepositorySnapshot(worktreePath);
    const base = await runDiagnosis(baseSnapshot);

    const contractMismatch =
      base.metadata.assessmentContractVersion !== current.metadata.assessmentContractVersion;

    const signalChanges = compareSignalChanges(current, base);

    if (!contractMismatch) {
      current.repository.riskDelta = current.repository.regressionRiskScore - base.repository.regressionRiskScore;
      current.repository.baselineId = base.metadata.inputId;
    }

    return {
      current,
      base,
      changedFiles,
      blastRadius,
      ...signalChanges,
      contractMismatch,
    };
  } finally {
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: resolved });
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
    '## Changed files',
    ...(diff.changedFiles.length > 0 ? diff.changedFiles.map((f) => `- ${f}`) : ['- (none detected)']),
    '',
    '## Blast radius',
    ...diff.blastRadius.flatMap((entry) => [
      `### ${entry.changedFile}`,
      `- Dependents: ${entry.directDependents.join(', ') || 'none'}`,
      `- Dependencies: ${entry.directDependencies.join(', ') || 'none'}`,
    ]),
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

export async function writeGitHubAnnotations(diff: DiffResult, outputPath: string): Promise<void> {
  const lines: string[] = [];
  const advisorySignals = [...diff.newSignals, ...diff.worsenedSignals];

  for (const evidenceId of advisorySignals) {
    const evidence = diff.current.evidence.find((item) => item.evidenceId === evidenceId);
    if (!evidence?.path) {
      continue;
    }
    const level = evidence.severity === 'high' ? 'error' : 'warning';
    const message = `reg-score: ${evidence.message} (${evidence.signalId})`;
    lines.push(`::${level} file=${evidence.path},line=1::${message}`);
  }

  if (diff.contractMismatch) {
    lines.push('::notice title=reg-score::Assessment contract mismatch — compare scores cautiously');
  }

  await writeFile(outputPath, `${lines.join('\n')}\n`);
}
