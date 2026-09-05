import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  HarnessExecutionError,
  runProjectChecks,
} from '../project-checks.mjs';

async function repository(modules) {
  const root = await mkdtemp(join(tmpdir(), 'harness-fixture-project-checks-'));
  await mkdir(join(root, 'project-checks'), { recursive: true });
  for (const [name, source] of Object.entries(modules)) {
    await writeFile(join(root, 'project-checks', name), source);
  }
  return root;
}

test('project checks run asynchronously in lexical module order', async () => {
  const root = await repository({
    'z.mjs': 'export async function check() { await Promise.resolve(); return [{ checkId: "z", path: "src/z.js", message: "z" }]; }',
    'a.mjs': 'export async function check() { return [{ checkId: "a", path: "src/a.js", message: "a", line: 2 }]; }',
  });
  const findings = await runProjectChecks({
    root,
    config: { projectChecks: ['project-checks/z.mjs', 'project-checks/a.mjs'] },
  });
  assert.deepEqual(findings.map(({ checkId, line }) => [checkId, line]), [['a', 2], ['z', undefined]]);
});

test('a missing check export is an execution error', async () => {
  const root = await repository({ 'invalid.mjs': 'export const value = 1;' });
  await assert.rejects(
    () => runProjectChecks({ root, config: { projectChecks: ['project-checks/invalid.mjs'] } }),
    (error) => error instanceof HarnessExecutionError && /export async function check/.test(error.message),
  );
});

test('a non-array result is an execution error', async () => {
  const root = await repository({ 'invalid.mjs': 'export async function check() { return {}; }' });
  await assert.rejects(
    () => runProjectChecks({ root, config: { projectChecks: ['project-checks/invalid.mjs'] } }),
    HarnessExecutionError,
  );
});

test('invalid and unsafe findings are execution errors', async () => {
  const root = await repository({
    'unsafe.mjs': 'export async function check() { return [{ checkId: "x", path: "../x", message: "x" }]; }',
    'line.mjs': 'export async function check() { return [{ checkId: "x", path: "src/x", message: "x", line: 0 }]; }',
  });
  for (const path of ['project-checks/unsafe.mjs', 'project-checks/line.mjs']) {
    await assert.rejects(
      () => runProjectChecks({ root, config: { projectChecks: [path] } }),
      HarnessExecutionError,
    );
  }
});

test('a thrown project check identifies its module', async () => {
  const root = await repository({ 'throws.mjs': 'export async function check() { throw new Error("boom"); }' });
  await assert.rejects(
    () => runProjectChecks({ root, config: { projectChecks: ['project-checks/throws.mjs'] } }),
    (error) => error instanceof HarnessExecutionError
      && /project-checks\/throws.mjs/.test(error.message)
      && /boom/.test(error.message),
  );
});

test('an empty project check list is valid', async () => {
  const root = await repository({});
  assert.deepEqual(await runProjectChecks({ root, config: { projectChecks: [] } }), []);
});

