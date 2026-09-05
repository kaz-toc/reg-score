import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { DiagnosisReport, DiffReport, EvidenceChange } from '../schema/report.v1.js';
import { diffReportSchema } from '../schema/report.v1.js';
import { DefaultGitProvider } from '../adapters/git-provider.js';
import { buildImportGraph } from '../evidence/deterministic.js';
import { createRepositorySnapshot } from '../intake/snapshot.js';
import { runDiagnosis, loadBaseline } from '../pipeline/diagnose.js';
import type { BlastRadiusEntry } from '../schema/report.v1.js';

const execFileAsync = promisify(execFile);

const severityRank = { low: 1, medium: 2, high: 3 } as const;

export function compareSignalChanges(
  current: DiagnosisReport,
  base: DiagnosisReport,
): Pick<DiffReport['comparison'], 'newSignals' | 'worsenedSignals' | 'improvedSignals'> {
  const currentSignals = new Map(current.evidence.map((e) => [e.evidenceId, e]));
  const baseSignals = new Map(base.evidence.map((e) => [e.evidenceId, e]));

  const newSignals: EvidenceChange[] = [];
  const worsenedSignals: EvidenceChange[] = [];
  const improvedSignals: EvidenceChange[] = [];

  for (const [id, evidence] of currentSignals.entries()) {
    const previous = baseSignals.get(id);
    if (!previous) {
      newSignals.push({
        evidenceId: evidence.evidenceId,
        signalId: evidence.signalId,
        path: evidence.path,
        currentSeverity: evidence.severity,
        message: evidence.message,
      });
      continue;
    }
    if (severityRank[evidence.severity] > severityRank[previous.severity]) {
      worsenedSignals.push({
        evidenceId: evidence.evidenceId,
        signalId: evidence.signalId,
        path: evidence.path,
        previousSeverity: previous.severity,
        currentSeverity: evidence.severity,
        message: evidence.message,
      });
    } else if (severityRank[evidence.severity] < severityRank[previous.severity]) {
      improvedSignals.push({
        evidenceId: evidence.evidenceId,
        signalId: evidence.signalId,
        path: evidence.path,
        previousSeverity: previous.severity,
        currentSeverity: evidence.severity,
        message: evidence.message,
      });
    }
  }

  for (const [id, evidence] of baseSignals.entries()) {
    if (!currentSignals.has(id)) {
      improvedSignals.push({
        evidenceId: evidence.evidenceId,
        signalId: evidence.signalId,
        path: evidence.path,
        previousSeverity: evidence.severity,
        message: evidence.message,
      });
    }
  }

  return {
    newSignals: newSignals.sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)),
    worsenedSignals: worsenedSignals.sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)),
    improvedSignals: improvedSignals.sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)),
  };
}

function transitiveReach(start: string, edges: Array<{ from: string; to: string }>, direction: 'dependents' | 'dependencies'): {
  nodes: Set<string>;
  paths: Array<{ from: string; to: string }>;
} {
  const nodes = new Set<string>();
  const pathEdges: Array<{ from: string; to: string }> = [];
  const queue = [start];
  const visited = new Set<string>([start]);

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) {
      continue;
    }
    const nextEdges =
      direction === 'dependents'
        ? edges.filter((edge) => edge.to === node)
        : edges.filter((edge) => edge.from === node);

    for (const edge of nextEdges) {
      const next = direction === 'dependents' ? edge.from : edge.to;
      pathEdges.push({ from: edge.from, to: edge.to });
      if (!visited.has(next)) {
        visited.add(next);
        nodes.add(next);
        queue.push(next);
      }
    }
  }

  return { nodes, paths: pathEdges };
}

