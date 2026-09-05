import { describe, expect, it } from 'vitest';

import { runGoldenAssessmentRegression } from '../src/calibration/golden-regression.js';
import { loadCalibration, summarizeCalibration } from '../src/calibration/dataset.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

describe('calibration quality', () => {
  it('publishes score-band metrics with sample counts', async () => {
    const dataset = await loadCalibration(path.join(root, '..'));
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
});
