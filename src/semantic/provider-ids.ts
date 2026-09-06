import { z } from 'zod';

import { llmProviderIdSchema } from './acp/provider-types.js';

export function normalizeProviderId(
  provider: string,
): z.infer<typeof llmProviderIdSchema> | 'none' | null {
  if (provider === 'none') return 'none';
  if (provider === 'openai') return 'codex';
  if (provider === 'anthropic') return 'claude';
  const parsed = llmProviderIdSchema.safeParse(provider);
  return parsed.success ? parsed.data : null;
}
