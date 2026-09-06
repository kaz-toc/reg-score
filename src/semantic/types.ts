import type { SemanticFinding } from '../schema/report.v1.js';
import type { Evidence } from '../schema/report.v1.js';
import type { RepositorySnapshot } from '../intake/snapshot.js';
import type { LlmConfig } from '../shared/config.js';

export type SemanticProvider = {
  readonly name: string;
  readonly implementationVersion: string;
  analyze(snapshot: RepositorySnapshot, evidence: Evidence[]): Promise<unknown>;
};

export type SemanticProviderResolution =
  | { status: 'available'; provider: SemanticProvider }
  | { status: 'unavailable'; reason: string };

export type SemanticProviderFactory = {
  create(config: LlmConfig): SemanticProviderResolution;
};

export type { SemanticFinding };
