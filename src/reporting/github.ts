import { writeFile } from 'node:fs/promises';

import type { DiffReport } from '../schema/report.v1.js';

function annotationLines(diff: DiffReport): string[] {
  const lines: string[] = [];

  for (const change of [...diff.comparison.newSignals, ...diff.comparison.worsenedSignals]) {
    if (!change.path) {
      continue;
    }
    const evidence = diff.current.evidence.find((item) => item.evidenceId === change.evidenceId);
    const level = evidence?.severity === 'high' ? 'error' : 'warning';
    const message = `reg-score: ${change.message} (${change.signalId})`;
    lines.push(`::${level} file=${change.path},line=1::${message}`);
  }

  if (!diff.comparison.compatible) {
    lines.push(
      `::notice title=reg-score::${diff.comparison.reason ?? 'Assessment contract mismatch — compare scores cautiously'}`,
    );
  }

  return lines;
}

export function formatGitHubAnnotations(diff: DiffReport): string {
  const lines = annotationLines(diff);
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

export async function writeGitHubAnnotationsFile(diff: DiffReport, outputPath: string): Promise<void> {
  await writeFile(outputPath, formatGitHubAnnotations(diff));
}

export async function writeGitHubSummaryFile(diff: DiffReport, outputPath: string): Promise<void> {
  const lines = [
    '# reg-score PR Advisory',
    '',
    `Score: ${diff.current.repository.regressionRiskScore}`,
    ...(diff.comparison.compatible && diff.base
      ? [
          `Baseline: ${diff.comparison.baselineId ?? diff.base.metadata.inputId}`,
          `Base score: ${diff.base.repository.regressionRiskScore}`,
          `Delta vs base: ${diff.comparison.riskDelta ?? 0}`,
        ]
      : [`Contract incompatible — ${diff.comparison.reason ?? 'delta suppressed'}`]),
    '',
    '## Changed files',
    ...(diff.comparison.changedFiles.length > 0 ? diff.comparison.changedFiles.map((f) => `- ${f}`) : ['- (none detected)']),
    '',
    '## Blast radius',
    ...diff.comparison.blastRadius.flatMap((entry) => [
      `### ${entry.changedFile}`,
      `- Direct dependents: ${entry.directDependents.join(', ') || 'none'}`,
      `- Direct dependencies: ${entry.directDependencies.join(', ') || 'none'}`,
      `- Transitive dependents: ${entry.transitiveDependents.join(', ') || 'none'}`,
      `- Transitive dependencies: ${entry.transitiveDependencies.join(', ') || 'none'}`,
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
