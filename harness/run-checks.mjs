import { pathToFileURL } from 'node:url';

import { HarnessConfigError, loadConfig } from './config.mjs';
import { checkFileSize } from './file-size.mjs';
import { checkGovernance } from './governance.mjs';
import { checkPolicyIntegrity } from './policy-integrity.mjs';
import { HarnessExecutionError, runProjectChecks } from './project-checks.mjs';
import { checkRegressionContracts } from './regression-contracts.mjs';
import { buildStructuralHealthReport } from './structural-health.mjs';

function sortFindings(findings) {
  return findings.sort((left, right) =>
    left.checkId.localeCompare(right.checkId)
    || left.path.localeCompare(right.path)
    || (left.line ?? 0) - (right.line ?? 0)
    || left.message.localeCompare(right.message));
}

export async function validateRepository({ root }) {
  const config = await loadConfig(root);
  const groups = await Promise.all([
    checkFileSize({ root, config }),
    checkGovernance({ root, config }),
    checkPolicyIntegrity({ root, config }),
    checkRegressionContracts({ root, config }),
    runProjectChecks({ root, config }),
  ]);
  return sortFindings(groups.flat());
}

export function formatFindings(findings) {
  return findings.map((finding) => {
    const location = finding.line === undefined ? finding.path : `${finding.path}:${finding.line}`;
    return `[${finding.checkId}] ${location}: ${finding.message}`;
  }).join('\n');
}

export async function runCli({
  mode,
  root = process.cwd(),
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  now = () => new Date(),
}) {
  try {
    if (mode === 'validate') {
      const findings = await validateRepository({ root });
      if (findings.length > 0) {
        stderr.write(formatFindings(findings) + '\n');
        return 1;
      }
      stdout.write('harness: validation passed\n');
      return 0;
    }
    if (mode === 'report') {
      const config = await loadConfig(root);
      const report = await buildStructuralHealthReport({
        root,
        config,
        generatedAt: now().toISOString(),
        commit: env.GITHUB_SHA || 'working-tree',
      });
      stdout.write(report);
      return 0;
    }
    throw new HarnessExecutionError(`unknown mode: ${mode ?? ''}`);
  } catch (error) {
    if (error instanceof HarnessConfigError || error instanceof HarnessExecutionError) {
      stderr.write(`harness: execution error: ${error.message}\n`);
      if (env.HARNESS_DEBUG === '1' && error.stack) stderr.write(error.stack + '\n');
      return 2;
    }
    stderr.write(`harness: execution error: ${error.message}\n`);
    if (env.HARNESS_DEBUG === '1' && error.stack) stderr.write(error.stack + '\n');
    return 2;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedPath === import.meta.url) {
  process.exitCode = await runCli({ mode: process.argv[2] });
}

