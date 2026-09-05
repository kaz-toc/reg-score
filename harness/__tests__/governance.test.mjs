import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkGovernance,
  extractRelativeMarkdownLinks,
} from '../governance.mjs';

const requiredDocuments = [
  'AGENTS.md',
  'ARCHITECTURE.md',
  'CONTRIBUTING.md',
  'CONTEXT.md',
  'PROJECT.md',
  'docs/testing/REGRESSION-CONTRACTS.md',
  'docs/verification/BOUNDARY-MATRIX.md',
];

const config = { requiredDocuments };

const agents = `# Agents
## 必読
[Architecture](ARCHITECTURE.md), [Context](CONTEXT.md), and [Contributing](CONTRIBUTING.md).
## 権限
## 変更規律
## 検証
## 外部操作
`;

const architecture = `# Architecture
## 境界
## 所有権
## 依存方向
## DDD
## SOLID
## 構造上の制限
## アーキテクチャチェック
`;

const contributing = `# Contributing
## コード変更前
## Issue の形
## 変更種別
## プルリクエスト
## 回帰ワークフロー
[Regression](docs/testing/REGRESSION-CONTRACTS.md)
## 境界別検証
[Matrix](docs/verification/BOUNDARY-MATRIX.md)
## 完了
`;

async function repository(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'harness-fixture-governance-'));
  const documents = {
    'AGENTS.md': agents,
    'ARCHITECTURE.md': architecture,
    'CONTRIBUTING.md': contributing,
    'CONTEXT.md': '# Context\n',
    'PROJECT.md': '# Project\n',
    'docs/testing/REGRESSION-CONTRACTS.md': '# Regression Contracts\n',
    'docs/verification/BOUNDARY-MATRIX.md': '# Boundary Matrix\n',
    ...overrides,
  };
  for (const [path, text] of Object.entries(documents)) {
    if (text === null) continue;
    const absolute = join(root, path);
    await mkdir(join(absolute, '..'), { recursive: true });
    await writeFile(absolute, text);
  }
  return root;
}

test('valid document graph has no findings', async () => {
  const root = await repository({
    'PROJECT.md': '# Project\n[external](https://example.com) [anchor](#product) [encoded](docs/My%20Guide.md) [ADRs](docs/adr/)\n',
    'docs/My Guide.md': '# Guide\n',
    'docs/adr/index.md': '# ADRs\n',
  });
  assert.deepEqual(await checkGovernance({ root, config }), []);
});

test('missing required documents produce an actionable finding', async () => {
  const root = await repository({ 'CONTEXT.md': null });
  const findings = await checkGovernance({ root, config });
  assert.deepEqual(findings.filter(({ checkId }) => checkId === 'governance/missing-document'), [{
    checkId: 'governance/missing-document',
    path: 'CONTEXT.md',
    message: 'required document is missing',
  }]);
});

test('missing required headings are reported', async () => {
  const root = await repository({ 'ARCHITECTURE.md': '# Architecture\n## Boundaries\n' });
  const findings = await checkGovernance({ root, config });
  assert.equal(findings.some(({ checkId, message }) =>
    checkId === 'governance/missing-heading' && message.includes('## 所有権')), true);
});

test('AGENTS and CONTRIBUTING authority links are required', async () => {
  const root = await repository({
    'AGENTS.md': agents.replace('[Architecture](ARCHITECTURE.md)', 'Architecture'),
    'CONTRIBUTING.md': contributing.replace('[Matrix](docs/verification/BOUNDARY-MATRIX.md)', 'Matrix'),
  });
  const findings = await checkGovernance({ root, config });
  assert.deepEqual(findings.filter(({ checkId }) => checkId === 'governance/authority-link').map(({ path }) => path), [
    'AGENTS.md',
    'CONTRIBUTING.md',
  ]);
});

test('broken and escaping Markdown links are rejected', async () => {
  const root = await repository({
    'PROJECT.md': '# Project\n[missing](docs/missing.md) [escape](../secret.md)\n',
  });
  const findings = await checkGovernance({ root, config });
  assert.equal(findings.some(({ checkId }) => checkId === 'governance/broken-link'), true);
  assert.equal(findings.some(({ checkId }) => checkId === 'governance/link-escape'), true);
});

test('extractRelativeMarkdownLinks excludes external and anchor-only targets', () => {
  assert.deepEqual(
    extractRelativeMarkdownLinks('[a](a.md#x) [b](mailto:x@y.z) [c](#local) [d](https://example.com)'),
    ['a.md#x'],
  );
});

