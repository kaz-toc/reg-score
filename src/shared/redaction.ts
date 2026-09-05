import { createHash } from 'node:crypto';

import type { DiffReport, DiagnosisReport, EvidenceChange, BlastRadiusEntry } from '../schema/report.v1.js';

export function redactionPolicyFingerprint(redactPaths: string[]): string {
  const normalized = [...new Set(redactPaths)].sort();
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function redactString(value: string, redactPaths: string[]): string {
  if (redactPaths.length === 0) {
    return value;
  }
  let result = value;
  for (const pattern of redactPaths) {
    result = result.split(pattern).join('[REDACTED]');
  }
  return result;
}

function redactOptionalString(value: string | undefined, redactPaths: string[]): string | undefined {
  return value ? redactString(value, redactPaths) : value;
}

function redactMetrics(
  metrics: Record<string, string | number | boolean> | undefined,
  redactPaths: string[],
): Record<string, string | number | boolean> | undefined {
  if (!metrics || redactPaths.length === 0) {
    return metrics;
  }
  const redacted: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metrics)) {
    redacted[key] = typeof value === 'string' ? redactString(value, redactPaths) : value;
  }
  return redacted;
}

function redactEvidenceChange(change: EvidenceChange, redactPaths: string[]): EvidenceChange {
  return {
    ...change,
    evidenceId: redactString(change.evidenceId, redactPaths),
    path: redactOptionalString(change.path, redactPaths),
    message: redactString(change.message, redactPaths),
  };
}

function redactBlastRadiusEntry(entry: BlastRadiusEntry, redactPaths: string[]): BlastRadiusEntry {
  return {
    changedFile: redactString(entry.changedFile, redactPaths),
    directDependents: entry.directDependents.map((p) => redactString(p, redactPaths)),
    directDependencies: entry.directDependencies.map((p) => redactString(p, redactPaths)),
    transitiveDependents: entry.transitiveDependents.map((p) => redactString(p, redactPaths)),
    transitiveDependencies: entry.transitiveDependencies.map((p) => redactString(p, redactPaths)),
    paths: entry.paths.map((edge) => ({
      from: redactString(edge.from, redactPaths),
      to: redactString(edge.to, redactPaths),
    })),
  };
}

export function redactReport(report: DiagnosisReport, redactPaths: string[]): DiagnosisReport {
  if (redactPaths.length === 0) {
    return report;
  }

  return {
    ...report,
    metadata: {
      ...report.metadata,
      repositoryPath: redactString(report.metadata.repositoryPath, redactPaths),
      inputId: redactString(report.metadata.inputId, redactPaths),
      unevaluatedAreas: report.metadata.unevaluatedAreas.map((area) => redactString(area, redactPaths)),
    },
    clusters: report.clusters.map((cluster) => ({
      ...cluster,
      clusterId: redactString(cluster.clusterId, redactPaths),
      paths: cluster.paths.map((p) => redactString(p, redactPaths)),
      triggerChanges: cluster.triggerChanges.map((t) => redactString(t, redactPaths)),
      evidenceIds: cluster.evidenceIds.map((id) => redactString(id, redactPaths)),
    })),
    evidence: report.evidence.map((item) => ({
      ...item,
      evidenceId: redactString(item.evidenceId, redactPaths),
      path: redactOptionalString(item.path, redactPaths),
      message: redactString(item.message, redactPaths),
      metrics: redactMetrics(item.metrics, redactPaths),
    })),
    semanticFindings: report.semanticFindings.map((finding) => ({
      ...finding,
      findingId: redactString(finding.findingId, redactPaths),
      path: redactOptionalString(finding.path, redactPaths),
      summary: redactString(finding.summary, redactPaths),
      relatedEvidenceIds: finding.relatedEvidenceIds.map((id) => redactString(id, redactPaths)),
    })),
    interventions: report.interventions.map((item) => ({
      ...item,
      interventionId: redactString(item.interventionId, redactPaths),
      targetPaths: item.targetPaths.map((p) => redactString(p, redactPaths)),
      description: redactString(item.description, redactPaths),
      verification: redactString(item.verification, redactPaths),
      linkedClusterIds: item.linkedClusterIds.map((id) => redactString(id, redactPaths)),
    })),
  };
}

export function redactDiffReport(diff: DiffReport, redactPaths: string[]): DiffReport {
  if (redactPaths.length === 0) {
    return diff;
  }

  return {
    ...diff,
    current: redactReport(diff.current, redactPaths),
    base: diff.base ? redactReport(diff.base, redactPaths) : undefined,
    comparison: {
      ...diff.comparison,
      reason: redactOptionalString(diff.comparison.reason, redactPaths),
      changedFiles: diff.comparison.changedFiles.map((file) => redactString(file, redactPaths)),
      blastRadius: diff.comparison.blastRadius.map((entry) => redactBlastRadiusEntry(entry, redactPaths)),
      newSignals: diff.comparison.newSignals.map((change) => redactEvidenceChange(change, redactPaths)),
      worsenedSignals: diff.comparison.worsenedSignals.map((change) => redactEvidenceChange(change, redactPaths)),
      improvedSignals: diff.comparison.improvedSignals.map((change) => redactEvidenceChange(change, redactPaths)),
    },
  };
}

export function redactStringList(values: string[], redactPaths: string[]): string[] {
  return values.map((value) => redactString(value, redactPaths));
}
