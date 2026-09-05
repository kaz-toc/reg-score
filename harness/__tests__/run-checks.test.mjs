import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  formatFindings,
  runCli,
  validateRepository,
} from '../run-checks.mjs';

async function repository({ limit = 800, source = 'const value = 1;\n', configOverride = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'harness-fixture-runner-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'test-fixtures', 'regressions'), { recursive: true });
  await writeFile(join(root, 'src', 'a.js'), source);
  const config = {
    schemaVersion: 1,
    sourceRoots: ['src'],
    sourceExtensions: ['.js'],
    excludeSegments: ['tests'],
    maxNonBlankLines: limit,
    regressionRoot: 'test-fixtures/regressions',
    requiredDocuments: [],
    projectChecks: [],
    ...configOverride,
  };
  await writeFile(join(root, 'harness.config.json'), JSON.stringify(config));
  return root;
}

function outputBuffer() {
  let value = '';
  return {
    write(chunk) { value += chunk; },
    value() { return value; },
  };
}

test('validateRepository aggregates a clean repository to no findings', async () => {
  const root = await repository();
  assert.deepEqual(await validateRepository({ root }), []);
});

test('validateRepository sorts findings by check id and path', async () => {
  const root = await repository({
    limit: 1,
    source: 'test.only(\"a\", () => {});\nsecond();\n',
  });
  const findings = await validateRepository({ root });
  assert.deepEqual(findings.map(({ checkId }) => checkId), ['file-size', 'policy/focused-test']);
});

test('formatFindings includes check id path and line', () => {
  assert.equal(
    formatFindings([{ checkId: 'policy/x', path: 'src/a.js', line: 2, message: 'bad' }]),
    '[policy/x] src/a.js:2: bad',
  );
});

test('validate mode maps clean, violation, and config errors to 0, 1, and 2', async () => {
  const cleanRoot = await repository();
  const violationRoot = await repository({ limit: 1, source: 'a\nb\n' });
  const invalidRoot = await repository({ configOverride: { schemaVersion: 2 } });

  const cleanOut = outputBuffer();
  assert.equal(await runCli({ mode: 'validate', root: cleanRoot, stdout: cleanOut, stderr: outputBuffer() }), 0);
  assert.match(cleanOut.value(), /validation passed/);

  const violationErr = outputBuffer();
  assert.equal(await runCli({ mode: 'validate', root: violationRoot, stdout: outputBuffer(), stderr: violationErr }), 1);
  assert.match(violationErr.value(), /\[file-size\] src\/a\.js/);

  const configErr = outputBuffer();
  assert.equal(await runCli({ mode: 'validate', root: invalidRoot, stdout: outputBuffer(), stderr: configErr }), 2);
  assert.match(configErr.value(), /execution error.*schemaVersion/);
});

test('report mode exits zero even when policy findings are present', async () => {
  const root = await repository({ source: 'test.only(\"a\", () => {});\n' });
  const stdout = outputBuffer();
  assert.equal(await runCli({
    mode: 'report',
    root,
    stdout,
    stderr: outputBuffer(),
    env: { GITHUB_SHA: 'deadbeef' },
    now: () => new Date('2026-09-05T00:00:00.000Z'),
  }), 0);
  assert.match(stdout.value(), /Structural Health Report/);
  assert.match(stdout.value(), /deadbeef/);
  assert.match(stdout.value(), /policy\/focused-test/);
});

