import path from 'node:path';

import type { Evidence, RiskAxisId, SignalId } from '../schema/report.v1.js';
import type { RepositorySnapshot, SourceFile } from '../intake/snapshot.js';

export type ImportEdge = {
  from: string;
  to: string;
  kind: 'relative' | 'package';
};

const IMPORT_RE =
  /(?:import\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?|export\s+(?:type\s+)?(?:\*|\{[^}]+\})\s+from\s+)['"]([^'"]+)['"]/g;

function extractImports(file: SourceFile): string[] {
  const targets: string[] = [];
  for (const match of (file.content ?? '').matchAll(IMPORT_RE)) {
    const target = match[1];
    if (target) {
      targets.push(target);
    }
  }
  return targets;
}

function resolveRelativeImport(fromFile: SourceFile, target: string, filesByPath: Map<string, SourceFile>): string | null {
  if (!target.startsWith('.')) {
    return null;
  }
  const base = path.dirname(fromFile.relativePath);
  const joined = path.normalize(path.join(base, target));
  const withoutExtension = joined.replace(/\.(mjs|cjs|tsx?|jsx?)$/, '');
  const candidates = [
    joined,
    withoutExtension,
    `${withoutExtension}.ts`,
    `${withoutExtension}.tsx`,
    `${withoutExtension}.js`,
    `${withoutExtension}.jsx`,
    `${withoutExtension}.mjs`,
    `${withoutExtension}.cjs`,
    `${withoutExtension}/index.ts`,
    `${withoutExtension}/index.js`,
  ];

  for (const candidate of candidates) {
    if (filesByPath.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function buildImportGraph(snapshot: RepositorySnapshot): ImportEdge[] {
  const filesByPath = new Map(snapshot.files.map((file) => [file.relativePath, file]));
  const edges: ImportEdge[] = [];

  for (const file of snapshot.files) {
    for (const target of extractImports(file)) {
      if (target.startsWith('.')) {
        const resolved = resolveRelativeImport(file, target, filesByPath);
        if (resolved) {
          edges.push({ from: file.relativePath, to: resolved, kind: 'relative' });
        } else {
          edges.push({ from: file.relativePath, to: target, kind: 'relative' });
        }
      } else {
        edges.push({ from: file.relativePath, to: target, kind: 'package' });
      }
    }
  }

  return edges.sort((a, b) => `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`));
}

export function findImportCycles(edges: ImportEdge[]): string[][] {
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind !== 'relative') {
      continue;
    }
    const list = graph.get(edge.from) ?? [];
    list.push(edge.to);
    graph.set(edge.from, list);
  }

  const cycles: string[][] = [];

  function dfs(node: string, visiting: Set<string>, stack: string[]): void {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      if (start >= 0) {
        cycles.push([...stack.slice(start), node]);
      }
      return;
    }
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      dfs(next, visiting, stack);
    }
    stack.pop();
    visiting.delete(node);
  }

  for (const node of [...graph.keys()].sort()) {
    dfs(node, new Set(), []);
  }

  const uniqueCycles = [...new Map(cycles.map((cycle) => {
    const key = [...new Set(cycle)].sort().join('->');
    return [key, [...new Set(cycle)].sort()] as const;
  })).values()];

  return uniqueCycles;
}

function expectedTestPath(sourcePath: string): string | null {
  const dir = path.dirname(sourcePath);
  const base = path.basename(sourcePath).replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
  if (base.includes('.test') || base.includes('.spec')) {
    return null;
  }
  return path.join(dir, '__tests__', `${base}.test.ts`);
}

