import type { DiagnosisReport } from '../schema/report.v1.js';
import { diagnosisReportSchema } from '../schema/report.v1.js';
import type { RepositorySnapshot } from '../intake/snapshot.js';
import { assessRisk } from '../assessment/risk.js';
import { buildInterventions } from '../recommendation/rules.js';
import { getDefaultPlugins, extractEvidenceWithPlugins, selectPlugins } from '../plugins/analyzer.js';
import { runSemanticAnalysis } from '../semantic/provider.js';

export async function runDiagnosis(snapshot: RepositorySnapshot): Promise<DiagnosisReport> {
  const plugins = getDefaultPlugins();
  const selected = selectPlugins(snapshot, plugins);
  const { evidence, analyzerIds, capabilities } = await extractEvidenceWithPlugins(snapshot, plugins);
  const { findings: semanticFindings, resolution: semanticResolution } = await runSemanticAnalysis(snapshot, evidence);

  const report = assessRisk({
    snapshot,
    evidence,
    semanticFindings,
    capabilities,
    analyzers: analyzerIds,
    selectedAnalyzers: selected.length,
    successfulAnalyzers: selected.length,
    semanticResolution,
    llmProvider: snapshot.config.llm.enabled ? snapshot.config.llm.provider : 'none',
  });

  report.interventions = buildInterventions(report.evidence, report.clusters);
  return diagnosisReportSchema.parse(report);
}
