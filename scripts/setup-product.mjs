#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const TEMPLATE = Object.freeze({
  display: 'Product Agentic Coding Skeleton',
  kebab: 'product-agentic-coding-skeleton',
  github: 'kaz-toc/product-agentic-coding-skeleton',
  cloneUrl: 'https://github.com/kaz-toc/product-agentic-coding-skeleton.git',
});

const TEXT_EXTENSIONS = new Set([
  '.cursorignore',
  '.json',
  '.md',
  '.mjs',
  '.sh',
  '.yml',
]);

const SKIP_DIRS = new Set(['.git', 'node_modules']);
const SKIP_VERIFY = new Set(['scripts/setup-product.mjs', 'scripts/setup-product.sh']);

function usage() {
  return `Usage: npm run setup -- [options]

Options:
  --kebab <name>       Product repository name (kebab-case, required)
  --display <name>     Display name (defaults to kebab with spaces)
  --github <org/repo>  GitHub slug for README clone URL (defaults to --kebab)
  --init-git           Run git init -b main when .git is absent
  --keep-template      Keep archive/, DESIGN.md, and PLAN.md
  --skip-validate      Skip npm run validate
  --dry-run            Print actions without writing
  --force              Allow running on the canonical skeleton checkout
  --yes                Skip confirmation prompt
  -h, --help           Show this help
`;
}

function parseArgs(argv) {
  const options = {
    kebab: '',
    display: '',
    github: '',
    initGit: false,
    keepTemplate: false,
    skipValidate: false,
    dryRun: false,
    force: false,
    yes: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--kebab':
        options.kebab = argv[++index] ?? '';
        break;
      case '--display':
        options.display = argv[++index] ?? '';
        break;
      case '--github':
        options.github = argv[++index] ?? '';
        break;
      case '--init-git':
        options.initGit = true;
        break;
      case '--keep-template':
        options.keepTemplate = true;
        break;
      case '--skip-validate':
        options.skipValidate = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--yes':
        options.yes = true;
        break;
      default:
        throw new Error(`unknown option: ${arg}\n\n${usage()}`);
    }
  }

  return options;
}

function assertKebab(value) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`--kebab must be kebab-case (a-z, 0-9, hyphen): ${value}`);
  }
}

async function promptLine(question, defaultValue = '') {
  const rl = createInterface({ input, output });
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  rl.close();
  return answer || defaultValue;
}

async function resolveOptions(raw) {
  if (raw.help) {
    console.log(usage());
    process.exit(0);
  }

  const kebab = raw.kebab || await promptLine('Product kebab-case name');
  assertKebab(kebab);

  const display = raw.display || await promptLine('Display name', kebab.replace(/-/g, ' '));
  const github = raw.github || await promptLine('GitHub org/repo', kebab);

  return {
    ...raw,
    kebab,
    display,
    github,
    cloneUrl: `https://github.com/${github}.git`,
  };
}

async function walkFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = join(directory, entry.name);
    const repositoryPath = relative(root, absolute).split(sep).join('/');
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...await walkFiles(root, absolute));
      continue;
    }
    if (!entry.isFile()) continue;
    if (repositoryPath.startsWith('scripts/')) continue;
    const extension = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.')) : '';
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    files.push(repositoryPath);
  }

  return files;
}

function replaceIdentity(text, identity) {
  return text
    .replaceAll(TEMPLATE.display, identity.display)
    .replaceAll(TEMPLATE.cloneUrl, identity.cloneUrl)
    .replaceAll(TEMPLATE.github, identity.github)
    .replaceAll(TEMPLATE.kebab, identity.kebab);
}

function projectScaffold(identity) {
  return `# プロジェクト

## プロダクト

${identity.display} は（TODO: 一行でプロダクトの目的を記述）。

## ユーザー

（TODO: 主要ユーザー）

## 成果

（TODO: 成功条件）

## ランタイム

（TODO: 言語、フレームワーク、デプロイ先）

## コマンド

- \`npm run validate\` — ガバナンス検証
- （TODO: プロダクトの build / test / dev コマンド）

## 初期化ルール

最初のプロダクト機能を追加する前に、プロダクト、ユーザー、成果、ランタイム、コマンドの各 TODO を埋める。手順は [docs/operations/SETUP.md](docs/operations/SETUP.md) を参照。永続的なアーキテクチャ選択は [docs/adr/](docs/adr/) に記録する。
`;
}

function simplifyReadmeLanguage(text) {
  return text.replace(
    /## 言語\n\n[\s\S]*?(?=\n## 要件)/,
    `## 言語\n\n現行のガバナンス文書は**日本語**です。\`harness/governance.mjs\` の必須見出し検証も日本語見出しに合わせています。Issue／PR の機械可読タグ（\`Behavior\`、\`Change-Kind\` など）は英語のままです。\n\n`,
  );
}

