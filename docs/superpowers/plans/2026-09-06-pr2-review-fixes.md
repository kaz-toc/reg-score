# PR #2 Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the remaining PR #2 correctness and safety defects while preserving explicit Intake, Assessment, Comparison, Persistence, and Reporting boundaries.

**Architecture:** Persistence validates physical filesystem boundaries and owns baseline/trend lifecycle. A pure Comparison module selects one commit-bound, policy-compatible baseline and derives every comparison value from it; Commands only orchestrate Git and domain calls. Semantic implementations remain dependency-injected, while capability and calibration decisions operate on versioned data rather than implementation helpers.

**Tech Stack:** TypeScript 5.7, Node.js 22, Zod 3, Vitest 3, Git, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-09-06-pr2-review-fixes-design.md`

## Global Constraints

- No backward compatibility is required because the package is unreleased.
- Old baseline, trend, and calibration shapes must produce an explicit schema or contract mismatch; they must not be silently ignored.
- Raw analysis paths remain unchanged; redaction is applied only to report copies crossing persistence or reporting boundaries.
- Retention must never recursively delete and must never follow a symbolic link outside the repository.
- Every Git-based test creates its own temporary repository and at least two commits.
- Node.js 22 is the verification runtime.

## File Structure

- `src/persistence/storage-boundary.ts` — validate lexical and physical storage containment.
- `src/persistence/retention.ts` — expire baseline files and trend entries, returning structured audit records.
- `src/persistence/baseline-store.ts` — save, load, and select commit-bound baseline entries.
- `src/persistence/trend-store.ts` — append and load trend entries through validated storage.
- `src/comparison/compare.ts` — pure baseline compatibility, signal changes, and risk delta.
- `src/pipeline/diagnose.ts` — diagnosis orchestration only.
- `src/schema/report.v1.ts` — baseline schema v2 and Diff Report schema v2.
- `src/shared/redaction.ts` — normalized redaction-policy fingerprint and report-copy redaction.
- `src/adapters/git-provider.ts` — resolve a ref to a commit SHA.
- `src/semantic/provider.ts` — injected provider behavior without a name-only registry.
- `src/assessment/risk.ts` — consume capability DTOs without importing analyzer implementation helpers.
- `src/plugins/analyzer.ts` — negotiate runtime-dependent signals.
- `src/operations/policy.ts` and `src/calibration/dataset.ts` — required/satisfied custom calibration conditions.
- `tests/helpers/git-repository.ts` — hermetic two-commit Git fixture helper.
- `tests/persistence.test.ts` — symlink and entry-retention regression contracts.
- `tests/comparison.test.ts` — commit binding, redaction, and mismatch contracts.
- Existing tests — schema, semantic, capability, calibration, CLI, and reporting contract updates.

---

### Task 1: Hermetic Git Test Repositories

**Files:**
- Create: `tests/helpers/git-repository.ts`
- Modify: `tests/review-fixes.test.ts:108-127`
- Test: `tests/review-fixes.test.ts`

**Interfaces:**
- Produces: `createGitRepository(files?: Record<string, string>): Promise<TestGitRepository>`
- Produces: `TestGitRepository = { path: string; baseSha: string; headSha: string; write(relativePath, content): Promise<void>; commit(message): Promise<string>; cleanup(): Promise<void> }`

- [ ] **Step 1: Change the two ambient-history tests to use a missing helper**

```ts
const repo = await createGitRepository({ 'src/a.ts': 'export const a = 1;\n' });
try {
  const diff = await runDiffDiagnosis(repo.path, repo.baseSha);
  expect(diff.comparison.compatible).toBe(false);
} finally {
  await repo.cleanup();
}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/review-fixes.test.ts`

Expected: FAIL because `tests/helpers/git-repository.ts` does not exist.

- [ ] **Step 3: Implement the helper with real Git commands**

```ts
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

