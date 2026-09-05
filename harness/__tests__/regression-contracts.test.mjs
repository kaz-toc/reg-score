import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkRegressionContracts } from '../regression-contracts.mjs';

const config = { regressionRoot: 'test-fixtures/regressions' };

async function rootWith(files) {
  const root = await mkdtemp(join(tmpdir(), 'harness-fixture-regression-'));
  for (const [path, value] of Object.entries(files)) {
    const absolute = join(root, path);
    await mkdir(join(absolute, '..'), { recursive: true });
    await writeFile(absolute, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return root;
}

function activeCase(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'REG-2026-001',
    status: 'active',
    title: 'Incorrect total is displayed',
    invariant: 'Displayed total equals the sum of accepted items',
    incident: 'https://github.com/owner/repository/issues/1',
    productionFiles: ['src/total.js'],
    testFiles: ['tests/total.test.js'],
    verificationCommands: ['node --test tests/total.test.js'],
    ...overrides,
  };
}

test('an empty regression registry is valid', async () => {
  const root = await rootWith({});
  assert.deepEqual(await checkRegressionContracts({ root, config }), []);
});

test('a complete active regression case is valid', async () => {
  const root = await rootWith({
    'src/total.js': 'export const total = 1;\n',
    'tests/total.test.js': '// REG-2026-001\n',
    'test-fixtures/regressions/REG-2026-001/case.json': activeCase(),
  });
  assert.deepEqual(await checkRegressionContracts({ root, config }), []);
});

test('directory mismatch and duplicate IDs are reported', async () => {
  const root = await rootWith({
    'src/total.js': '',
    'tests/total.test.js': '// REG-2026-001\n',
    'test-fixtures/regressions/REG-2026-001/case.json': activeCase(),
    'test-fixtures/regressions/REG-2026-002/case.json': activeCase(),
  });
  const findings = await checkRegressionContracts({ root, config });
  assert.equal(findings.some(({ checkId }) => checkId === 'regression/directory-id'), true);
  assert.equal(findings.some(({ checkId }) => checkId === 'regression/duplicate-id'), true);
});

test('malformed JSON and unsupported status are findings', async () => {
  const root = await rootWith({
    'test-fixtures/regressions/REG-2026-001/case.json': '{',
    'test-fixtures/regressions/REG-2026-002/case.json': activeCase({
      id: 'REG-2026-002',
      status: 'paused',
    }),
  });
  const findings = await checkRegressionContracts({ root, config });
  assert.equal(findings.some(({ checkId }) => checkId === 'regression/json'), true);
  assert.equal(findings.some(({ checkId }) => checkId === 'regression/status'), true);
});

test('active cases require safe existing production and test files', async () => {
  const root = await rootWith({
    'test-fixtures/regressions/REG-2026-001/case.json': activeCase({
      productionFiles: ['../outside.js'],
      testFiles: ['tests/missing.test.js'],
    }),
  });
  const findings = await checkRegressionContracts({ root, config });
  assert.equal(findings.some(({ checkId }) => checkId === 'regression/unsafe-path'), true);
  assert.equal(findings.some(({ checkId }) => checkId === 'regression/missing-file'), true);
});

test('active cases require their literal ID in every test file', async () => {
  const root = await rootWith({
    'src/total.js': '',
    'tests/total.test.js': '// no marker\n',
    'test-fixtures/regressions/REG-2026-001/case.json': activeCase(),
  });
  const findings = await checkRegressionContracts({ root, config });
  assert.equal(findings.some(({ checkId, message }) =>
    checkId === 'regression/missing-marker' && /REG-2026-001 marker/.test(message)), true);
});

test('required strings, arrays, and verification commands are validated', async () => {
  const root = await rootWith({
    'test-fixtures/regressions/REG-2026-001/case.json': activeCase({
      invariant: '',
      productionFiles: 'src/total.js',
      verificationCommands: [],
    }),
  });
  const findings = await checkRegressionContracts({ root, config });
  assert.equal(findings.some(({ checkId }) => checkId === 'regression/schema'), true);
  assert.equal(findings.some(({ checkId }) => checkId === 'regression/verification'), true);
});

