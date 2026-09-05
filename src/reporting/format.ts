import type { DiagnosisReport } from '../schema/report.v1.js';

export function formatJsonReport(report: DiagnosisReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function formatConsoleReport(report: DiagnosisReport): string {
  const lines: string[] = [];
  lines.push(`Regression Risk Score: ${report.repository.regressionRiskScore} (confidence ${report.repository.confidence})`);
  if (report.repository.riskDelta !== undefined) {
    lines.push(`Risk delta: ${report.repository.riskDelta >= 0 ? '+' : ''}${report.repository.riskDelta}`);
  }
  lines.push(report.repository.disclaimer);
  lines.push('');
  lines.push('Axes:');
  for (const axis of report.axes) {
    const status = axis.unevaluated ? 'unevaluated' : `${axis.score}`;
    lines.push(`  - ${axis.name}: ${status}`);
  }
  lines.push('');
  lines.push('Top clusters:');
  for (const cluster of report.clusters.slice(0, 5)) {
    lines.push(`  - [${cluster.score}] ${cluster.title}: ${cluster.paths.join(', ')}`);
  }
  lines.push('');
  lines.push('Interventions:');
  for (const item of report.interventions.slice(0, 5)) {
    lines.push(`  - (${item.priority}) ${item.title}`);
  }
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
    lines.push(`- Paths: ${cluster.paths.join(', ') || 'n/a'}`);
    lines.push(`- Triggers: ${cluster.triggerChanges.join('; ')}`);
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