export async function createGitRepository(files: Record<string, string> = {}): Promise<TestGitRepository> {
  const repositoryPath = await mkdtemp(path.join(os.tmpdir(), 'reg-score-git-test-'));
  await git(repositoryPath, ['init']);
  await git(repositoryPath, ['config', 'user.email', 'reg-score@example.test']);
  await git(repositoryPath, ['config', 'user.name', 'reg-score test']);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(repositoryPath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }
  await git(repositoryPath, ['add', '.']);
  await git(repositoryPath, ['commit', '-m', 'base']);
  const baseSha = await git(repositoryPath, ['rev-parse', 'HEAD']);
  await writeFile(path.join(repositoryPath, 'test-head.txt'), 'head\n');
  await git(repositoryPath, ['add', '.']);
  await git(repositoryPath, ['commit', '-m', 'head']);
  const headSha = await git(repositoryPath, ['rev-parse', 'HEAD']);
  const write = async (relativePath: string, content: string): Promise<void> => {
    const absolutePath = path.join(repositoryPath, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  };
  const commit = async (message: string): Promise<string> => {
    await git(repositoryPath, ['add', '.']);
    await git(repositoryPath, ['commit', '-m', message]);
    return git(repositoryPath, ['rev-parse', 'HEAD']);
  };
  const cleanup = (): Promise<void> => rm(repositoryPath, { recursive: true, force: true });
  return { path: repositoryPath, baseSha, headSha, write, commit, cleanup };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- tests/review-fixes.test.ts`

Expected: all tests in the file pass without depending on the checkout history.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/git-repository.ts tests/review-fixes.test.ts
git commit -m "test: make diff regressions independent of checkout depth"
```

### Task 2: Physical Storage Boundary and Entry-Level Retention

**Files:**
- Create: `src/persistence/storage-boundary.ts`
- Create: `src/persistence/retention.ts`
- Create: `tests/persistence.test.ts`
- Modify: `src/shared/atomic-write.ts`
- Modify: `src/pipeline/diagnose.ts:40-93,129-170`

**Interfaces:**
- Produces: `resolveSafeStorageDir(repositoryPath: string, configuredDir: string, label: string, create: boolean): Promise<string>`
- Produces: `RetentionAudit = { storage: 'baseline' | 'trend'; reason: 'expired'; removedEntries: number }`
- Produces: `PersistenceResult = { path: string; retention: RetentionAudit[] }`
- Produces: `retainBaselineEntries(directory: string, cutoff: Date): Promise<RetentionAudit>`
- Produces: `retainTrendEntries(historyPath: string, cutoff: Date): Promise<RetentionAudit>`

- [ ] **Step 1: Add failing symlink and trend-entry tests**

```ts
it('rejects a storage directory symlink without touching its target', async () => {
  await symlink(outsideDir, path.join(repositoryPath, '.reg-score', 'baselines'));
  await expect(resolveSafeStorageDir(repositoryPath, '.reg-score/baselines', 'baselineDir', false))
    .rejects.toBeInstanceOf(ConfigError);
  expect(await readFile(victimPath, 'utf8')).toBe('keep me');
});

it('removes only expired trend entries', async () => {
  const audit = await retainTrendEntries(historyPath, new Date('2026-02-01T00:00:00.000Z'));
  expect((await loadTrendHistory(historyPath)).map((entry) => entry.inputId)).toEqual(['fresh']);
  expect(audit).toEqual({ storage: 'trend', reason: 'expired', removedEntries: 1 });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- tests/persistence.test.ts`

Expected: FAIL because the persistence modules do not exist.

- [ ] **Step 3: Implement physical containment**

Walk every existing component from `realpath(repositoryPath)` to the configured directory with `lstat`; reject `isSymbolicLink()`. After optional `mkdir`, compare `realpath(directory)` to the repository realpath using `path.relative`. Do not expose a synchronous lexical-only guard.

```ts
for (const component of componentsFromRepositoryToStorage) {
  const componentStat = await lstat(component).catch(() => null);
  if (componentStat?.isSymbolicLink()) {
    throw new ConfigError(configuredDir, `${label} contains a symbolic link`);
  }
}
if (create) await mkdir(lexicalStoragePath, { recursive: true });
const storageRealPath = await realpath(lexicalStoragePath);
const relative = path.relative(repositoryRealPath, storageRealPath);
if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
  return storageRealPath;
}
throw new ConfigError(configuredDir, `${label} escapes repository root`);
```

- [ ] **Step 4: Implement non-recursive baseline retention and atomic trend filtering**

Baseline retention must use `lstat`, accept only regular `*.json` files, and call `rm(file, { force: true })`. Trend retention must parse every non-empty line with `trendEntrySchema`, keep entries whose `generatedAt >= cutoff.toISOString()`, and use `atomicWriteFile` only when entries were removed.

```ts
const retained = entries.filter((entry) => entry.generatedAt >= cutoff.toISOString());
if (retained.length !== entries.length) {
  const content = retained.length === 0 ? '' : `${retained.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
  await atomicWriteFile(historyPath, content);
}
return { storage: 'trend', reason: 'expired', removedEntries: entries.length - retained.length };
```

- [ ] **Step 5: Route baseline/trend writes through the new modules**

Replace `resolveStorageDir`, `assertRetentionTarget`, file-mtime trend deletion, and direct stderr output in `pipeline/diagnose.ts`. Change `saveBaseline` and `appendTrend` to return `{ path, retention }` and update their callers in the same step.

- [ ] **Step 6: Run focused and existing persistence tests**

Run: `npm test -- tests/persistence.test.ts tests/integration.test.ts tests/operations.test.ts`

Expected: all selected tests pass; the symlink target remains unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/persistence src/shared/atomic-write.ts src/pipeline/diagnose.ts tests/persistence.test.ts tests/integration.test.ts
git commit -m "fix: enforce physical persistence boundaries"
```

### Task 3: Commit-Bound Baselines and One Comparison Owner

**Files:**
- Create: `src/persistence/baseline-store.ts`
- Create: `src/comparison/compare.ts`
- Create: `tests/comparison.test.ts`
- Modify: `src/schema/report.v1.ts:229-291`
- Modify: `src/shared/redaction.ts`
- Modify: `src/adapters/git-provider.ts`
- Modify: `src/commands/diff.ts:1-231`
- Modify: `src/reporting/format.ts`
- Modify: `src/reporting/github.ts`
- Modify: `src/cli.ts`
- Modify: `tests/diff.test.ts`
- Modify: `tests/integration.test.ts`

**Interfaces:**
- Produces: `BASELINE_SCHEMA_VERSION = 2` and `DIFF_SCHEMA_VERSION = 2`
- Produces: `BaselineEntry = { schemaVersion: 2; inputId: string; generatedAt: string; assessmentContractVersion: 2; sourceCommitSha?: string; redactionPolicyFingerprint: string; report: DiagnosisReport }`
- Produces: `redactionPolicyFingerprint(redactPaths: string[]): string`
- Produces: `DefaultGitProvider.resolveRef(repositoryPath: string, ref: string): Promise<string>`
- Produces: `compareDiagnosis(current: DiagnosisReport, baseline: BaselineEntry | null, context: ComparisonContext): ComparisonResult`

- [ ] **Step 1: Add failing comparison contracts**

```ts
expect(unmatched.comparison.compatible).toBe(false);
expect(unmatched.base).toBeUndefined();

const savedEntry = baselineEntrySchema.parse(JSON.parse(await readFile(saved.path, 'utf8')));
expect(matched.base?.metadata.inputId).toBe(savedEntry.report.metadata.inputId);
expect((matched.base?.repository.regressionRiskScore ?? 0) + (matched.comparison.riskDelta ?? 0))
  .toBe(matched.current.repository.regressionRiskScore);

expect(redacted.comparison.newSignals).toEqual([]);
expect(redacted.comparison.improvedSignals).toEqual([]);
```

Also write an old-schema file and assert that Diff returns a reason containing `baseline schema mismatch`, not `no stored baseline`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- tests/comparison.test.ts`

Expected: FAIL with current/base inconsistency, false redaction changes, and silent v1 skipping.

- [ ] **Step 3: Update schemas without compatibility shims**

Set `DIFF_SCHEMA_VERSION = 2`; make `DiffReport.base` optional. Set baseline entry schema to literal version 2 with `sourceCommitSha` and `redactionPolicyFingerprint`. Update fixtures directly to the new first-correct contract.

- [ ] **Step 4: Implement a stable redaction-policy fingerprint**

```ts
export function redactionPolicyFingerprint(redactPaths: string[]): string {
  const normalized = [...new Set(redactPaths)].sort();
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
```

- [ ] **Step 5: Implement commit-bound baseline persistence**

On save, resolve `HEAD` when Git is available, redact a report copy, and store the policy fingerprint. On load for Diff, inspect every JSON candidate: validate schema explicitly, collect mismatch diagnostics, and select the newest entry whose `sourceCommitSha` equals the resolved `--base` SHA. Do not catch and discard Zod or JSON errors.

- [ ] **Step 6: Implement pure comparison**

`compareDiagnosis` receives the raw current report, the matched baseline, current redaction paths/fingerprint, changed files, and blast radius. It returns incompatible with no `base`, delta, or signal changes when no commit match, contract mismatch, or policy mismatch exists. When compatible, compare `redactReport(current, redactPaths)` with `baseline.report` and derive `base`, `baselineId`, `riskDelta`, and all signal changes from that same baseline.

- [ ] **Step 7: Simplify command orchestration**

Remove Git worktree creation and base re-analysis from `runDiffDiagnosis`. Resolve the base SHA, list changed files, load the matching baseline, call `compareDiagnosis`, and validate one Diff Report v2. Keep rendering in Reporting.

- [ ] **Step 8: Run comparison, schema, reporting, and CLI tests**

Run: `npm test -- tests/comparison.test.ts tests/diff.test.ts tests/schema.test.ts tests/integration.test.ts tests/redaction.test.ts`

Expected: all selected tests pass; no unchanged signal appears as both new and improved.

- [ ] **Step 9: Commit**

```bash
git add src/comparison src/persistence/baseline-store.ts src/schema/report.v1.ts src/shared/redaction.ts src/adapters/git-provider.ts src/commands/diff.ts src/reporting src/cli.ts tests
git commit -m "fix: bind diff comparison to persisted base commits"
```

### Task 4: Semantic Injection and Runtime Capabilities

**Files:**
- Modify: `src/semantic/provider.ts`
- Modify: `src/plugins/analyzer.ts`
- Create: `src/assessment/capability.ts`
- Modify: `src/assessment/risk.ts`
- Modify: `tests/phases.test.ts`
- Modify: `tests/assessment.test.ts`
- Modify: `tests/integration.test.ts`

**Interfaces:**
- Consumes: existing `SemanticProviderFactory.create(config): SemanticProviderResolution`
- Produces: `axisHasSupportedSignals(axisId: RiskAxisId, capabilities: CapabilityResult[]): boolean` in `src/assessment/capability.ts`

- [ ] **Step 1: Add failing semantic and non-Git capability tests**

```ts
expect(new DefaultSemanticProviderFactory().create({ enabled: true, provider: 'openai', maxFiles: 1, sendScope: 'all' }))
  .toEqual({ status: 'unavailable', reason: 'LLM provider not implemented: openai' });

const result = negotiateCapabilities(nonGitSnapshot, [new TypeScriptAnalyzerPlugin()]);
expect(result.capabilities[0]?.supportedSignals).not.toContain('git-churn');
expect(report.axes.find((axis) => axis.axisId === 'change-volatility')?.unevaluated).toBe(true);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/phases.test.ts tests/assessment.test.ts`

Expected: FAIL because non-Git TypeScript still advertises `git-churn`; include a compile failure after removing the name-only registry test import if one exists.

- [ ] **Step 3: Remove the name-only semantic registry**

Delete `REGISTERED_PROVIDERS` and `registerSemanticProvider`. Make `DefaultSemanticProviderFactory` return unavailable for every non-`none` configured name. Preserve injected factories in `runSemanticAnalysis`; an injected available factory must return its real provider instance.

- [ ] **Step 4: Make capability negotiation environment-aware**

When building each `CapabilityResult`, filter `git-churn` from supported signals if `snapshot.gitAvailable` is false and include it in unevaluated signals. Move `axisHasSupportedSignals` to `src/assessment/capability.ts` and remove the plugin implementation import from `risk.ts`.

- [ ] **Step 5: Run semantic, capability, scan, and integration tests**

Run: `npm test -- tests/phases.test.ts tests/assessment.test.ts tests/scan.test.ts tests/integration.test.ts`

Expected: all selected tests pass; non-Git volatility is explicitly unevaluated.

- [ ] **Step 6: Commit**

```bash
git add src/semantic/provider.ts src/plugins/analyzer.ts src/assessment/capability.ts src/assessment/risk.ts tests/phases.test.ts tests/assessment.test.ts tests/integration.test.ts
git commit -m "fix: align semantic and capability availability"
```

### Task 5: Policy-Defined Calibration Conditions

**Files:**
- Modify: `src/operations/policy.ts`
- Modify: `src/calibration/dataset.ts`
- Modify: `src/cli.ts`
- Modify: `.reg-score/policy.json`
- Modify: `.reg-score/calibration.json`
- Modify: `tests/calibration.test.ts`
- Modify: `tests/phases.test.ts`

**Interfaces:**
- Produces: `TeamPolicy.requiredCalibrationConditions: string[]`
- Produces: `CalibrationDataset.satisfiedConditions: string[]`
- Produces: `deriveGateEligible(input: GateEligibilityInput, requiredConditions: string[], satisfiedConditions: string[]): boolean`

- [ ] **Step 1: Add failing custom-condition tests**

```ts
expect(deriveGateEligible(qualityInput, ['security-reviewed'], [])).toBe(false);
expect(deriveGateEligible(qualityInput, ['security-reviewed'], ['security-reviewed'])).toBe(true);
expect(() => policySchema.parse({ schemaVersion: 1, requiredCalibrationConditions: [''] })).toThrow();
expect(() => calibrationDatasetSchema.parse({ schemaVersion: 1, records: [], gateConditions: [], satisfiedConditions: ['x', 'x'] })).toThrow();
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/calibration.test.ts tests/phases.test.ts`

Expected: FAIL because the schemas and eligibility function do not accept custom conditions.

- [ ] **Step 3: Add strict condition schemas and evaluation**

Use `z.array(z.string().trim().min(1)).refine(values => new Set(values).size === values.length, 'conditions must be unique')`. Default policy requirements and satisfied calibration conditions to empty arrays only in newly generated config; update committed data files explicitly.

- [ ] **Step 4: Pass policy requirements into calibration loading**

Change `loadCalibration(repositoryPath, goldenRegressionPassed, requiredConditions)` and call it from `policy --evaluate`. Eligibility requires every required value to be present in `satisfiedConditions` in addition to all existing quality gates.

- [ ] **Step 5: Run policy and calibration tests**

Run: `npm test -- tests/calibration.test.ts tests/phases.test.ts tests/integration.test.ts`

Expected: all selected tests pass, including missing and satisfied custom conditions.

- [ ] **Step 6: Commit**

```bash
git add src/operations/policy.ts src/calibration/dataset.ts src/cli.ts .reg-score/policy.json .reg-score/calibration.json tests/calibration.test.ts tests/phases.test.ts tests/integration.test.ts
git commit -m "feat: enforce policy-defined calibration conditions"
```

### Task 6: Persistence Boundary Cleanup and Complete Verification

**Files:**
- Create: `src/persistence/trend-store.ts`
- Modify: `src/pipeline/diagnose.ts`
- Modify: `src/cli.ts`
- Modify: `tests/integration.test.ts`
- Modify: `docs/verification/ROADMAP-TRACEABILITY.md`

**Interfaces:**
- Consumes: `PersistenceResult = { path: string; retention: RetentionAudit[] }` from Task 2
- Preserves: `saveBaseline(...): Promise<PersistenceResult>`
- Preserves: `appendTrend(...): Promise<PersistenceResult>`

- [ ] **Step 1: Add a failing boundary test for structured retention results**

```ts
const result = await appendTrend(snapshot, report);
expect(result.path).toBe(path.join(repositoryPath, '.reg-score/trends/history.jsonl'));
expect(result.retention).toEqual(expect.arrayContaining([
  expect.objectContaining({ storage: 'trend', reason: 'expired' }),
]));
```

- [ ] **Step 2: Run the focused integration test and verify RED**

Run: `npm test -- tests/integration.test.ts`

Expected: FAIL because persistence operations do not yet return structured results.

- [ ] **Step 3: Move trend and baseline I/O out of the diagnosis pipeline**

Move trend file read/write and append behavior to `src/persistence/trend-store.ts`; keep baseline behavior in `src/persistence/baseline-store.ts`. Update every caller to import persistence operations from their owning modules; do not retain compatibility re-exports. `pipeline/diagnose.ts` retains only `runDiagnosis`. CLI formats each `RetentionAudit` to stderr as `retention storage=<storage> reason=<reason> removed=<count>`.

- [ ] **Step 4: Update traceability documentation**

Record the exact focused tests for physical storage containment, commit-bound comparison, redaction comparison, semantic injection, runtime capability, custom calibration conditions, and shallow-checkout independence.

- [ ] **Step 5: Run all verification commands**

```bash
npm run validate
npm pack --dry-run --cache /tmp/reg-score-npm-cache
git diff --check main...HEAD
```

Expected: exit 0; governance 44/44, all Vitest tests pass, typecheck and build pass, package contents are listed, and no whitespace errors are reported.

- [ ] **Step 6: Verify a depth-1 checkout**

Create a local `file://` shallow clone of the branch into a temporary directory, install using the existing lockfile, and run `npm run validate`. Expected: exit 0 without `HEAD~1` errors.

```bash
shallow_dir="$(mktemp -d /tmp/reg-score-shallow.XXXXXX)"
git clone --depth 1 --branch fix/pr2-review-followups file:///Users/kaz/product/zoe/reg-score "$shallow_dir"
cd "$shallow_dir"
npm ci
npm run validate
```

- [ ] **Step 7: Run CLI smoke cases**

Run baseline-free, matching-baseline, mismatched-commit, and redaction-enabled `reg-score diff` cases in temporary two-commit repositories. Assert exit 0, schema version 2, and absence of contradictory signal changes. Re-run the symlink fixture and assert its outside victim file remains present.

- [ ] **Step 8: Commit**

```bash
git add src/persistence src/pipeline/diagnose.ts src/cli.ts tests/integration.test.ts docs/verification/ROADMAP-TRACEABILITY.md
git commit -m "refactor: isolate persistence orchestration"
```

- [ ] **Step 9: Push and open the pull request**

```bash
git push -u origin fix/pr2-review-followups
gh pr create --base main --head fix/pr2-review-followups --title "PR #2 review follow-ups" --body $'## Summary\n\n- enforce physical persistence boundaries and entry-level retention\n- bind diff comparison to commit-matched, redaction-compatible baselines\n- make semantic, capability, calibration, and Git tests report actual availability\n\n## Verification\n\n- npm run validate\n- depth-1 checkout: npm run validate\n- npm pack --dry-run\n- CLI diff and symlink safety smoke tests'
gh pr checks --watch
```

The PR body must list the RED/GREEN evidence, local depth-1 validation, CLI smoke results, package dry-run, and any check still pending. Do not describe the PR as complete while a required check is failing.
