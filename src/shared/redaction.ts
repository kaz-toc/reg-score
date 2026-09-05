import type { DiagnosisReport } from '../schema/report.v1.js';

function redactPathSegment(segment: string, redactPaths: string[]): string {
  for (const pattern of redactPaths) {
    if (segment === pattern || segment.includes(pattern)) {
      return '[REDACTED]';
    }
  }
  return segment;
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

export function redactReport(report: DiagnosisReport, redactPaths: string[]): DiagnosisReport {
  if (redactPaths.length === 0) {
    return report;
  }

  return {
    ...report,
    metadata: {
      ...report.metadata,
      repositoryPath: redactString(report.metadata.repositoryPath, redactPaths),
      unevaluatedAreas: report.metadata.unevaluatedAreas.map((area) => redactString(area, redactPaths)),
    },
    clusters: report.clusters.map((cluster) => ({
      ...cluster,
      paths: cluster.paths.map((p) => redactString(p, redactPaths)),
      triggerChanges: cluster.triggerChanges.map((t) => redactString(t, redactPaths)),
    })),
    evidence: report.evidence.map((item) => ({
      ...item,
      path: item.path ? redactString(item.path, redactPaths) : item.path,
      message: redactString(item.message, redactPaths),
    })),
    semanticFindings: report.semanticFindings.map((finding) => ({
      ...finding,
      path: finding.path ? redactString(finding.path, redactPaths) : finding.path,
      summary: redactString(finding.summary, redactPaths),
    })),
    interventions: report.interventions.map((item) => ({
      ...item,
      targetPaths: item.targetPaths.map((p) => redactString(p, redactPaths)),
      description: redactString(item.description, redactPaths),
      verification: redactString(item.verification, redactPaths),
    })),
  };
}

export { redactPathSegment };
