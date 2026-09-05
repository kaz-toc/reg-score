import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { ConfigError } from '../shared/errors.js';

const calibrationConditionsSchema = z
  .array(z.string().trim().min(1))
  .refine((values) => new Set(values).size === values.length, 'conditions must be unique');

export const policySchema = z
  .object({
    schemaVersion: z.literal(1),
    advisoryThreshold: z.number().min(0).max(100).default(70),
    gateEnabled: z.boolean().default(false),
    gateThreshold: z.number().min(0).max(100).default(85),
    requireCalibration: z.boolean().default(true),
    retentionDays: z.number().int().positive().default(90),
    redactPaths: z.array(z.string()).default([]),
    requiredCalibrationConditions: calibrationConditionsSchema,
  })
  .strict();

export type TeamPolicy = z.infer<typeof policySchema>;

export async function loadPolicy(repositoryPath: string, policyFile: string): Promise<TeamPolicy> {
  const policyPath = path.join(repositoryPath, policyFile);
  try {
    await access(policyPath);
  } catch {
    return policySchema.parse({ schemaVersion: 1, requiredCalibrationConditions: [] });
  }

  try {
    const raw = await readFile(policyPath, 'utf8');
    return policySchema.parse(JSON.parse(raw));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigError(policyPath, reason);
  }
}

export type PolicyEvaluation = {
  advisory: boolean;
  gateWouldFail: boolean;
  gateEligible: boolean;
  missingCalibrationConditions: string[];
  reasons: string[];
};

export type GateEligibilityInput = {
  calibrationPresent: boolean;
  minSamplesPerBand: boolean;
  hasFalsePositiveRate: boolean;
  hasMissRate: boolean;
  hasRankingQuality: boolean;
  hasExplanationUsefulness: boolean;
  goldenRegressionPassed: boolean;
};

export function deriveGateEligible(
  input: GateEligibilityInput,
  requiredConditions: string[],
  satisfiedConditions: string[],
): boolean {
  return (
    input.calibrationPresent &&
    input.minSamplesPerBand &&
    input.hasFalsePositiveRate &&
    input.hasMissRate &&
    input.hasRankingQuality &&
    input.hasExplanationUsefulness &&
    input.goldenRegressionPassed &&
    requiredConditions.every((condition) => satisfiedConditions.includes(condition))
  );
}

export function evaluatePolicy(
  score: number,
  confidence: number,
  policy: TeamPolicy,
  gateEligible: boolean,
  missingCalibrationConditions: string[],
): PolicyEvaluation {
  const reasons: string[] = [];
  const advisory = score >= policy.advisoryThreshold;
  if (advisory) {
    reasons.push(`score ${score} >= advisory threshold ${policy.advisoryThreshold}`);
  }

  let gateWouldFail = false;
  if (policy.gateEnabled) {
    if (policy.requireCalibration && !gateEligible) {
      reasons.push('gate disabled: calibration eligibility not met');
    } else if (confidence < 0.5) {
      reasons.push(`low confidence ${confidence} — gate suppressed`);
    } else if (score >= policy.gateThreshold) {
      gateWouldFail = true;
      reasons.push(`score ${score} >= gate threshold ${policy.gateThreshold}`);
    }
  }

  return { advisory, gateWouldFail, gateEligible, missingCalibrationConditions, reasons };
}
