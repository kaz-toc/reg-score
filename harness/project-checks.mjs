import { pathToFileURL } from 'node:url';

import {
  HarnessConfigError,
  resolveRepositoryPath,
} from './paths.mjs';

export class HarnessExecutionError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'HarnessExecutionError';
  }
}

function validateFinding(value, modulePath) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HarnessExecutionError(`${modulePath} returned a non-object finding`);
  }
  for (const field of ['checkId', 'path', 'message']) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) {
      throw new HarnessExecutionError(`${modulePath} finding requires non-empty ${field}`);
    }
  }
  if (value.line !== undefined && (!Number.isInteger(value.line) || value.line < 1)) {
    throw new HarnessExecutionError(`${modulePath} finding line must be a positive integer`);
  }
  return {
    checkId: value.checkId,
    path: value.path,
    message: value.message,
    ...(value.line === undefined ? {} : { line: value.line }),
  };
}

export async function runProjectChecks({ root, config }) {
  const findings = [];
  const modulePaths = [...config.projectChecks].sort((left, right) => left.localeCompare(right));

  for (const modulePath of modulePaths) {
    const absolute = resolveRepositoryPath(root, modulePath);
    let loaded;
    try {
      loaded = await import(pathToFileURL(absolute).href);
    } catch (error) {
      throw new HarnessExecutionError(`${modulePath} could not be loaded: ${error.message}`, { cause: error });
    }
    if (typeof loaded.check !== 'function') {
      throw new HarnessExecutionError(`${modulePath} must export async function check(context)`);
    }

    let values;
    try {
      values = await loaded.check({ root, config });
    } catch (error) {
      throw new HarnessExecutionError(`${modulePath} check failed: ${error.message}`, { cause: error });
    }
    if (!Array.isArray(values)) {
      throw new HarnessExecutionError(`${modulePath} check must return an array`);
    }
    for (const value of values) {
      const finding = validateFinding(value, modulePath);
      try {
        resolveRepositoryPath(root, finding.path);
      } catch (error) {
        if (error instanceof HarnessConfigError) {
          throw new HarnessExecutionError(`${modulePath} returned unsafe finding path: ${finding.path}`, { cause: error });
        }
        throw error;
      }
      findings.push(finding);
    }
  }

  return findings;
}

