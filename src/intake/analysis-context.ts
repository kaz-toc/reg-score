import { createHash } from 'node:crypto';

import { ASSESSMENT_CONTRACT_VERSION } from '../schema/report.v1.js';
import type { DiagnosisReport } from '../schema/report.v1.js';
import type { RegScoreConfig } from '../shared/config.js';

export type AnalysisContext = {
  version: 1;
  assessmentContractVersion: number;
  scope: {
    unitId: string | null;
    roots: string[];
    exclude: string[];
  };
  limits: {
    maxFiles: number;
    maxFileLines: number;
    fanOutThreshold: number;
    fanInThreshold: number;
    churnDays: number;
  };
  llm: RegScoreConfig['llm'];
  gitAvailable: boolean;
};

function normalizedSet(values: string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\\/g, '/')))].sort();
}

export function analysisContext(config: RegScoreConfig, unitId: string | undefined, gitAvailable: boolean): AnalysisContext {
  const unit = unitId ? config.units.find((candidate) => candidate.id === unitId) : undefined;
  return {
    version: 1,
    assessmentContractVersion: ASSESSMENT_CONTRACT_VERSION,
    scope: {
      unitId: unitId ?? null,
      roots: normalizedSet(unit?.roots ?? ['.']),
      exclude: normalizedSet(config.exclude),
    },
    limits: {
      maxFiles: config.maxFiles,
      maxFileLines: config.maxFileLines,
      fanOutThreshold: config.fanOutThreshold,
      fanInThreshold: config.fanInThreshold,
      churnDays: config.churnDays,
    },
    llm: { ...config.llm },
    gitAvailable,
  };
}

export function analysisContextFingerprint(
  config: RegScoreConfig,
  unitId: string | undefined,
  gitAvailable: boolean,
): string {
  return createHash('sha256').update(JSON.stringify(analysisContext(config, unitId, gitAvailable))).digest('hex');
}

export function diagnosisContextFingerprint(
  snapshotFingerprint: string,
  report: DiagnosisReport,
): string {
  const capabilities = report.capabilities
    .map((capability) => ({
      language: capability.language,
      completeness: capability.completeness,
      analyzerId: capability.analyzerId,
      analyzerImplementationVersion: capability.analyzerImplementationVersion,
      contractVersion: capability.contractVersion,
      supportedSignals: [...new Set(capability.supportedSignals)].sort(),
      unevaluatedSignals: [...new Set(capability.unevaluatedSignals)].sort(),
    }))
    .sort((left, right) =>
      `${left.language}:${left.analyzerId}`.localeCompare(`${right.language}:${right.analyzerId}`),
    );
  const context = {
    snapshotFingerprint,
    analyzers: [...new Set(report.metadata.analyzers)].sort(),
    capabilities,
    semanticProviderStatus: report.metadata.semanticProviderStatus ?? null,
    semanticProvider: report.metadata.llmProvider ?? null,
    semanticProviderImplementationVersion: report.metadata.semanticProviderImplementationVersion ?? null,
  };
  return createHash('sha256').update(JSON.stringify(context)).digest('hex');
}
