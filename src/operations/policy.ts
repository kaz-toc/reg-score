import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

export const policySchema = z
  .object({
    schemaVersion: z.literal(1),
    advisoryThreshold: z.number().min(0).max(100).default(70),
    gateEnabled: z.boolean().default(false),
    gateThreshold: z.number().min(0).max(100).default(85),
    requireCalibration: z.boolean().default(true),
    retentionDays: z.number().int().positive().default(90),
    redactPaths: z.array(z.string()).default([]),
  })
  .strict();

export type TeamPolicy = z.infer<typeof policySchema>;

export async function loadPolicy(repositoryPath: string, policyFile: string): Promise<TeamPolicy> {
  const policyPath = path.join(repositoryPath, policyFile);
  try {
    const raw = await readFile(policyPath, 'utf8');
    return policySchema.parse(JSON.parse(raw));
  } catch {
    return policySchema.parse({ schemaVersion: 1 });
  }
}

export type PolicyEvaluation = {
  advisory: boolean;
  gateWouldFail: boolean;
  reasons: string[];
};

export function evaluatePolicy(score: number, confidence: number, policy: TeamPolicy, calibrated: boolean): PolicyEvaluation {
  const reasons: string[] = [];
  const advisory = score >= policy.advisoryThreshold;
  if (advisory) {
    reasons.push(`score ${score} >= advisory threshold ${policy.advisoryThreshold}`);
  }

  let gateWouldFail = false;
  if (policy.gateEnabled) {
    if (policy.requireCalibration && !calibrated) {
      reasons.push('gate disabled: calibration required but not available');
    } else if (score >= policy.gateThreshold) {
      gateWouldFail = true;
      reasons.push(`score ${score} >= gate threshold ${policy.gateThreshold}`);
    }
  }

  if (confidence < 0.5) {
    reasons.push(`low confidence ${confidence} — gate should not auto-fail`);
    gateWouldFail = false;
  }

  return { advisory, gateWouldFail, reasons };
}
