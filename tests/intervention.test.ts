import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createRepositorySnapshot } from '../src/intake/snapshot.js';
import { runDiagnosis } from '../src/pipeline/diagnose.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(root, 'fixtures');

describe('intervention effectiveness', () => {
  it('fragile fixture scores higher than stable fixture', async () => {
    const fragile = await runDiagnosis(await createRepositorySnapshot(path.join(fixturesRoot, 'fragile-cart')));
    const stable = await runDiagnosis(await createRepositorySnapshot(path.join(fixturesRoot, 'stable-cart')));
    expect(fragile.repository.regressionRiskScore).toBeGreaterThan(stable.repository.regressionRiskScore);
  });

  it('improved fixture lowers risk without arbitrary axis manipulation', async () => {
    const fragile = await runDiagnosis(await createRepositorySnapshot(path.join(fixturesRoot, 'fragile-cart')));
    const improved = await runDiagnosis(
      await createRepositorySnapshot(path.join(fixturesRoot, 'fragile-cart-improved')),
    );
    expect(improved.repository.regressionRiskScore).toBeLessThan(fragile.repository.regressionRiskScore);
    const fragileSignals = new Set(fragile.evidence.map((e) => e.signalId));
    const improvedSignals = new Set(improved.evidence.map((e) => e.signalId));
    expect(fragileSignals.has('dep-cycle')).toBe(true);
    expect(improvedSignals.has('dep-cycle')).toBe(false);
    const fragileStructural = fragile.axes.find((a) => a.axisId === 'change-blast-radius')?.score ?? 0;
    const improvedStructural = improved.axes.find((a) => a.axisId === 'change-blast-radius')?.score ?? 0;
    expect(improvedStructural).toBeLessThanOrEqual(fragileStructural);
  });

  it('interventions target observed mechanisms only', async () => {
    const fragile = await runDiagnosis(await createRepositorySnapshot(path.join(fixturesRoot, 'fragile-cart')));
    const signalIds = new Set(fragile.evidence.map((e) => e.signalId));
    for (const intervention of fragile.interventions) {
      expect(intervention.linkedSignalIds.every((id) => signalIds.has(id))).toBe(true);
    }
  });
});
