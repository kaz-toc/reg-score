import path from 'node:path';

import { DefaultGitProvider } from '../adapters/git-provider.js';
import { compareDiagnosis } from '../comparison/compare.js';
import { buildImportGraph } from '../evidence/deterministic.js';
import { createRepositorySnapshot } from '../intake/snapshot.js';
import { diagnosisContextFingerprint } from '../intake/analysis-context.js';
import { loadPolicy } from '../operations/policy.js';
import { loadBaseline } from '../persistence/baseline-store.js';
import { runDiagnosis } from '../pipeline/diagnose.js';
import { DIFF_SCHEMA_VERSION, diffReportSchema } from '../schema/report.v1.js';
import type { BlastRadiusEntry, DiffReport } from '../schema/report.v1.js';
import { redactionPolicyFingerprint } from '../shared/redaction.js';

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

export async function runDiffDiagnosis(repositoryPath: string, baseRef: string): Promise<DiffReport> {
  const resolved = path.resolve(repositoryPath);
  const currentSnapshot = await createRepositorySnapshot(resolved);
  const current = await runDiagnosis(currentSnapshot);
  const policy = await loadPolicy(currentSnapshot.repositoryPath, currentSnapshot.config.policyFile);
  const git = new DefaultGitProvider();
  const resolvedBaseSha = await git.resolveRef(resolved, baseRef);
  const changedFiles = await git.listChangedFiles(resolved, resolvedBaseSha);
  const blastRadius = computeBlastRadius(changedFiles, resolved, currentSnapshot.files);
  const storedBaseline = await loadBaseline(currentSnapshot, resolvedBaseSha);
  const comparison = compareDiagnosis(current, storedBaseline.entry, {
    resolvedBaseSha,
    redactPaths: policy.redactPaths,
    redactionPolicyFingerprint: redactionPolicyFingerprint(policy.redactPaths),
    analysisContextFingerprint: diagnosisContextFingerprint(currentSnapshot.analysisContextFingerprint, current),
    changedFiles,
    blastRadius,
    incompatibilityReason: storedBaseline.reason,
  });

  const diffReport: DiffReport = {
    schemaVersion: DIFF_SCHEMA_VERSION,
    current,
    ...comparison,
  };

  return diffReportSchema.parse(diffReport);
}
