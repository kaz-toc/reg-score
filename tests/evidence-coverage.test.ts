import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createRepositorySnapshot } from '../src/intake/snapshot.js';
import { extractDeterministicEvidence } from '../src/evidence/deterministic.js';

describe('test coverage detection', () => {
  it('does not flag missing-test-pair when tests import the source module', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'r3-doctor-coverage-'));
    try {
      await mkdir(path.join(dir, 'src'), { recursive: true });
      await mkdir(path.join(dir, 'tests'), { recursive: true });
      await writeFile(path.join(dir, 'src', 'widget.ts'), 'export const widget = 1;\n');
      await writeFile(
        path.join(dir, 'tests', 'widget.test.ts'),
        "import { widget } from '../src/widget.js';\nexport const tested = widget;\n",
      );

      const snapshot = await createRepositorySnapshot(dir);
      const evidence = await extractDeterministicEvidence(snapshot);

      expect(evidence.some((item) => item.signalId === 'missing-test-pair' && item.path === 'src/widget.ts')).toBe(
        false,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('flags missing-test-pair when no colocated or import-based test exists', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'r3-doctor-coverage-'));
    try {
      await mkdir(path.join(dir, 'src'), { recursive: true });
      await writeFile(path.join(dir, 'src', 'orphan.ts'), 'export const orphan = 1;\n');

      const snapshot = await createRepositorySnapshot(dir);
      const evidence = await extractDeterministicEvidence(snapshot);

      expect(evidence.some((item) => item.signalId === 'missing-test-pair' && item.path === 'src/orphan.ts')).toBe(
        true,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
