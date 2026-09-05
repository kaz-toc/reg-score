#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';

import { createRepositorySnapshot } from './intake/snapshot.js';
import { appendTrend, runDiagnosis, saveBaseline } from './pipeline/diagnose.js';
import { runDiffDiagnosis, writeGitHubSummary, writeGitHubAnnotations } from './commands/diff.js';
import { loadPolicy, evaluatePolicy } from './operations/policy.js';
import { loadCalibration, summarizeCalibration } from './calibration/dataset.js';
import { runGoldenAssessmentRegression } from './calibration/golden-regression.js';
import { DefaultReporterAdapter } from './adapters/reporter.js';
import { analyzeTrend, loadTrendHistory, rankInvestmentPriorities, trendPathFor } from './operations/trend.js';
import {
  GoStubAnalyzerPlugin,
  PythonStubAnalyzerPlugin,
  TypeScriptAnalyzerPlugin,
  negotiateCapabilities,
} from './plugins/analyzer.js';

const program = new Command();
const reporter = new DefaultReporterAdapter();

program.name('reg-score').description('Regression risk scoring diagnostic tool').version('0.1.0');

program
  .command('scan')
  .argument('<path>', 'repository path')
  .option('--format <format>', 'console|markdown|json', 'console')
  .option('--save-baseline', 'save report as baseline', false)
  .option('--record-trend', 'append score to trend history', false)
  .option('--unit <id>', 'monorepo unit id from reg-score.config.json')
  .action(async (repoPath: string, options: { format: string; saveBaseline: boolean; recordTrend: boolean; unit?: string }) => {
    const format = options.format as 'console' | 'markdown' | 'json';
    const snapshot = await createRepositorySnapshot(repoPath, options.unit);
    const report = await runDiagnosis(snapshot);

    if (options.saveBaseline) {
      const baselinePath = await saveBaseline(snapshot, report);
      process.stderr.write(`baseline saved: ${baselinePath}\n`);
    }
    if (options.recordTrend) {
      await appendTrend(snapshot, report);
    }

    process.stdout.write(reporter.format(report, format));
    process.exit(0);
  });

program
  .command('diff')
  .argument('<path>', 'repository path')
  .requiredOption('--base <ref>', 'git ref for baseline comparison')
  .option('--format <format>', 'console|markdown|json', 'console')
  .option('--github-summary <file>', 'write GitHub job summary markdown')
  .option('--github-annotations <file>', 'write GitHub workflow annotations')
  .action(async (repoPath: string, options: { base: string; format: string; githubSummary?: string; githubAnnotations?: string }) => {
    const diff = await runDiffDiagnosis(repoPath, options.base);
    const format = options.format as 'console' | 'markdown' | 'json';

    if (options.githubSummary) {
      await writeGitHubSummary(diff, options.githubSummary);
    }
    if (options.githubAnnotations) {
      await writeGitHubAnnotations(diff, options.githubAnnotations);
    }

    if (diff.contractMismatch) {
      process.stderr.write('warning: assessment contract mismatch — risk delta suppressed\n');
    }

    process.stdout.write(reporter.format(diff.current, format));
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
  .option('--analyze', 'detect score degradation and contributing clusters')
  .action(async (repoPath: string, options: { analyze?: boolean }) => {
    const resolved = path.resolve(repoPath);
    const snapshot = await createRepositorySnapshot(resolved);
    const trendPath = trendPathFor(resolved, snapshot.config.trendDir);
    const entries = await loadTrendHistory(trendPath);
    if (!options.analyze) {
      process.stdout.write(`${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(analyzeTrend(entries), null, 2)}\n`);
  });

program
  .command('priorities')
  .argument('<path>', 'repository path')
  .description('improvement investment priority view')
  .action(async (repoPath: string) => {
    const snapshot = await createRepositorySnapshot(repoPath);
    const report = await runDiagnosis(snapshot);
    const priorities = rankInvestmentPriorities(report);
    process.stdout.write(`${JSON.stringify(priorities, null, 2)}\n`);
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
  .option('--golden', 'run golden assessment regression check')
  .action(async (repoPath: string, options: { golden?: boolean }) => {
    if (options.golden) {
      const report = await runGoldenAssessmentRegression();
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (!report.passed) {
        process.exit(1);
      }
      return;
    }
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
