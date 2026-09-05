import type { CapabilityResult, Evidence, SignalId, SourceLanguage } from '../schema/report.v1.js';
import { ALL_SIGNAL_IDS, ASSESSMENT_CONTRACT_VERSION } from '../schema/report.v1.js';
import type { RepositorySnapshot } from '../intake/snapshot.js';
import { IntakeError } from '../shared/errors.js';

export type AnalyzerCapability = {
  language: SourceLanguage;
  contractVersion: number;
  signals: readonly SignalId[];
  completeness: 'full' | 'partial';
};

export type AnalyzerPlugin = {
  id: string;
  extensions: readonly string[];
  capabilities: readonly AnalyzerCapability[];
  extract(snapshot: RepositorySnapshot): Promise<Evidence[]>;
};

const LANGUAGE_EXTENSIONS: Record<SourceLanguage, readonly string[]> = {
  'typescript-javascript': ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py'],
  go: ['.go'],
};

const TS_SIGNALS: SignalId[] = [
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

export function getRegisteredExtensions(): Set<string> {
  return new Set(Object.values(LANGUAGE_EXTENSIONS).flat());
}

export function detectLanguages(snapshot: RepositorySnapshot): SourceLanguage[] {
  const present = new Set<string>();
  for (const file of snapshot.files) {
    present.add(file.extension);
  }
  return (Object.entries(LANGUAGE_EXTENSIONS) as Array<[SourceLanguage, readonly string[]]>)
    .filter(([, extensions]) => extensions.some((ext) => present.has(ext)))
    .map(([language]) => language);
}

export function selectPlugins(snapshot: RepositorySnapshot, plugins: AnalyzerPlugin[]): AnalyzerPlugin[] {
  const languages = new Set(detectLanguages(snapshot));
  return plugins.filter((plugin) => plugin.capabilities.some((cap) => languages.has(cap.language)));
}

export function negotiateCapabilities(
  snapshot: RepositorySnapshot,
  plugins: AnalyzerPlugin[],
): {
  capabilities: CapabilityResult[];
  supported: SignalId[];
  unevaluated: SignalId[];
} {
  const languages = detectLanguages(snapshot);
  const selected = selectPlugins(snapshot, plugins);
  const capabilities: CapabilityResult[] = [];

  for (const language of languages) {
    const plugin = selected.find((entry) => entry.capabilities.some((cap) => cap.language === language));
    if (!plugin) {
      capabilities.push({
        language,
        completeness: 'partial',
        supportedSignals: [],
        unevaluatedSignals: [...ALL_SIGNAL_IDS],
        analyzerId: 'none',
      });
      continue;
    }

    const capability = plugin.capabilities.find((entry) => entry.language === language);
    if (!capability) {
      continue;
    }

    const supportedSignals = [...capability.signals];
    const unevaluatedSignals = ALL_SIGNAL_IDS.filter((signal) => !supportedSignals.includes(signal));
    capabilities.push({
      language,
      completeness: capability.completeness,
      supportedSignals,
      unevaluatedSignals,
      analyzerId: plugin.id,
    });
  }

  const supported = [...new Set(capabilities.flatMap((entry) => entry.supportedSignals))].sort();
  const unevaluated = ALL_SIGNAL_IDS.filter((signal) => !supported.includes(signal));
  return { capabilities, supported, unevaluated };
}

export class TypeScriptAnalyzerPlugin implements AnalyzerPlugin {
  readonly id = 'typescript-javascript-v1';
  readonly extensions = LANGUAGE_EXTENSIONS['typescript-javascript'];
  readonly capabilities: AnalyzerCapability[] = [
    {
      language: 'typescript-javascript',
      contractVersion: ASSESSMENT_CONTRACT_VERSION,
      signals: TS_SIGNALS,
      completeness: 'full',
    },
  ];

  async extract(snapshot: RepositorySnapshot): Promise<Evidence[]> {
    const { extractDeterministicEvidence } = await import('../evidence/deterministic.js');
    return extractDeterministicEvidence(snapshot);
  }
}

export class PythonStubAnalyzerPlugin implements AnalyzerPlugin {
  readonly id = 'python-stub-v1';
  readonly extensions = LANGUAGE_EXTENSIONS.python;
  readonly capabilities: AnalyzerCapability[] = [
    {
      language: 'python',
      contractVersion: ASSESSMENT_CONTRACT_VERSION,
      signals: ['large-file', 'missing-test-pair'],
      completeness: 'partial',
    },
  ];

  async extract(snapshot: RepositorySnapshot): Promise<Evidence[]> {
    const pyFiles = snapshot.files.filter((f) => f.extension === '.py');
    return pyFiles
      .filter((f) => f.nonBlankLines > snapshot.config.maxFileLines)
      .map((f) => ({
        evidenceId: `evidence:large-file:${f.relativePath}`,
        signalId: 'large-file' as const,
        axisId: 'structural-fragility' as const,
        path: f.relativePath,
        severity: 'medium' as const,
        message: `Python: large file (${f.nonBlankLines} lines)`,
        metrics: { lines: f.nonBlankLines },
        source: 'deterministic' as const,
      }));
  }
}

export class GoStubAnalyzerPlugin implements AnalyzerPlugin {
  readonly id = 'go-stub-v1';
  readonly extensions = LANGUAGE_EXTENSIONS.go;
  readonly capabilities: AnalyzerCapability[] = [
    {
      language: 'go',
      contractVersion: ASSESSMENT_CONTRACT_VERSION,
      signals: ['large-file'],
      completeness: 'partial',
    },
  ];

  async extract(snapshot: RepositorySnapshot): Promise<Evidence[]> {
    const goFiles = snapshot.files.filter((f) => f.extension === '.go');
    return goFiles
      .filter((f) => f.nonBlankLines > snapshot.config.maxFileLines)
      .map((f) => ({
        evidenceId: `evidence:large-file:${f.relativePath}`,
        signalId: 'large-file' as const,
        axisId: 'structural-fragility' as const,
        path: f.relativePath,
        severity: 'medium' as const,
        message: `Go: large file (${f.nonBlankLines} lines)`,
        metrics: { lines: f.nonBlankLines },
        source: 'deterministic' as const,
      }));
  }
}

export function getDefaultPlugins(): AnalyzerPlugin[] {
  return [new TypeScriptAnalyzerPlugin(), new PythonStubAnalyzerPlugin(), new GoStubAnalyzerPlugin()];
}

export async function extractEvidenceWithPlugins(
  snapshot: RepositorySnapshot,
  plugins: AnalyzerPlugin[],
): Promise<{ evidence: Evidence[]; analyzerIds: string[]; capabilities: CapabilityResult[]; duplicateIds: string[] }> {
  const selected = selectPlugins(snapshot, plugins);
  const evidenceById = new Map<string, Evidence>();
  const duplicateIds: string[] = [];

  for (const plugin of selected) {
    const extracted = await plugin.extract(snapshot);
    for (const item of extracted) {
      if (evidenceById.has(item.evidenceId)) {
        duplicateIds.push(item.evidenceId);
      }
      evidenceById.set(item.evidenceId, item);
    }
  }

  if (duplicateIds.length > 0) {
    throw new IntakeError(`duplicate evidence IDs: ${[...new Set(duplicateIds)].join(', ')}`);
  }

  const negotiation = negotiateCapabilities(snapshot, selected);
  return {
    evidence: [...evidenceById.values()].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)),
    analyzerIds: selected.map((plugin) => plugin.id),
    capabilities: negotiation.capabilities,
    duplicateIds,
  };
}
