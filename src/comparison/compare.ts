import type {
  BaselineEntry,
  BlastRadiusEntry,
  DiagnosisReport,
  DiffReport,
  EvidenceChange,
} from '../schema/report.v1.js';
import { redactReport } from '../shared/redaction.js';

export type ComparisonContext = {
  resolvedBaseSha: string;
  redactPaths: string[];
  redactionPolicyFingerprint: string;
  changedFiles: string[];
  blastRadius: BlastRadiusEntry[];
  incompatibilityReason?: string;
};

export type ComparisonResult = {
  base?: DiagnosisReport;
  comparison: DiffReport['comparison'];
};

const severityRank = { low: 1, medium: 2, high: 3 } as const;

export function compareSignalChanges(
  current: DiagnosisReport,
  base: DiagnosisReport,
): Pick<DiffReport['comparison'], 'newSignals' | 'worsenedSignals' | 'improvedSignals'> {
  const currentSignals = new Map(current.evidence.map((evidence) => [evidence.evidenceId, evidence]));
  const baseSignals = new Map(base.evidence.map((evidence) => [evidence.evidenceId, evidence]));

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

function incompatible(context: ComparisonContext, reason: string): ComparisonResult {
  return {
    comparison: {
      compatible: false,
      reason,
      changedFiles: context.changedFiles,
      blastRadius: context.blastRadius,
      newSignals: [],
      worsenedSignals: [],
      improvedSignals: [],
    },
  };
}

export function compareDiagnosis(
  current: DiagnosisReport,
  baseline: BaselineEntry | null,
  context: ComparisonContext,
): ComparisonResult {
  if (!baseline) {
    return incompatible(
      context,
      context.incompatibilityReason ?? 'no stored baseline manifest — score and signal comparison suppressed',
    );
  }
  if (baseline.sourceCommitSha !== context.resolvedBaseSha) {
    return incompatible(
      context,
      `baseline commit mismatch: saved ${baseline.sourceCommitSha ?? 'none'}, requested ${context.resolvedBaseSha}`,
    );
  }
  if (baseline.assessmentContractVersion !== current.metadata.assessmentContractVersion) {
    return incompatible(
      context,
      `assessment contract mismatch: baseline v${baseline.assessmentContractVersion}, current v${current.metadata.assessmentContractVersion}`,
    );
  }
  if (baseline.report.metadata.schemaVersion !== current.metadata.schemaVersion) {
    return incompatible(
      context,
      `report schema mismatch: baseline v${baseline.report.metadata.schemaVersion}, current v${current.metadata.schemaVersion}`,
    );
  }
  if (baseline.redactionPolicyFingerprint !== context.redactionPolicyFingerprint) {
    return incompatible(context, 'redaction policy mismatch — score and signal comparison suppressed');
  }

  const comparisonCurrent = redactReport(current, context.redactPaths);
  return {
    base: baseline.report,
    comparison: {
      compatible: true,
      riskDelta:
        comparisonCurrent.repository.regressionRiskScore - baseline.report.repository.regressionRiskScore,
      baselineId: baseline.inputId,
      changedFiles: context.changedFiles,
      blastRadius: context.blastRadius,
      ...compareSignalChanges(comparisonCurrent, baseline.report),
    },
  };
}
