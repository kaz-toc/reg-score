import type { SourceLanguage } from '../schema/report.v1.js';

export const LANGUAGE_EXTENSIONS: Record<SourceLanguage, readonly string[]> = {
  'typescript-javascript': ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py'],
  go: ['.go'],
};

export function getRegisteredExtensions(): Set<string> {
  return new Set(Object.values(LANGUAGE_EXTENSIONS).flat());
}
