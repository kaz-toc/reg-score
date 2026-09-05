import type { DiagnosisReport, DiffReport } from '../schema/report.v1.js';

function evidenceLines(report: DiagnosisReport, evidenceIds: string[]): string[] {
  return evidenceIds
    .map((id) => report.evidence.find((item) => item.evidenceId === id))
    .filter(Boolean)
    .map((item) => `    - [${item!.severity}] ${item!.message}${item!.metrics ? ` (${JSON.stringify(item!.metrics)})` : ''}`);
}

export function formatJsonReport(report: DiagnosisReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatDiffJsonReport(diff: DiffReport): string {
  return `${JSON.stringify(diff, null, 2)}\n`;
}

export function formatConsoleReport(report: DiagnosisReport): string {
  const lines: string[] = [];
  lines.push(`Regression Risk Score: ${report.repository.regressionRiskScore} (confidence ${report.repository.confidence})`);
  if (report.repository.riskDelta !== undefined) {
    lines.push(`Risk delta: ${report.repository.riskDelta >= 0 ? '+' : ''}${report.repository.riskDelta}`);
  }
  lines.push(report.repository.disclaimer);
  lines.push('');
  lines.push('Capabilities:');
  for (const capability of report.capabilities) {
    lines.push(
      `  - ${capability.language} (${capability.completeness}): supported=${capability.supportedSignals.join(', ') || 'none'}; unevaluated=${capability.unevaluatedSignals.join(', ') || 'none'}`,
    );
  }
  lines.push('');
  lines.push('Axes:');
  for (const axis of report.axes) {
    const status = axis.unevaluated ? 'unevaluated' : `${axis.score}`;
    lines.push(`  - ${axis.name}: ${status}`);
  }
  lines.push('');
  lines.push('Top clusters:');
  for (const cluster of report.clusters.slice(0, 5)) {
    lines.push(`  - [${cluster.score}] ${cluster.title} (${cluster.mechanismId})`);
    lines.push(`    mechanism: ${cluster.failureMechanism}`);
    lines.push(`    triggers: ${cluster.triggerChanges.join('; ')}`);
    lines.push(`    paths: ${cluster.paths.join(', ') || 'n/a'}`);
    lines.push('    evidence:');
    lines.push(...evidenceLines(report, cluster.evidenceIds.slice(0, 3)));
  }
  lines.push('');
  if (report.metadata.unevaluatedAreas.length > 0) {
    lines.push('Unevaluated areas:');
    for (const area of report.metadata.unevaluatedAreas) {
      lines.push(`  - ${area}`);
    }
    lines.push('');
  }
  lines.push('Interventions:');
  for (const item of report.interventions.slice(0, 5)) {
    lines.push(`  - (${item.priority}) ${item.title}`);
  }
  return `${lines.join('\n')}\n`;
}

export function formatDiffConsoleReport(diff: DiffReport): string {
  const lines: string[] = [];
  lines.push(formatConsoleReport(diff.current).trimEnd());
  lines.push('');
  lines.push('Diff summary:');
  lines.push(`  compatible: ${diff.comparison.compatible}`);
  if (diff.comparison.reason) {
    lines.push(`  reason: ${diff.comparison.reason}`);
  }
  lines.push(`  changed files: ${diff.comparison.changedFiles.join(', ') || 'none'}`);
  lines.push(`  new signals: ${diff.comparison.newSignals.length}`);
  lines.push(`  worsened signals: ${diff.comparison.worsenedSignals.length}`);
  lines.push(`  improved signals: ${diff.comparison.improvedSignals.length}`);
  return `${lines.join('\n')}\n`;
}

export function formatMarkdownReport(report: DiagnosisReport): string {
  const lines: string[] = [];
  lines.push('# reg-score Diagnosis Report');
  lines.push('');
  lines.push(`- Generated: ${report.metadata.generatedAt}`);
  lines.push(`- Input ID: ${report.metadata.inputId}`);
  lines.push(`- Contract: v${report.metadata.assessmentContractVersion}`);
  lines.push('');
  lines.push('## Repository Assessment');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Regression Risk Score | ${report.repository.regressionRiskScore} |`);
  lines.push(`| Confidence | ${report.repository.confidence} |`);
  if (report.repository.riskDelta !== undefined) {
    lines.push(`| Risk Delta | ${report.repository.riskDelta} |`);
  }
  lines.push('');
  lines.push(`> ${report.repository.disclaimer}`);
  lines.push('');
  lines.push('## Capabilities');
  lines.push('');
  for (const capability of report.capabilities) {
    lines.push(`- ${capability.language} (${capability.completeness}, ${capability.analyzerId})`);
    lines.push(`  - supported: ${capability.supportedSignals.join(', ') || 'none'}`);
    lines.push(`  - unevaluated: ${capability.unevaluatedSignals.join(', ') || 'none'}`);
  }
  lines.push('');
  lines.push('## Risk Axes');
  lines.push('');
  for (const axis of report.axes) {
    lines.push(`### ${axis.name}`);
    lines.push(`- Score: ${axis.unevaluated ? 'unevaluated' : axis.score}`);
    lines.push(`- Contribution: ${axis.contribution}`);
    lines.push(`- Confidence: ${axis.confidence}`);
    lines.push('');
  }
  lines.push('## Risk Clusters');
  lines.push('');
  for (const cluster of report.clusters) {
    lines.push(`### ${cluster.title} (${cluster.score})`);
    lines.push(`- Mechanism: ${cluster.failureMechanism}`);
    lines.push(`- Mechanism ID: ${cluster.mechanismId}`);
    lines.push(`- Paths: ${cluster.paths.join(', ') || 'n/a'}`);
    lines.push(`- Triggers: ${cluster.triggerChanges.join('; ')}`);
    lines.push('- Evidence:');
    lines.push(...evidenceLines(report, cluster.evidenceIds).map((line) => line.replace(/^    /, '- ')));
    lines.push('');
  }
  lines.push('## Interventions');
  lines.push('');
  for (const item of report.interventions) {
    lines.push(`### ${item.priority}. ${item.title}`);
    lines.push(`- Kind: ${item.kind}`);
    lines.push(`- Targets: ${item.targetPaths.join(', ') || 'n/a'}`);
    lines.push(`- Expected: ${item.expectedEffect}`);
    lines.push(`- Verify: ${item.verification}`);
    lines.push('');
  }
  if (report.metadata.unevaluatedAreas.length > 0) {
    lines.push('## Unevaluated Areas');
    lines.push('');
    for (const area of report.metadata.unevaluatedAreas) {
      lines.push(`- ${area}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export function formatDiffMarkdownReport(diff: DiffReport): string {
  const lines = [formatMarkdownReport(diff.current).trimEnd(), '', '## Diff Comparison', ''];
  lines.push(`- Compatible: ${diff.comparison.compatible}`);
  if (diff.comparison.reason) {
    lines.push(`- Reason: ${diff.comparison.reason}`);
  }
  lines.push(`- Changed files: ${diff.comparison.changedFiles.join(', ') || 'none'}`);
  lines.push('');
  lines.push('### Signal changes');
  for (const change of [...diff.comparison.newSignals, ...diff.comparison.worsenedSignals, ...diff.comparison.improvedSignals]) {
    lines.push(`- ${change.evidenceId}: ${change.message}`);
  }
  return `${lines.join('\n')}\n`;
}

export function formatReport(report: DiagnosisReport, format: 'json' | 'markdown' | 'console'): string {
  switch (format) {
    case 'json':
      return formatJsonReport(report);
    case 'markdown':
      return formatMarkdownReport(report);
    case 'console':
      return formatConsoleReport(report);
  }
}

export function formatDiffReport(diff: DiffReport, format: 'json' | 'markdown' | 'console'): string {
  switch (format) {
    case 'json':
      return formatDiffJsonReport(diff);
    case 'markdown':
      return formatDiffMarkdownReport(diff);
    case 'console':
      return formatDiffConsoleReport(diff);
  }
}
