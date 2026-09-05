import { collectSourceStats } from './file-size.mjs';
import { checkPolicyIntegrity } from './policy-integrity.mjs';
import { runProjectChecks } from './project-checks.mjs';

function renderFindings(findings) {
  if (findings.length === 0) return 'No findings.';
  return findings.map((finding) => {
    const location = finding.line === undefined ? finding.path : `${finding.path}:${finding.line}`;
    return `- [${finding.checkId}] ${location}: ${finding.message}`;
  }).join('\n');
}

export async function buildStructuralHealthReport({
  root,
  config,
  generatedAt,
  commit,
}) {
  const [stats, policyFindings, projectFindings] = await Promise.all([
    collectSourceStats({ root, config }),
    checkPolicyIntegrity({ root, config }),
    runProjectChecks({ root, config }),
  ]);
  const largest = [...stats]
    .sort((left, right) =>
      right.nonBlankLines - left.nonBlankLines
      || left.path.localeCompare(right.path))
    .slice(0, 20);

  const sizeSection = largest.length === 0
    ? 'No governed source files.'
    : [
        '| Nonblank lines | Path |',
        '|---:|---|',
        ...largest.map(({ path, nonBlankLines }) => `| ${nonBlankLines} | \`${path}\` |`),
      ].join('\n');

  return [
    '# Structural Health Report',
    '',
    `Generated: ${generatedAt}`,
    '',
    `Commit: \`${commit}\``,
    '',
    '## Largest governed source files',
    '',
    sizeSection,
    '',
    '## Policy integrity',
    '',
    renderFindings(policyFindings),
    '',
    '## Project checks',
    '',
    renderFindings(projectFindings),
    '',
  ].join('\n');
}

