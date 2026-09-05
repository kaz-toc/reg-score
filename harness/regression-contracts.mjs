import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, posix } from 'node:path';

import {
  HarnessConfigError,
  resolveRepositoryPath,
} from './paths.mjs';

const CASE_ID = /^REG-\d{4}-\d{3}$/;
const STATUSES = new Set(['active', 'retired']);

function finding(checkId, path, message) {
  return { checkId, path, message };
}

async function exists(path) {
  try {
    const value = await stat(path);
    return value.isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringArray(value) {
  return Array.isArray(value) && value.every(nonEmptyString);
}

export async function discoverRegressionCases({ root, config }) {
  const regressionRoot = resolveRepositoryPath(root, config.regressionRoot);
  let entries;
  try {
    entries = await readdir(regressionRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isDirectory() && CASE_ID.test(entry.name))
    .map((entry) => ({
      directory: posix.join(config.regressionRoot, entry.name),
      sourcePath: posix.join(config.regressionRoot, entry.name, 'case.json'),
    }))
    .sort((left, right) => left.directory.localeCompare(right.directory));
}

export async function validateRegressionCase({ root, directory, value }) {
  const sourcePath = posix.join(directory, 'case.json');
  const findings = [];

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [finding('regression/schema', sourcePath, 'case must be a JSON object')];
  }
  if (value.schemaVersion !== 1) {
    findings.push(finding('regression/schema', sourcePath, 'schemaVersion must be 1'));
  }
  if (!nonEmptyString(value.id) || !CASE_ID.test(value.id)) {
    findings.push(finding('regression/schema', sourcePath, 'id must match REG-YYYY-NNN'));
  } else if (value.id !== basename(directory)) {
    findings.push(finding('regression/directory-id', sourcePath, `case id ${value.id} does not match directory ${basename(directory)}`));
  }
  if (!STATUSES.has(value.status)) {
    findings.push(finding('regression/status', sourcePath, 'status must be active or retired'));
  }
  for (const field of ['title', 'invariant', 'incident']) {
    if (!nonEmptyString(value[field])) {
      findings.push(finding('regression/schema', sourcePath, `${field} must be a non-empty string`));
    }
  }
  for (const field of ['productionFiles', 'testFiles']) {
    if (!stringArray(value[field])) {
      findings.push(finding('regression/schema', sourcePath, `${field} must be an array of non-empty strings`));
    }
  }
  if (!stringArray(value.verificationCommands) || value.verificationCommands.length === 0) {
    findings.push(finding('regression/verification', sourcePath, 'verificationCommands must contain at least one command'));
  }

  if (value.status !== 'active') return findings;

  for (const field of ['productionFiles', 'testFiles']) {
    if (!stringArray(value[field])) continue;
    for (const path of value[field]) {
      let absolute;
      try {
        absolute = resolveRepositoryPath(root, path);
      } catch (error) {
        if (error instanceof HarnessConfigError) {
          findings.push(finding('regression/unsafe-path', sourcePath, `${field} contains unsafe path: ${path}`));
          continue;
        }
        throw error;
      }
      if (!(await exists(absolute))) {
        findings.push(finding('regression/missing-file', sourcePath, `referenced file is missing: ${path}`));
        continue;
      }
      if (field === 'testFiles' && nonEmptyString(value.id)) {
        const text = await readFile(absolute, 'utf8');
        if (!text.includes(value.id)) {
          findings.push(finding('regression/missing-marker', sourcePath, `${value.id} marker is missing from ${path}`));
        }
      }
    }
  }
  return findings;
}

export async function checkRegressionContracts({ root, config }) {
  const discovered = await discoverRegressionCases({ root, config });
  const findings = [];
  const loaded = [];

  for (const item of discovered) {
    let value;
    try {
      value = JSON.parse(await readFile(resolveRepositoryPath(root, item.sourcePath), 'utf8'));
    } catch (error) {
      findings.push(finding('regression/json', item.sourcePath, `cannot parse case.json: ${error.message}`));
      continue;
    }
    loaded.push({ ...item, value });
    findings.push(...await validateRegressionCase({
      root,
      directory: item.directory,
      value,
    }));
  }

  const byId = new Map();
  for (const item of loaded) {
    if (!nonEmptyString(item.value.id)) continue;
    const paths = byId.get(item.value.id) ?? [];
    paths.push(item.sourcePath);
    byId.set(item.value.id, paths);
  }
  for (const [id, paths] of byId) {
    if (paths.length < 2) continue;
    for (const path of paths) {
      findings.push(finding('regression/duplicate-id', path, `duplicate regression id: ${id}`));
    }
  }

  return findings.sort((left, right) =>
    left.path.localeCompare(right.path)
    || left.checkId.localeCompare(right.checkId)
    || left.message.localeCompare(right.message));
}
