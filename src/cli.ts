#!/usr/bin/env node
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createRepositorySnapshot } from './intake/snapshot.js';
import { appendTrend, runDiagnosis, saveBaseline } from './pipeline/diagnose.js';
import { formatReport } from './reporting/format.js';
import { runDiffDiagnosis, writeGitHubSummary } from './commands/diff.js';
import { loadPolicy, evaluatePolicy } from './operations/policy.js';
import { loadCalibration, summarizeCalibration } from './calibration/dataset.js';
import {
  GoStubAnalyzerPlugin,
  PythonStubAnalyzerPlugin,
  TypeScriptAnalyzerPlugin,
  negotiateCapabilities,
} from './plugins/analyzer.js';

const program = new Command();

program.name('reg-score').description('Regression risk scoring diagnostic tool').version('0.1.0');

program
  .command('scan')
  .argument('<path>', 'repository path')
  .option('--format <format>', 'console|markdown|json', 'console')
  .option('--save-baseline', 'save report as baseline', false)
  .option('--record-trend', 'append score to trend history', false)
  .action(async (repoPath: string, options: { format: string; saveBaseline: boolean; recordTrend: boolean }) => {
    const format = options.format as 'console' | 'markdown' | 'json';
    const snapshot = await createRepositorySnapshot(repoPath);
    const report = await runDiagnosis(snapshot);

    if (options.saveBaseline) {
      const baselinePath = await saveBaseline(snapshot, report);
      process.stderr.write(`baseline saved: ${baselinePath}\n`);
    }
    if (options.recordTrend) {
      await appendTrend(snapshot, report);
    }

    process.stdout.write(formatReport(report, format));
    process.exit(0);
  });

program
  .command('diff')
  .argument('<path>', 'repository path')
  .requiredOption('--base <ref>', 'git ref for baseline comparison')
  .option('--format <format>', 'console|markdown|json', 'console')
  .option('--github-summary <file>', 'write GitHub job summary markdown')
  .action(async (repoPath: string, options: { base: string; format: string; githubSummary?: string }) => {
    const diff = await runDiffDiagnosis(repoPath, options.base);
    const format = options.format as 'console' | 'markdown' | 'json';

    if (options.githubSummary) {
      await writeGitHubSummary(diff, options.githubSummary);
    }

    if (diff.contractMismatch) {
      process.stderr.write('warning: assessment contract mismatch — risk delta suppressed\n');
    }

    process.stdout.write(formatReport(diff.current, format));
    process.exit(0);
  });

program
  .command('baseline')
  .argument('<path>', 'repository path')
  .option('--save', 'save current scan as baseline')
  .action(async (repoPath: string, options: { save?: boolean }) => {
    const snapshot = await createRepositorySnapshot(repoPath);
    if (options.save) {
      const report = await runDiagnosis(snapshot);
      const baselinePath = await saveBaseline(snapshot, report);
      process.stdout.write(`${baselinePath}\n`);
      return;
    }
    process.stdout.write(`inputId: ${snapshot.inputId}\n`);
  });

program
  .command('trend')
  .argument('<path>', 'repository path')
  .action(async (repoPath: string) => {
    const resolved = path.resolve(repoPath);
    const snapshot = await createRepositorySnapshot(resolved);
    const trendPath = path.join(resolved, snapshot.config.trendDir, 'history.jsonl');
    try {
      const raw = await readFile(trendPath, 'utf8');
      process.stdout.write(raw);
    } catch {
      process.stdout.write('');
    }
  });

program
  .command('policy')
  .argument('<path>', 'repository path')
  .option('--evaluate', 'evaluate current score against policy')
  .action(async (repoPath: string, options: { evaluate?: boolean }) => {
    const snapshot = await createRepositorySnapshot(repoPath);
    const policy = await loadPolicy(snapshot.repositoryPath, snapshot.config.policyFile);
    if (!options.evaluate) {
      process.stdout.write(`${JSON.stringify(policy, null, 2)}\n`);
      return;
    }
    const report = await runDiagnosis(snapshot);
    const calibration = await loadCalibration(snapshot.repositoryPath);
    const evaluation = evaluatePolicy(
      report.repository.regressionRiskScore,
      report.repository.confidence,
      policy,
      calibration.gateEligible,
    );
    process.stdout.write(`${JSON.stringify(evaluation, null, 2)}\n`);
    if (evaluation.gateWouldFail) {
      process.exit(1);
    }
  });

program
  .command('calibration')
  .argument('<path>', 'repository path')
  .action(async (repoPath: string) => {
    const calibration = await loadCalibration(path.resolve(repoPath));
    process.stdout.write(`${summarizeCalibration(calibration)}\n`);
  });

program
  .command('plugins')
  .description('list analyzer plugin capabilities')
  .action(() => {
    const plugins = [new TypeScriptAnalyzerPlugin(), new PythonStubAnalyzerPlugin(), new GoStubAnalyzerPlugin()];
    const negotiation = negotiateCapabilities(plugins);
    process.stdout.write(`${JSON.stringify({ plugins: plugins.map((p) => p.id), ...negotiation }, null, 2)}\n`);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`reg-score: ${message}\n`);
  process.exit(2);
});
