import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';

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

  it('returns and summarizes missing required custom conditions', async () => {
    const repositoryPath = await mkdtemp(path.join(os.tmpdir(), 'reg-score-calibration-conditions-'));
    try {
      await mkdir(path.join(repositoryPath, '.reg-score'), { recursive: true });
      await writeFile(path.join(repositoryPath, '.reg-score', 'calibration.json'), JSON.stringify({
        schemaVersion: 1,
        records: [{
          schemaVersion: 1,
          scoreBand: '0-100',
          sampleCount: 30,
          observedRegressions: 1,
          observedReverts: 0,
          falsePositiveRate: 0.1,
          missRate: 0.1,
          rankingQuality: 0.8,
          explanationUsefulness: 0.8,
        }],
        gateConditions: [],
        satisfiedConditions: [],
      }));

      const result = await loadCalibration(repositoryPath, true, ['security-reviewed']);

      expect(result.gateEligible).toBe(false);
      expect(result.missingRequiredConditions).toEqual(['security-reviewed']);
      expect(summarizeCalibration(result)).toContain('Missing required conditions:\n  - security-reviewed');
    } finally {
      await rm(repositoryPath, { recursive: true, force: true });
    }
  });
});
