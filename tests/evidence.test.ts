import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createRepositorySnapshot } from '../src/intake/snapshot.js';
import { buildImportGraph, extractDeterministicEvidence, findImportCycles } from '../src/evidence/deterministic.js';

const fixturesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('deterministic evidence', () => {
  it('finds simple two-node cycle', () => {
    const cycles = findImportCycles([
      { from: 'a.ts', to: 'b.ts', kind: 'relative' },
      { from: 'b.ts', to: 'a.ts', kind: 'relative' },
    ]);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('detects dependency cycle in fragile fixture', async () => {
    const snapshot = await createRepositorySnapshot(path.join(fixturesRoot, 'fragile-cart'));
    const edges = buildImportGraph(snapshot);
    expect(edges.some((edge) => edge.from.includes('pricing') && edge.to.includes('index'))).toBe(true);
    expect(edges.some((edge) => edge.from.includes('index') && edge.to.includes('pricing'))).toBe(true);
    const cycles = findImportCycles(edges);
    expect(cycles.length).toBeGreaterThan(0);
    const evidence = await extractDeterministicEvidence(snapshot);
    expect(evidence.some((item) => item.signalId === 'dep-cycle')).toBe(true);
  });
});
