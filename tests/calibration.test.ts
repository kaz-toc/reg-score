import { describe, expect, it } from 'vitest';

import { runGoldenAssessmentRegression } from '../src/calibration/golden-regression.js';
import { calibrationDatasetSchema, loadCalibration, summarizeCalibration } from '../src/calibration/dataset.js';
import { policySchema } from '../src/operations/policy.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

describe('calibration quality', () => {
  it('publishes score-band metrics with sample counts', async () => {
    const dataset = await loadCalibration(path.join(root, '..'), false, []);
    expect(dataset.records.length).toBeGreaterThan(0);
    for (const record of dataset.records) {
      expect(record.sampleCount).toBeGreaterThan(0);
      expect(record.falsePositiveRate).toBeDefined();
      expect(record.missRate).toBeDefined();
    }
    expect(summarizeCalibration(dataset)).toContain('fp=');
  });

  it('detects golden assessment regression when expectations fail', async () => {
    const report = await runGoldenAssessmentRegression();
    expect(report.passed).toBe(true);
    expect(report.results.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects blank or duplicate persisted calibration conditions', () => {
    expect(() => policySchema.parse({ schemaVersion: 1, requiredCalibrationConditions: [''] })).toThrow();
    expect(() => policySchema.parse({ schemaVersion: 1 })).toThrow();
    expect(() => calibrationDatasetSchema.parse({
      schemaVersion: 1,
      records: [],
      gateConditions: [],
      satisfiedConditions: ['security-reviewed', 'security-reviewed'],
    })).toThrow();
    expect(() => calibrationDatasetSchema.parse({ schemaVersion: 1, records: [], gateConditions: [] })).toThrow();
  });
});
