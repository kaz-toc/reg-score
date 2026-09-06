import { describe, expect, it } from 'vitest';

import { buildInterventions } from '../src/recommendation/rules.js';
import type { Evidence, RiskCluster } from '../src/schema/report.v1.js';

describe('intervention target path filtering', () => {
  it('excludes harness and fixture paths from intervention targets', () => {
    const evidence: Evidence[] = [
      {
        evidenceId: 'evidence:dep-cycle:harness/governance.mjs->harness/paths.mjs',
        signalId: 'dep-cycle',
        axisId: 'structural-fragility',
        path: 'harness/governance.mjs',
        severity: 'high',
        message: 'cycle',
        source: 'deterministic',
      },
      {
        evidenceId: 'evidence:dep-cycle:src/core.ts->src/util.ts',
        signalId: 'dep-cycle',
        axisId: 'structural-fragility',
        path: 'src/core.ts',
        severity: 'high',
        message: 'cycle',
        source: 'deterministic',
      },
    ];
    const clusters: RiskCluster[] = [
      {
        clusterId: 'cluster:structural-fragility:dependency-cycle:1',
        title: 'Structural Fragility / dependency-cycle',
        score: 75,
        confidence: 1,
        axisId: 'structural-fragility',
        mechanismId: 'dependency-cycle',
        paths: ['src/core.ts'],
        failureMechanism: 'cycle',
        triggerChanges: [],
        evidenceIds: ['evidence:dep-cycle:src/core.ts->src/util.ts'],
      },
    ];

    const interventions = buildInterventions(evidence, clusters, ['harness']);

    expect(interventions).toHaveLength(1);
    expect(interventions[0]?.targetPaths).toEqual(['src/core.ts']);
    expect(interventions[0]?.targetPaths).not.toContain('harness/governance.mjs');
  });

  it('omits interventions when only non-product paths remain', () => {
    const evidence: Evidence[] = [
      {
        evidenceId: 'evidence:dep-cycle:tests/fixtures/fragile-cart/src/index.ts',
        signalId: 'dep-cycle',
        axisId: 'structural-fragility',
        path: 'tests/fixtures/fragile-cart/src/index.ts',
        severity: 'high',
        message: 'cycle',
        source: 'deterministic',
      },
    ];

    const interventions = buildInterventions(evidence, [], []);
    expect(interventions).toHaveLength(0);
  });
});
