import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { redactReport } from '../src/shared/redaction.js';
import { runDiagnosis } from '../src/pipeline/diagnose.js';
import { createRepositorySnapshot } from '../src/intake/snapshot.js';
import { deriveGateEligible } from '../src/operations/policy.js';

const root = path.dirname(fileURLToPath(import.meta.url));

describe('policy redaction and gate eligibility', () => {
  it('redacts configured path segments consistently', async () => {
    const snapshot = await createRepositorySnapshot(path.join(root, 'fixtures', 'stable-cart'));
    const report = await runDiagnosis(snapshot);
    const redacted = redactReport(report, ['stable-cart']);
    expect(JSON.stringify(redacted)).not.toContain('stable-cart');
    expect(report.metadata.repositoryPath).toContain('stable-cart');
  });

  it('derives gate eligibility from observable calibration metrics', () => {
    expect(
      deriveGateEligible({
        calibrationPresent: true,
        minSamplesPerBand: true,
        hasFalsePositiveRate: true,
        hasMissRate: true,
        hasRankingQuality: true,
        hasExplanationUsefulness: true,
        goldenRegressionPassed: true,
      }),
    ).toBe(true);

    expect(
      deriveGateEligible({
        calibrationPresent: true,
        minSamplesPerBand: false,
        hasFalsePositiveRate: true,
        hasMissRate: true,
        hasRankingQuality: true,
        hasExplanationUsefulness: true,
        goldenRegressionPassed: true,
      }),
    ).toBe(false);
  });
});
