import type { SemanticFinding } from '../schema/report.v1.js';
import type { RepositorySnapshot } from '../intake/snapshot.js';
import type { Evidence } from '../schema/report.v1.js';

export type SemanticProvider = {
  name: string;
  analyze(snapshot: RepositorySnapshot, evidence: Evidence[]): Promise<SemanticFinding[]>;
};

export class NullSemanticProvider implements SemanticProvider {
  readonly name = 'none';

  async analyze(): Promise<SemanticFinding[]> {
    return [];
  }
}

export async function runSemanticAnalysis(
  snapshot: RepositorySnapshot,
  evidence: Evidence[],
  provider?: SemanticProvider,
): Promise<SemanticFinding[]> {
  const selected = provider ?? new NullSemanticProvider();
  if (!snapshot.config.llm.enabled) {
    return [];
  }
  return selected.analyze(snapshot, evidence);
}
