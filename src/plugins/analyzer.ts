import type { Evidence } from '../schema/report.v1.js';
import type { RepositorySnapshot } from '../intake/snapshot.js';

export type AnalyzerCapability = {
  language: string;
  version: string;
  signals: string[];
};

export type AnalyzerPlugin = {
  id: string;
  capabilities: AnalyzerCapability[];
  extract(snapshot: RepositorySnapshot): Promise<Evidence[]>;
};

export function negotiateCapabilities(plugins: AnalyzerPlugin[]): {
  supported: string[];
  unsupported: string[];
} {
  const supported = new Set<string>();
  for (const plugin of plugins) {
    for (const capability of plugin.capabilities) {
      for (const signal of capability.signals) {
        supported.add(signal);
      }
    }
  }
  const allSignals = [
    'dep-cycle',
    'high-fan-out',
    'high-fan-in',
    'large-file',
    'missing-test-pair',
    'git-churn',
    'barrel-reexport',
    'deep-nesting',
    'unresolved-import',
  ];
  const unsupported = allSignals.filter((signal) => !supported.has(signal));
  return { supported: [...supported].sort(), unsupported };
}

export class TypeScriptAnalyzerPlugin implements AnalyzerPlugin {
  readonly id = 'typescript-javascript-v1';

  readonly capabilities: AnalyzerCapability[] = [
    {
      language: 'typescript',
      version: '1',
      signals: [
        'dep-cycle',
        'high-fan-out',
        'high-fan-in',
        'large-file',
        'missing-test-pair',
        'git-churn',
        'barrel-reexport',
        'deep-nesting',
        'unresolved-import',
      ],
    },
  ];

  async extract(snapshot: RepositorySnapshot): Promise<Evidence[]> {
    const { extractDeterministicEvidence } = await import('../evidence/deterministic.js');
    return extractDeterministicEvidence(snapshot);
  }
}

export class PythonStubAnalyzerPlugin implements AnalyzerPlugin {
  readonly id = 'python-stub-v1';

  readonly capabilities: AnalyzerCapability[] = [
    {
      language: 'python',
      version: 'stub',
      signals: ['large-file', 'missing-test-pair'],
    },
  ];

  async extract(snapshot: RepositorySnapshot): Promise<Evidence[]> {
    const pyFiles = snapshot.files.filter((f) => f.relativePath.endsWith('.py'));
    return pyFiles
      .filter((f) => f.nonBlankLines > snapshot.config.maxFileLines)
      .map((f) => ({
        evidenceId: `large-file:${f.relativePath}`,
        signalId: 'large-file',
        axisId: 'structural-fragility' as const,
        path: f.relativePath,
        severity: 'medium' as const,
        message: `Python stub: large file (${f.nonBlankLines} lines)`,
        metrics: { lines: f.nonBlankLines },
        source: 'deterministic' as const,
      }));
  }
}

export class GoStubAnalyzerPlugin implements AnalyzerPlugin {
  readonly id = 'go-stub-v1';

  readonly capabilities: AnalyzerCapability[] = [
    {
      language: 'go',
      version: 'stub',
      signals: ['large-file'],
    },
  ];

  async extract(snapshot: RepositorySnapshot): Promise<Evidence[]> {
    const goFiles = snapshot.files.filter((f) => f.relativePath.endsWith('.go'));
    return goFiles
      .filter((f) => f.nonBlankLines > snapshot.config.maxFileLines)
      .map((f) => ({
        evidenceId: `large-file:${f.relativePath}`,
        signalId: 'large-file',
        axisId: 'structural-fragility' as const,
        path: f.relativePath,
        severity: 'medium' as const,
        message: `Go stub: large file (${f.nonBlankLines} lines)`,
        metrics: { lines: f.nonBlankLines },
        source: 'deterministic' as const,
      }));
  }
}
