import { z } from 'zod';

export function normalizeProviderAlias(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (value === 'openai') return 'codex';
  if (value === 'anthropic') return 'claude';
  return value;
}

const llmProviderSchema = z.preprocess(
  normalizeProviderAlias,
  z.enum(['none', 'copilot', 'cursor', 'codex', 'claude']),
);

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
        provider: llmProviderSchema.default('none'),
        model: z.string().optional(),
        executablePath: z.string().optional(),
        maxPromptBytes: z.number().int().positive().default(80_000),
        maxFiles: z.number().int().positive().default(20),
        sendScope: z.enum(['changed', 'cluster-context', 'all']).default('cluster-context'),
      })
      .default({
        enabled: false,
        provider: 'none',
        maxPromptBytes: 80_000,
        maxFiles: 20,
        sendScope: 'cluster-context',
      }),
    baselineDir: z.string().default('.reg-score/baselines'),
    trendDir: z.string().default('.reg-score/trends'),
    policyFile: z.string().default('.reg-score/policy.json'),
    units: z
      .array(
        z
          .object({
            id: z.string(),
            roots: z.array(z.string()).min(1),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

export type RegScoreConfig = z.infer<typeof configSchema>;

export const defaultConfig: RegScoreConfig = configSchema.parse({
  schemaVersion: 1,
});

export function normalizeConfig(config: RegScoreConfig): RegScoreConfig {
  return configSchema.parse(config);
}

export type LlmConfig = RegScoreConfig['llm'];
