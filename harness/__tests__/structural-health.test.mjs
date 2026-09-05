import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildStructuralHealthReport } from '../structural-health.mjs';

async function rootWith(files) {
  const root = await mkdtemp(join(tmpdir(), 'harness-fixture-report-'));
  for (const [path, text] of Object.entries(files)) {
    const absolute = join(root, path);
    await mkdir(join(absolute, '..'), { recursive: true });
    await writeFile(absolute, text);
  }
  return root;
}

const baseConfig = {
  sourceRoots: ['src'],
  sourceExtensions: ['.js'],
  excludeSegments: ['tests'],
  requiredDocuments: [],
  projectChecks: [],
  maxNonBlankLines: 800,
};

test('report is deterministic and orders largest source files first', async () => {
  const root = await rootWith({
    'src/small.js': 'one\n',
    'src/large.js': 'one\ntwo\nthree\n',
  });
  const report = await buildStructuralHealthReport({
    root,
    config: baseConfig,
    generatedAt: '2026-09-05T00:00:00.000Z',
    commit: 'abc123',
  });
  assert.match(report, /Generated: 2026-09-05T00:00:00.000Z/);
  assert.match(report, /Commit: `abc123`/);
  assert.ok(report.indexOf('src/large.js') < report.indexOf('src/small.js'));
  assert.match(report, /## Policy integrity\n\nNo findings\./);
  assert.match(report, /## Project checks\n\nNo findings\./);
});

test('report includes policy and project findings without mutating them', async () => {
  const root = await rootWith({
    'src/a.js': 'test.only(\"a\", () => {});\n',
    'project-checks/owner.mjs': 'export async function check() { return [{ checkId: "architecture/owner", path: "src/a.js", message: "multiple owners", line: 1 }]; }',
  });
  const report = await buildStructuralHealthReport({
    root,
    config: { ...baseConfig, projectChecks: ['project-checks/owner.mjs'] },
    generatedAt: '2026-09-05T00:00:00.000Z',
    commit: 'abc123',
  });
  assert.match(report, /policy\/focused-test/);
  assert.match(report, /architecture\/owner/);
  assert.match(report, /src\/a\.js:1/);
});

