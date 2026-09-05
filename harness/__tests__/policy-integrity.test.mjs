import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkPolicyIntegrity } from '../policy-integrity.mjs';

const config = {
  sourceRoots: ['src'],
  sourceExtensions: ['.ts', '.js', '.py'],
  excludeSegments: ['test', 'tests'],
  requiredDocuments: ['AGENTS.md'],
};

async function repository(files) {
  const root = await mkdtemp(join(tmpdir(), 'harness-fixture-policy-'));
  for (const [path, text] of Object.entries(files)) {
    const absolute = join(root, path);
    await mkdir(join(absolute, '..'), { recursive: true });
    await writeFile(absolute, text);
  }
  return root;
}

test('detects every inline max-lines suppression form with its line', async () => {
  const root = await repository({
    'AGENTS.md': '# Agents\n',
    'src/a.ts': [
      '/* eslint-disable max-lines */',
      '// eslint-disable-line no-console, max-lines',
      '// eslint-disable-next-line max-lines',
    ].join('\n'),
  });
  const findings = await checkPolicyIntegrity({ root, config });
  assert.deepEqual(findings.map(({ checkId, line }) => [checkId, line]), [
    ['policy/max-lines-disable', 1],
    ['policy/max-lines-disable', 2],
    ['policy/max-lines-disable', 3],
  ]);
});

test('detects focused JavaScript and TypeScript tests but not Python attributes', async () => {
  const root = await repository({
    'AGENTS.md': '# Agents\n',
    'src/a.ts': 'test.only(\"a\", () => {});\nit.only(\"b\", () => {});',
    'src/b.js': 'describe.only(\"suite\", () => {});',
    'src/c.py': 'test.only(value)',
  });
  const findings = await checkPolicyIntegrity({ root, config });
  assert.deepEqual(findings.map(({ path, line }) => [path, line]), [
    ['src/a.ts', 1],
    ['src/a.ts', 2],
    ['src/b.js', 1],
  ]);
  assert.equal(findings.every(({ checkId }) => checkId === 'policy/focused-test'), true);
});

test('detects conflict start and end markers in source and required documents', async () => {
  const root = await repository({
    'AGENTS.md': '# Agents\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> branch\n',
    'src/a.ts': '<<<<<<< ours\nconst a = 1;\n>>>>>>> theirs\n',
  });
  const findings = await checkPolicyIntegrity({ root, config });
  assert.deepEqual(findings.map(({ checkId, path, line }) => [checkId, path, line]), [
    ['policy/conflict-marker', 'AGENTS.md', 2],
    ['policy/conflict-marker', 'AGENTS.md', 6],
    ['policy/conflict-marker', 'src/a.ts', 1],
    ['policy/conflict-marker', 'src/a.ts', 3],
  ]);
});

test('ordinary prose mentioning policies is not rejected', async () => {
  const root = await repository({
    'AGENTS.md': '# Agents\nDiscuss max-lines and .only without directives.\n======= is prose here.',
    'src/a.ts': 'const explanation = \"max-lines and test.only are text\";\n',
  });
  assert.deepEqual(await checkPolicyIntegrity({ root, config }), []);
});

test('missing required documents are left to governance validation', async () => {
  const root = await repository({ 'src/a.ts': 'const a = 1;\n' });
  assert.deepEqual(await checkPolicyIntegrity({ root, config }), []);
});

