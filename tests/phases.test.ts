import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  GoStubAnalyzerPlugin,
  PythonStubAnalyzerPlugin,
  TypeScriptAnalyzerPlugin,
  negotiateCapabilities,
} from '../src/plugins/analyzer.js';
import { loadCalibration } from '../src/calibration/dataset.js';
import { evaluatePolicy, policySchema } from '../src/operations/policy.js';

const root = path.dirname(fileURLToPath(import.meta.url));

describe('phase 4-6 capabilities', () => {
  it('negotiates plugin capabilities without zeroing unsupported signals', () => {
    const negotiation = negotiateCapabilities([
      new TypeScriptAnalyzerPlugin(),
      new PythonStubAnalyzerPlugin(),
      new GoStubAnalyzerPlugin(),
    ]);
    expect(negotiation.supported).toContain('dep-cycle');
    expect(negotiation.unsupported).toEqual([]);
  });

  it('loads calibration dataset with gate conditions', async () => {
    const dataset = await loadCalibration(root);
    expect(dataset.gateEligible).toBe(false);
    expect(dataset.gateConditions.length).toBeGreaterThan(0);
  });

  it('does not auto-fail gate when calibration missing', () => {
    const policy = policySchema.parse({ schemaVersion: 1, gateEnabled: true });
    const evaluation = evaluatePolicy(90, 0.8, policy, false);
    expect(evaluation.gateWouldFail).toBe(false);
    expect(evaluation.reasons.some((r) => r.includes('calibration'))).toBe(true);
  });

  it('suppresses gate on low confidence', () => {
    const policy = policySchema.parse({ schemaVersion: 1, gateEnabled: true, requireCalibration: false });
    const evaluation = evaluatePolicy(90, 0.3, policy, true);
    expect(evaluation.gateWouldFail).toBe(false);
  });
});
