import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

export const calibrationRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    scoreBand: z.string(),
    sampleCount: z.number().int().nonnegative(),
    observedRegressions: z.number().int().nonnegative(),
    observedReverts: z.number().int().nonnegative(),
    falsePositiveRate: z.number().min(0).max(1).optional(),
    missRate: z.number().min(0).max(1).optional(),
    rankingQuality: z.number().min(0).max(1).optional(),
    explanationUsefulness: z.number().min(0).max(1).optional(),
  })
  .strict();

export const calibrationDatasetSchema = z
  .object({
    schemaVersion: z.literal(1),
    records: z.array(calibrationRecordSchema),
    gateEligible: z.boolean(),
    gateConditions: z.array(z.string()),
  })
  .strict();

export type CalibrationDataset = z.infer<typeof calibrationDatasetSchema>;

export async function loadCalibration(repositoryPath: string): Promise<CalibrationDataset> {
  const calibrationPath = path.join(repositoryPath, '.reg-score', 'calibration.json');
  try {
    const raw = await readFile(calibrationPath, 'utf8');
    return calibrationDatasetSchema.parse(JSON.parse(raw));
  } catch {
    return calibrationDatasetSchema.parse({
      schemaVersion: 1,
      records: [],
      gateEligible: false,
      gateConditions: [
        'calibration dataset with >= 30 samples per score band',
        'golden assessment regression tests passing',
        'documented false positive / false negative rates',
      ],
    });
  }
}

export function summarizeCalibration(dataset: CalibrationDataset): string {
  const lines = ['Calibration summary:', `Gate eligible: ${dataset.gateEligible}`];
  for (const record of dataset.records) {
    lines.push(
      `- band ${record.scoreBand}: n=${record.sampleCount}, regressions=${record.observedRegressions}, reverts=${record.observedReverts}, fp=${record.falsePositiveRate ?? 'n/a'}, miss=${record.missRate ?? 'n/a'}, rank=${record.rankingQuality ?? 'n/a'}, explain=${record.explanationUsefulness ?? 'n/a'}`,
    );
  }
  if (!dataset.gateEligible) {
    lines.push('Gate conditions not met:');
    for (const condition of dataset.gateConditions) {
      lines.push(`  - ${condition}`);
    }
  }
  return lines.join('\n');
}
