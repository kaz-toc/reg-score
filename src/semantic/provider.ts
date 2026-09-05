import { z } from 'zod';

import type { SemanticFinding } from '../schema/report.v1.js';
import { findingIdSchema, riskAxisIdSchema, semanticFindingSchema, evidenceIdSchema } from '../schema/report.v1.js';
import type { RepositorySnapshot } from '../intake/snapshot.js';
import type { Evidence } from '../schema/report.v1.js';
import type { LlmConfig } from '../shared/config.js';

export type SemanticProvider = {
  name: string;
  analyze(snapshot: RepositorySnapshot, evidence: Evidence[]): Promise<SemanticFinding[]>;
};

export type SemanticProviderResolution =
  | { status: 'available'; provider: SemanticProvider }
  | { status: 'unavailable'; reason: string };

export type SemanticProviderFactory = {
  create(config: LlmConfig): SemanticProviderResolution;
};

const providerOutputSchema = z.array(
  z
    .object({
      findingId: findingIdSchema.optional(),
      axisId: riskAxisIdSchema,
      path: z.string().optional(),
      summary: z.string(),
      relatedEvidenceIds: z.array(evidenceIdSchema).default([]),
      confidence: z.number().min(0).max(1),
    })
    .strict(),
);

export class NullSemanticProvider implements SemanticProvider {
  readonly name = 'none';

  async analyze(): Promise<SemanticFinding[]> {
    return [];
  }
}

export class DefaultSemanticProviderFactory implements SemanticProviderFactory {
  create(config: LlmConfig): SemanticProviderResolution {
    if (!config.enabled) {
      return { status: 'unavailable', reason: 'LLM not configured' };
    }
    if (config.provider === 'none') {
      return { status: 'unavailable', reason: 'LLM provider not set' };
    }
    return {
      status: 'available',
      provider: {
        name: config.provider,
        async analyze(): Promise<SemanticFinding[]> {
          return [];
        },
      },
    };
  }
}

export function selectLlmCandidateFiles(snapshot: RepositorySnapshot): RepositorySnapshot['files'] {
  const maxFiles = snapshot.config.llm.maxFiles;
  return [...snapshot.files]
    .sort((a, b) => b.nonBlankLines - a.nonBlankLines)
    .slice(0, maxFiles);
}

export function validateSemanticFindings(
  raw: unknown,
  snapshot: RepositorySnapshot,
  evidence: Evidence[],
): SemanticFinding[] {
  const parsed = providerOutputSchema.parse(raw);
  const evidenceIds = new Set(evidence.map((item) => item.evidenceId));
  const repoPrefix = snapshot.repositoryPath;

  return parsed.map((item, index) => {
    if (item.path) {
      const resolved = item.path.startsWith('/') ? item.path : item.path;
      if (resolved.includes('..')) {
        throw new Error(`semantic finding path escapes repository: ${item.path}`);
      }
      const absolute = resolved.startsWith('/') ? resolved : `${repoPrefix}/${resolved}`;
      if (!absolute.startsWith(repoPrefix)) {
        throw new Error(`semantic finding path outside repository: ${item.path}`);
      }
    }

    for (const evidenceId of item.relatedEvidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(`dangling evidence reference in semantic finding: ${evidenceId}`);
      }
    }

    const finding: SemanticFinding = {
      findingId: item.findingId ?? `finding:semantic:${index + 1}`,
      axisId: item.axisId,
      path: item.path,
      summary: item.summary,
      relatedEvidenceIds: item.relatedEvidenceIds,
      confidence: item.confidence,
    };

    return semanticFindingSchema.parse(finding);
  });
}

export async function resolveSemanticProvider(
  snapshot: RepositorySnapshot,
  factory: SemanticProviderFactory = new DefaultSemanticProviderFactory(),
): Promise<SemanticProviderResolution> {
  try {
    return factory.create(snapshot.config.llm);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { status: 'unavailable', reason: `invalid LLM config: ${reason}` };
  }
}

export async function runSemanticAnalysis(
  snapshot: RepositorySnapshot,
  evidence: Evidence[],
  factory: SemanticProviderFactory = new DefaultSemanticProviderFactory(),
): Promise<{ findings: SemanticFinding[]; resolution: SemanticProviderResolution }> {
  const resolution = await resolveSemanticProvider(snapshot, factory);
  if (resolution.status !== 'available') {
    return { findings: [], resolution };
  }

  try {
    const scopedSnapshot = {
      ...snapshot,
      files: selectLlmCandidateFiles(snapshot),
    };
    const raw = await resolution.provider.analyze(scopedSnapshot, evidence);
    const findings = validateSemanticFindings(raw, snapshot, evidence);
    return { findings, resolution };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      findings: [],
      resolution: { status: 'unavailable', reason: `semantic provider failed: ${reason}` },
    };
  }
}