function maxBraceDepth(content: string): number {
  let depth = 0;
  let max = 0;
  for (const char of content) {
    if (char === '{') {
      depth += 1;
      max = Math.max(max, depth);
    } else if (char === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  return max;
}

function makeEvidence(
  signalId: SignalId,
  axisId: RiskAxisId,
  severity: Evidence['severity'],
  message: string,
  filePath?: string,
  metrics?: Evidence['metrics'],
): Evidence {
  const target = metrics && 'target' in metrics && typeof metrics.target === 'string' ? metrics.target : undefined;
  const evidenceKey =
    signalId === 'unresolved-import' && filePath && target
      ? `${filePath}:${target}`
      : (filePath ?? 'repo');
  return {
    evidenceId: `evidence:${signalId}:${evidenceKey}`,
    signalId,
    axisId,
    path: filePath,
    severity,
    message,
    metrics,
    source: 'deterministic',
  };
}

export async function extractDeterministicEvidence(snapshot: RepositorySnapshot): Promise<Evidence[]> {
  const evidence: Evidence[] = [];
  const edges = buildImportGraph(snapshot);
  const filesByPath = new Map(snapshot.files.map((file) => [file.relativePath, file]));
  const fanOut = new Map<string, number>();
  const fanIn = new Map<string, number>();

  for (const edge of edges) {
    if (edge.kind === 'relative') {
      fanOut.set(edge.from, (fanOut.get(edge.from) ?? 0) + 1);
      if (filesByPath.has(edge.to)) {
        fanIn.set(edge.to, (fanIn.get(edge.to) ?? 0) + 1);
      } else if (edge.to.startsWith('.')) {
        evidence.push(
          makeEvidence(
            'unresolved-import',
            'structural-fragility',
            'medium',
            `解決不能な相対 import: ${edge.to}`,
            edge.from,
            { target: edge.to },
          ),
        );
      }
    }
  }

  for (const [filePath, count] of fanOut.entries()) {
    if (count >= snapshot.config.fanOutThreshold) {
      evidence.push(
        makeEvidence(
          'high-fan-out',
          'change-blast-radius',
          count >= snapshot.config.fanOutThreshold * 2 ? 'high' : 'medium',
          `fan-out が高い (${count})`,
          filePath,
          { fanOut: count },
        ),
      );
    }
  }

  for (const [filePath, count] of fanIn.entries()) {
    if (count >= snapshot.config.fanInThreshold) {
      evidence.push(
        makeEvidence(
          'high-fan-in',
          'change-blast-radius',
          count >= snapshot.config.fanInThreshold * 2 ? 'high' : 'medium',
          `fan-in が高い (${count})`,
          filePath,
          { fanIn: count },
        ),
      );
    }
  }

  for (const cycle of findImportCycles(edges)) {
    const unique = [...new Set(cycle)].sort();
    evidence.push({
      evidenceId: `evidence:dep-cycle:${unique.join('->')}`,
      signalId: 'dep-cycle',
      axisId: 'structural-fragility',
      path: unique[0],
      severity: 'high',
      message: `循環依存: ${unique.join(' -> ')}`,
      metrics: { cycle: unique.join('->') },
      source: 'deterministic',
    });
  }

  for (const file of snapshot.files) {
    if (file.nonBlankLines > snapshot.config.maxFileLines) {
      evidence.push(
        makeEvidence(
          'large-file',
          'structural-fragility',
          'medium',
          `大規模ファイル (${file.nonBlankLines} 行)`,
          file.relativePath,
          { lines: file.nonBlankLines },
        ),
      );
    }

    if (file.content.includes('export * from')) {
      evidence.push(
        makeEvidence(
          'barrel-reexport',
          'structural-fragility',
          'low',
          'barrel 再エクスポートを検出',
          file.relativePath,
        ),
      );
    }

    const depth = maxBraceDepth(file.content);
    if (depth >= 6) {
      evidence.push(
        makeEvidence(
          'deep-nesting',
          'structural-fragility',
          'medium',
          `深いネスト (深度 ${depth})`,
          file.relativePath,
          { depth },
        ),
      );
    }

    const expectedTest = expectedTestPath(file.relativePath);
    if (expectedTest && !filesByPath.has(expectedTest)) {
      evidence.push(
        makeEvidence(
          'missing-test-pair',
          'verification-gap',
          'medium',
          `対応テストが見つからない (期待: ${expectedTest})`,
          file.relativePath,
          { expectedTest },
        ),
      );
    }
  }

  if (snapshot.gitAvailable) {
    const churn = await collectGitChurn(snapshot);
    for (const [filePath, count] of churn.entries()) {
      if (count >= 5) {
        evidence.push(
          makeEvidence(
            'git-churn',
            'change-volatility',
            count >= 10 ? 'high' : 'medium',
            `直近 ${snapshot.config.churnDays} 日で ${count} 回変更`,
            filePath,
            { churn: count, days: snapshot.config.churnDays },
          ),
        );
      }
    }
  }

  return evidence.sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
}

async function collectGitChurn(snapshot: RepositorySnapshot): Promise<Map<string, number>> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const since = `${snapshot.config.churnDays} days ago`;
  const analyzedPaths = new Set(snapshot.files.map((file) => file.relativePath.replace(/\\/g, '/')));

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', `--since=${since}`, '--name-only', '--pretty=format:'],
      { cwd: snapshot.repositoryPath },
    );
    const counts = new Map<string, number>();
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.includes(' ') || !analyzedPaths.has(trimmed.replace(/\\/g, '/'))) {
        continue;
      }
      counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
    }
    return counts;
  } catch {
    return new Map();
  }
}
