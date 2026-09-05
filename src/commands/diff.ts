import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
      pathEdges.push(edge);
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
  const edges = buildImportGraph(snapshot as never).filter((edge) => edge.kind === 'relative');
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

async function listChangedFiles(repositoryPath: string, baseRef: string): Promise<string[]> {
  return new DefaultGitProvider().listChangedFiles(repositoryPath, baseRef);
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
  const changedFiles = await listChangedFiles(resolved, baseRef);
  const blastRadius = computeBlastRadius(changedFiles, resolved, currentSnapshot.files);

  const worktreePath = await mkdtemp(path.join(os.tmpdir(), 'reg-score-diff-'));
  let base: DiagnosisReport;
  try {
    await checkoutRef(resolved, baseRef, worktreePath);
    const baseSnapshot = await createRepositorySnapshot(worktreePath);
    base = await runDiagnosis(baseSnapshot);
  } finally {
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: resolved });
    } catch {
      await rm(worktreePath, { recursive: true, force: true });
    }
  }

  const storedBaseline = await loadBaseline(currentSnapshot);
  const compatibility = storedBaseline
    ? assessContractCompatibility(storedBaseline.entry.report, current)
    : assessContractCompatibility(base, current);

  const signalChanges = compatibility.compatible ? compareSignalChanges(current, base) : {
    newSignals: [],
    worsenedSignals: [],
    improvedSignals: [],
  };

  if (compatibility.compatible) {
    current.repository.riskDelta = current.repository.regressionRiskScore - base.repository.regressionRiskScore;
    current.repository.baselineId = base.metadata.inputId;
  }

  const diffReport: DiffReport = {
    schemaVersion: 1,
    current,
    base,
    comparison: {
      compatible: compatibility.compatible,
      reason: compatibility.reason,
      riskDelta: compatibility.compatible
        ? current.repository.regressionRiskScore - base.repository.regressionRiskScore
        : undefined,
      changedFiles,
      blastRadius,
      ...signalChanges,
    },
  };

  return diffReportSchema.parse(diffReport);
}

export async function writeGitHubSummary(diff: DiffReport, outputPath: string): Promise<void> {
  const lines = [
    '# reg-score PR Advisory',
    '',
    `Score: ${diff.current.repository.regressionRiskScore}`,
    diff.comparison.compatible
      ? `Delta vs base: ${diff.comparison.riskDelta ?? 0}`
      : `Contract incompatible — ${diff.comparison.reason ?? 'delta suppressed'}`,
    '',
    '## Changed files',
    ...(diff.comparison.changedFiles.length > 0 ? diff.comparison.changedFiles.map((f) => `- ${f}`) : ['- (none detected)']),
    '',
    '## Blast radius',
    ...diff.comparison.blastRadius.flatMap((entry) => [
      `### ${entry.changedFile}`,
      `- Direct dependents: ${entry.directDependents.join(', ') || 'none'}`,
      `- Transitive dependents: ${entry.transitiveDependents.join(', ') || 'none'}`,
      `- Paths: ${entry.paths.map((p) => `${p.from}->${p.to}`).join('; ') || 'none'}`,
    ]),
    '',
    '## New signals',
    ...diff.comparison.newSignals.map((s) => `- ${s.evidenceId}: ${s.message}`),
    '',
    '## Worsened',
    ...diff.comparison.worsenedSignals.map((s) => `- ${s.evidenceId}: ${s.message}`),
    '',
    '## Improved',
    ...diff.comparison.improvedSignals.map((s) => `- ${s.evidenceId}: ${s.message}`),
  ];
  await writeFile(outputPath, `${lines.join('\n')}\n`);
}

export async function writeGitHubAnnotations(diff: DiffReport, outputPath: string): Promise<void> {
  const lines: string[] = [];
  const advisorySignals = [...diff.comparison.newSignals, ...diff.comparison.worsenedSignals];

  for (const change of advisorySignals) {
    if (!change.path) {
      continue;
    }
    const evidence = diff.current.evidence.find((item) => item.evidenceId === change.evidenceId);
    const level = evidence?.severity === 'high' ? 'error' : 'warning';
    const message = `reg-score: ${change.message} (${change.signalId})`;
    lines.push(`::${level} file=${change.path},line=1::${message}`);
  }

  if (!diff.comparison.compatible) {
    lines.push(`::notice title=reg-score::${diff.comparison.reason ?? 'Assessment contract mismatch — compare scores cautiously'}`);
  }

  await writeFile(outputPath, `${lines.join('\n')}\n`);
}

export function formatGitHubAnnotationsStdout(diff: DiffReport): string {
  const lines: string[] = [];
  for (const change of [...diff.comparison.newSignals, ...diff.comparison.worsenedSignals]) {
    if (!change.path) {
      continue;
    }
    const evidence = diff.current.evidence.find((item) => item.evidenceId === change.evidenceId);
    const level = evidence?.severity === 'high' ? 'error' : 'warning';
    lines.push(`::${level} file=${change.path},line=1::reg-score: ${change.message}`);
  }
  return `${lines.join('\n')}\n`;
}
