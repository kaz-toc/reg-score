const BUILTIN_SKIP_ROOTS = ['harness', 'scripts', 'tests/fixtures'];

export function isTestFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.includes('/__tests__/')) {
    return true;
  }
  return /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(normalized);
}

export function isNonProductPath(relativePath: string, diagnosticSkipRoots: string[] = []): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized === 'vitest.config.ts') {
    return true;
  }
  const roots = [...BUILTIN_SKIP_ROOTS, ...diagnosticSkipRoots];
  return roots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}
