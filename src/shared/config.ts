import { z } from 'zod';

export const configSchema = z
  .object({
    schemaVersion: z.literal(1),
    exclude: z.array(z.string()).default(['node_modules', 'dist', 'build', 'coverage']),
    maxFiles: z.number().int().positive().default(5000),
    maxFileLines: z.number().int().positive().default(800),
    fanOutThreshold: z.number().int().positive().default(8),
    fanInThreshold: z.number().int().positive().default(8),
    churnDays: z.number().int().positive().default(90),
    llm: z
      .object({
        enabled: z.boolean().default(false),
        provider: z.string().default('none'),
        maxFiles: z.number().int().positive().default(20),
      })
      .default({ enabled: false, provider: 'none', maxFiles: 20 }),
    baselineDir: z.string().default('.reg-score/baselines'),
    trendDir: z.string().default('.reg-score/trends'),
    policyFile: z.string().default('.reg-score/policy.json'),
  })
  .strict();

export type RegScoreConfig = z.infer<typeof configSchema>;

export const defaultConfig: RegScoreConfig = configSchema.parse({
  schemaVersion: 1,
});
