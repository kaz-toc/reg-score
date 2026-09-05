import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import { collectSourceStats } from './file-size.mjs';
import { resolveRepositoryPath } from './paths.mjs';

const JAVASCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const MAX_LINES_DISABLE = /eslint-disable(?:-next-line|-line)?[^\n]*\bmax-lines\b/;
const FOCUSED_TEST = /^\s*(?:describe|it|test)\.only\s*\(/;
const CONFLICT_MARKER = /^\s*(?:<<<<<<<|>>>>>>>)\s+\S/;

async function readableText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function inspectLines({ path, text, source }) {
  const findings = [];
  const extension = extname(path);
  for (const [index, lineText] of text.split(/\r?\n/).entries()) {
    const line = index + 1;
    if (source && MAX_LINES_DISABLE.test(lineText)) {
      findings.push({
        checkId: 'policy/max-lines-disable',
        path,
        line,
        message: 'inline max-lines suppression is prohibited',
      });
    }
    if (source && JAVASCRIPT_EXTENSIONS.has(extension) && FOCUSED_TEST.test(lineText)) {
      findings.push({
        checkId: 'policy/focused-test',
        path,
        line,
        message: 'focused test is prohibited',
      });
    }
    if (CONFLICT_MARKER.test(lineText)) {
      findings.push({
        checkId: 'policy/conflict-marker',
        path,
        line,
        message: 'unresolved Git conflict marker',
      });
    }
  }
  return findings;
}

export async function checkPolicyIntegrity({ root, config }) {
  const findings = [];
  const sourceStats = await collectSourceStats({ root, config });
  const sourcePaths = new Set(sourceStats.map(({ path }) => path));

  for (const path of [...sourcePaths].sort((left, right) => left.localeCompare(right))) {
    const text = await readFile(resolveRepositoryPath(root, path), 'utf8');
    findings.push(...inspectLines({ path, text, source: true }));
  }

  for (const path of [...config.requiredDocuments].sort((left, right) => left.localeCompare(right))) {
    if (sourcePaths.has(path)) continue;
    const text = await readableText(resolveRepositoryPath(root, path));
    if (text !== null) {
      findings.push(...inspectLines({ path, text, source: false }));
    }
  }

  return findings.sort((left, right) =>
    left.path.localeCompare(right.path)
    || left.line - right.line
    || left.checkId.localeCompare(right.checkId));
}

