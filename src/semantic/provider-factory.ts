import type { LlmSpawn } from './acp/process-port.js';
import { AcpSemanticProvider } from './providers/acp-semantic-provider.js';
import type { LlmConfig } from '../shared/config.js';
import type { SemanticProviderFactory, SemanticProviderResolution } from './types.js';
import { normalizeProviderId } from './provider-ids.js';

export class DefaultSemanticProviderFactory implements SemanticProviderFactory {
  constructor(private readonly spawn?: LlmSpawn) {}

  create(config: LlmConfig): SemanticProviderResolution {
    if (!config.enabled) {
      return { status: 'unavailable', reason: 'LLM not configured' };
    }
    const providerId = normalizeProviderId(config.provider);
    if (providerId === null || providerId === 'none') {
      return { status: 'unavailable', reason: 'LLM provider not set' };
    }
    return {
      status: 'available',
      provider: new AcpSemanticProvider(providerId, config, this.spawn),
    };
  }
}
