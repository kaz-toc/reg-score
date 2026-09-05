import { readFile, stat } from 'node:fs/promises';
import { posix } from 'node:path';

import {
  HarnessConfigError,
  resolveRepositoryPath,
} from './paths.mjs';

export const REQUIRED_HEADINGS = Object.freeze({
  'AGENTS.md': [
    '## 必読',
    '## 権限',
    '## 変更規律',
    '## 検証',
    '## 外部操作',
  ],
  'ARCHITECTURE.md': [
    '## 境界',
    '## 所有権',
    '## 依存方向',
    '## DDD',
    '## SOLID',
    '## 構造上の制限',
    '## アーキテクチャチェック',
  ],
  'CONTRIBUTING.md': [
    '## コード変更前',
    '## Issue の形',
    '## 変更種別',
    '## プルリクエスト',
    '## 回帰ワークフロー',
    '## 境界別検証',
    '## 完了',
  ],
});

const AUTHORITY_LINKS = Object.freeze({
  'AGENTS.md': ['ARCHITECTURE.md', 'CONTEXT.md', 'CONTRIBUTING.md'],
  'CONTRIBUTING.md': [
    'docs/testing/REGRESSION-CONTRACTS.md',
    'docs/verification/BOUNDARY-MATRIX.md',
  ],
});

function normalizeTarget(rawTarget) {
  const withoutTitle = rawTarget.trim().replace(/^<|>$/g, '');
  return withoutTitle.split('#', 1)[0];
}

function isExternalOrAnchor(target) {
  return target.startsWith('#') || /^(?:https?:|mailto:)/i.test(target);
}

export function extractRelativeMarkdownLinks(text) {
  const links = [];
  const pattern = /\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of text.matchAll(pattern)) {
    const target = match[1].trim();
    if (!isExternalOrAnchor(target)) links.push(target);
  }
  return links;
}

async function existing(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function includesHeading(text, heading) {
  return text.split(/\r?\n/).some((line) => line.trimEnd() === heading);
}

function normalizedLinkPath(sourcePath, target) {
  const decoded = decodeURIComponent(normalizeTarget(target));
  return posix.normalize(posix.join(posix.dirname(sourcePath), decoded));
}

export async function checkGovernance({ root, config }) {
  const findings = [];
  const loaded = new Map();

  for (const path of [...config.requiredDocuments].sort((left, right) => left.localeCompare(right))) {
    const absolute = resolveRepositoryPath(root, path);
    if (!(await existing(absolute))) {
      findings.push({
        checkId: 'governance/missing-document',
        path,
        message: 'required document is missing',
      });
      continue;
    }
    loaded.set(path, await readFile(absolute, 'utf8'));
  }

  for (const [path, text] of loaded) {
    for (const heading of REQUIRED_HEADINGS[path] ?? []) {
      if (!includesHeading(text, heading)) {
        findings.push({
          checkId: 'governance/missing-heading',
          path,
          message: `required heading is missing: ${heading}`,
        });
      }
    }

    const rawLinks = extractRelativeMarkdownLinks(text);
    const linkedPaths = new Set();
    for (const target of rawLinks) {
      let targetPath;
      try {
        targetPath = normalizedLinkPath(path, target);
        const absoluteTarget = resolveRepositoryPath(root, targetPath);
        linkedPaths.add(targetPath.replace(/\/$/, ''));
        if (!(await existing(absoluteTarget))) {
          findings.push({
            checkId: 'governance/broken-link',
            path,
            message: `relative link target is missing: ${target}`,
          });
        }
      } catch (error) {
        const checkId = error instanceof HarnessConfigError
          ? 'governance/link-escape'
          : 'governance/invalid-link';
        findings.push({
          checkId,
          path,
          message: `invalid relative link: ${target}`,
        });
      }
    }

    for (const target of AUTHORITY_LINKS[path] ?? []) {
      if (!linkedPaths.has(target)) {
        findings.push({
          checkId: 'governance/authority-link',
          path,
          message: `required authority link is missing: ${target}`,
        });
      }
    }
  }

  return findings.sort((left, right) =>
    left.path.localeCompare(right.path)
    || left.checkId.localeCompare(right.checkId)
    || left.message.localeCompare(right.message));
}