export function computeBlastRadius(
  changedFiles: string[],
  repositoryPath: string,
  snapshotFiles: { relativePath: string }[],
): BlastRadiusEntry[] {
  const snapshot = {
    files: snapshotFiles,
    repositoryPath,
    inputId: '',
    gitAvailable: false,
    truncated: false,
    intakeIssues: [],
    config: {} as never,
  };
  const edges = buildImportGraph(snapshot as never)
    .filter((edge) => edge.kind === 'relative')
    .map((edge) => ({ from: edge.from, to: edge.to }));
  const normalizedChanged = [...new Set(changedFiles.map((file) => file.replace(/\\/g, '/')))].sort();

  return normalizedChanged.map((changedFile) => {
    const directDependents = edges.filter((edge) => edge.to === changedFile).map((edge) => edge.from).sort();
    const directDependencies = edges.filter((edge) => edge.from === changedFile).map((edge) => edge.to).sort();
    const up = transitiveReach(changedFile, edges, 'dependents');
    const down = transitiveReach(changedFile, edges, 'dependencies');
    return {
      changedFile,
      directDependents,
      directDependencies,
      transitiveDependents: [...up.nodes].sort(),
      transitiveDependencies: [...down.nodes].sort(),
      paths: [...up.paths, ...down.paths].sort((a, b) => `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`)),
    };
  });
}

async function checkoutRef(repositoryPath: string, ref: string, worktreePath: string): Promise<void> {
  await execFileAsync('git', ['worktree', 'add', '--detach', worktreePath, ref], { cwd: repositoryPath });
}

function assessContractCompatibility(base: DiagnosisReport, current: DiagnosisReport): { compatible: boolean; reason?: string } {
  if (base.metadata.assessmentContractVersion !== current.metadata.assessmentContractVersion) {
    return {
      compatible: false,
      reason: `assessment contract mismatch: base v${base.metadata.assessmentContractVersion}, current v${current.metadata.assessmentContractVersion}`,
    };
  }
  if (base.metadata.schemaVersion !== current.metadata.schemaVersion) {
    return {
      compatible: false,
      reason: `report schema mismatch: base v${base.metadata.schemaVersion}, current v${current.metadata.schemaVersion}`,
    };
  }
  return { compatible: true };
}

export async function runDiffDiagnosis(repositoryPath: string, baseRef: string): Promise<DiffReport> {
  const resolved = path.resolve(repositoryPath);
  const currentSnapshot = await createRepositorySnapshot(resolved);
  const current = await runDiagnosis(currentSnapshot);
  const git = new DefaultGitProvider();
  const changedFiles = await git.listChangedFiles(resolved, baseRef);
  const blastRadius = computeBlastRadius(changedFiles, resolved, currentSnapshot.files);

  const worktreePath = await mkdtemp(path.join(os.tmpdir(), 'reg-score-diff-'));
  let gitBase: DiagnosisReport;
  try {
    await checkoutRef(resolved, baseRef, worktreePath);
    const baseSnapshot = await createRepositorySnapshot(worktreePath);
    gitBase = await runDiagnosis(baseSnapshot);
  } finally {
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: resolved });
    } catch {
      await rm(worktreePath, { recursive: true, force: true });
    }
  }

  const storedBaseline = await loadBaseline(currentSnapshot);
  let compatible = false;
  let reason: string | undefined;
  let riskDelta: number | undefined;
  let baselineId: string | undefined;
  let signalChanges: Pick<DiffReport['comparison'], 'newSignals' | 'worsenedSignals' | 'improvedSignals'> = {
    newSignals: [],
    worsenedSignals: [],
    improvedSignals: [],
  };

  if (!storedBaseline) {
    reason = 'no stored baseline manifest — score and signal comparison suppressed';
  } else {
    const compatibility = assessContractCompatibility(storedBaseline.entry.report, current);
    compatible = compatibility.compatible;
    reason = compatibility.reason;
    if (compatible) {
      baselineId = storedBaseline.entry.inputId;
      signalChanges = compareSignalChanges(current, storedBaseline.entry.report);
      riskDelta = current.repository.regressionRiskScore - storedBaseline.entry.report.repository.regressionRiskScore;
    }
  }

  const diffReport: DiffReport = {
    schemaVersion: 1,
    current,
    base: gitBase,
    comparison: {
      compatible,
      reason,
      riskDelta,
      baselineId,
      changedFiles,
      blastRadius,
      ...signalChanges,
    },
  };

  return diffReportSchema.parse(diffReport);
}
