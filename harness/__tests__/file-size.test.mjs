import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkFileSize,
  collectSourceStats,
  countNonBlankLines,
} from '../file-size.mjs';

const config = {
  sourceRoots: ['src'],
  sourceExtensions: ['.ts', '.py'],
  excludeSegments: ['test', 'tests', 'dist'],
  maxNonBlankLines: 2,
};

async function rootWith(files) {
  const root = await mkdtemp(join(tmpdir(), 'harness-fixture-size-'));
  for (const [path, text] of Object.entries(files)) {
    const absolute = join(root, path);
    await mkdir(join(absolute, '..'), { recursive: true });
    await writeFile(absolute, text);
  }
  return root;
}

test('countNonBlankLines includes comments and excludes whitespace', () => {
  assert.equal(countNonBlankLines('code\n\n  \n// comment\n'), 2);
});

test('exact limit passes and over limit produces an actionable finding', async () => {
  const root = await rootWith({
    'src/exact.ts': 'one\ntwo\n',
    'src/large.ts': 'one\ntwo\nthree\n',
  });
  const findings = await checkFileSize({ root, config });
  assert.deepEqual(findings, [{
    checkId: 'file-size',
    path: 'src/large.ts',
    message: '3 nonblank lines exceeds limit 2',
    actual: 3,
    limit: 2,
  }]);
});

test('source collection filters extensions and excluded path segments', async () => {
  const root = await rootWith({
    'src/a.ts': 'a\n',
    'src/b.py': 'a\nb\n',
    'src/c.md': 'a\nb\nc\n',
    'src/test/ignored.ts': 'a\nb\nc\n',
    'src/contest/kept.ts': 'a\n',
    'src/dist/ignored.py': 'a\nb\nc\n',
  });
  const stats = await collectSourceStats({ root, config });
  assert.deepEqual(stats, [
    { path: 'src/a.ts', nonBlankLines: 1 },
    { path: 'src/b.py', nonBlankLines: 2 },
    { path: 'src/contest/kept.ts', nonBlankLines: 1 },
  ]);
});

test('multiple roots are returned in lexical repository order', async () => {
  const root = await rootWith({
    'src/z.ts': 'z',
    'packages/a/src/a.ts': 'a',
  });
  const stats = await collectSourceStats({
    root,
    config: { ...config, sourceRoots: ['src', 'packages/a/src'] },
  });
  assert.deepEqual(stats.map(({ path }) => path), ['packages/a/src/a.ts', 'src/z.ts']);
});

test('a missing source root is empty rather than an error', async () => {
  const root = await rootWith({});
  assert.deepEqual(await collectSourceStats({ root, config }), []);
  assert.deepEqual(await checkFileSize({ root, config }), []);
});