function patchAfterTemplateRemoval(text, path) {
  if (path === 'AGENTS.md') {
    return text.replace(
      /現行の権威文書はリポジトリルートと `docs\/` の日本語版です。[^\n]+\n/,
      '現行の権威文書はリポジトリルートと `docs/` の日本語版です。\n',
    );
  }

  if (path === 'README.md') {
    let updated = simplifyReadmeLanguage(text);
    updated = updated.replace(/^├── archive\/en\/[^\n]*\n/m, '');
    updated = updated.replace(/^\| `archive\/en\/` \|[^\n]*\n/m, '');
    updated = updated.replace(
      /または `cp -r [^`]+` でコピーします。コピー先では `archive\/` は削除して構いません（\[言語\]\(#言語\) を参照）。\n/,
      'または `cp -r` でコピーします。\n',
    );
    updated = updated.replace(
      /- 権威文書はルートの日本語版を参照する。`archive\/` は参照専用であり、作業時の authority にしない。\n- \[`\.cursorignore`\]\(\.cursorignore\) により `archive\/en\/` は Cursor の索引対象外としている。\n/,
      '- 権威文書はルートの日本語版を参照する。\n',
    );
    return updated;
  }

  if (path === 'docs/operations/SETUP.md') {
    return text.replace(
      /## 8\. 英語版ガバナンス文書から始める場合[\s\S]*?(?=\n## 検証に失敗したとき)/,
      '',
    );
  }

  return text;
}

function isCanonicalSkeletonCheckout(root) {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return false;
  }
  return result.stdout.trim().includes(TEMPLATE.github);
}

async function removeTemplateArtifacts(root, dryRun) {
  const targets = ['archive', 'DESIGN.md', 'PLAN.md', '.cursorignore'];
  for (const target of targets) {
    const absolute = join(root, target);
    try {
      await lstat(absolute);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    console.log(`remove ${target}`);
    if (!dryRun) {
      await rm(absolute, { recursive: true, force: true });
    }
  }
}

async function replaceInTree(root, identity, dryRun) {
  const files = await walkFiles(root);
  for (const path of files) {
    if (path === 'PROJECT.md') continue;
    const absolute = join(root, path);
    const original = await readFile(absolute, 'utf8');
    let updated = replaceIdentity(original, identity);
    if (!identity.keepTemplate) {
      updated = patchAfterTemplateRemoval(updated, path);
    } else if (path === 'README.md') {
      updated = simplifyReadmeLanguage(updated);
    }
    if (updated === original) continue;
    console.log(`update ${path}`);
    if (!dryRun) {
      await writeFile(absolute, updated, 'utf8');
    }
  }
}

async function writeProjectScaffold(root, identity, dryRun) {
  const content = projectScaffold(identity);
  console.log('write PROJECT.md scaffold');
  if (!dryRun) {
    await writeFile(join(root, 'PROJECT.md'), content, 'utf8');
  }
}

async function verifyNoTemplateStrings(root) {
  const patterns = [TEMPLATE.display, TEMPLATE.kebab, TEMPLATE.github];
  const files = await walkFiles(root);
  const findings = [];

  for (const path of files) {
    if (SKIP_VERIFY.has(path)) continue;
    const text = await readFile(join(root, path), 'utf8');
    for (const pattern of patterns) {
      if (text.includes(pattern)) {
        findings.push({ path, pattern });
      }
    }
  }

  if (findings.length > 0) {
    const lines = findings.map(({ path, pattern }) => `  ${path}: ${pattern}`);
    throw new Error(`template strings remain after setup:\n${lines.join('\n')}`);
  }
}

function initGit(root, dryRun) {
  console.log('git init -b main');
  if (dryRun) return;
  const result = spawnSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error('git init failed');
  }
}

function runValidate(root, dryRun) {
  console.log('npm run validate');
  if (dryRun) return;
  const result = spawnSync('npm', ['run', 'validate'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    throw new Error('npm run validate failed');
  }
}

function printManualChecklist() {
  console.log('\nManual steps remaining:');
  console.log('  1. Fill TODO sections in PROJECT.md');
  console.log('  2. Define terms in CONTEXT.md');
  console.log('  3. Replace the boundary table in ARCHITECTURE.md');
  console.log('  4. Adjust harness.config.json sourceRoots and extensions');
  console.log('  5. Add product build/test steps to .github/workflows/ci.yml');
  console.log('  6. Create the first vertical-slice Issue on GitHub');
  console.log('  7. Commit baseline, add remote, push, and decide on branch protection');
}

async function main() {
  const root = resolve(process.cwd());
  const raw = parseArgs(process.argv.slice(2));
  const options = await resolveOptions(raw);
  options.keepTemplate = raw.keepTemplate;

  if (isCanonicalSkeletonCheckout(root) && !options.force) {
    throw new Error(
      'refusing to run on the canonical skeleton remote; copy the directory and remove .git first, or pass --force',
    );
  }

  if (!options.yes && !options.dryRun) {
    const answer = await promptLine(
      `Setup ${options.display} (${options.kebab}) in ${basename(root)}? Type yes`,
      'yes',
    );
    if (answer.toLowerCase() !== 'yes') {
      throw new Error('setup cancelled');
    }
  }

  const identity = {
    kebab: options.kebab,
    display: options.display,
    github: options.github,
    cloneUrl: options.cloneUrl,
    keepTemplate: options.keepTemplate,
  };

  if (!options.keepTemplate) {
    await removeTemplateArtifacts(root, options.dryRun);
  }

  await replaceInTree(root, identity, options.dryRun);
  await writeProjectScaffold(root, identity, options.dryRun);

  if (options.initGit) {
    try {
      await lstat(join(root, '.git'));
      console.log('skip git init (.git already exists)');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      initGit(root, options.dryRun);
    }
  }

  if (!options.dryRun) {
    await verifyNoTemplateStrings(root);
  }

  if (!options.skipValidate) {
    runValidate(root, options.dryRun);
  }

  printManualChecklist();
}

main().catch((error) => {
  console.error(`setup-product: ${error.message}`);
  process.exit(1);
});
