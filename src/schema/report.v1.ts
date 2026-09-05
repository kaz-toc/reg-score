import { z } from 'zod';

export const ASSESSMENT_CONTRACT_VERSION = 1;
export const REPORT_SCHEMA_VERSION = 1;

export const riskAxisIdSchema = z.enum([
  'structural-fragility',
  'change-blast-radius',
  'verification-gap',
  'change-volatility',
  'semantic-ambiguity',
]);

export const evidenceSchema = z
  .object({
    evidenceId: z.string(),
    signalId: z.string(),
    axisId: riskAxisIdSchema,
    path: z.string().optional(),
    severity: z.enum(['low', 'medium', 'high']),
    message: z.string(),
    metrics: z.record(z.union([z.number(), z.string(), z.boolean()])).optional(),
    source: z.enum(['deterministic', 'semantic']),
  })
  .strict();

export const semanticFindingSchema = z
  .object({
    findingId: z.string(),
    axisId: riskAxisIdSchema,
    path: z.string().optional(),
    summary: z.string(),
    relatedEvidenceIds: z.array(z.string()),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const riskClusterSchema = z
  .object({
    clusterId: z.string(),
    title: z.string(),
    score: z.number().min(0).max(100),
    confidence: z.number().min(0).max(1),
    axisId: riskAxisIdSchema,
    paths: z.array(z.string()),
    failureMechanism: z.string(),
    triggerChanges: z.array(z.string()),
    evidenceIds: z.array(z.string()),
  })
  .strict();

export const axisAssessmentSchema = z
  .object({
    axisId: riskAxisIdSchema,
    name: z.string(),
    score: z.number().min(0).max(100),
    contribution: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    unevaluated: z.boolean().default(false),
  })
  .strict();

export const interventionSchema = z
  .object({
    interventionId: z.string(),
    priority: z.number().int().positive(),
    title: z.string(),
    description: z.string(),
    kind: z.enum(['test', 'structure', 'process']),
    targetPaths: z.array(z.string()),
    linkedSignalIds: z.array(z.string()),
    linkedClusterIds: z.array(z.string()),
    expectedEffect: z.string(),
    verification: z.string(),
    cost: z.enum(['low', 'medium', 'high']),
  })
  .strict();

export const repositoryAssessmentSchema = z
  .object({
    regressionRiskScore: z.number().min(0).max(100),
    confidence: z.number().min(0).max(1),
    riskDelta: z.number().optional(),
    baselineId: z.string().optional(),
    disclaimer: z.string(),
  })
  .strict();

export const reportMetadataSchema = z
  .object({
    schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
    assessmentContractVersion: z.literal(ASSESSMENT_CONTRACT_VERSION),
    generatedAt: z.string(),
    inputId: z.string(),
    repositoryPath: z.string(),
    analyzers: z.array(z.string()),
    llmProvider: z.string().optional(),
    truncated: z.boolean(),
    unevaluatedAreas: z.array(z.string()),
  })
  .strict();

export const diagnosisReportSchema = z
  .object({
    metadata: reportMetadataSchema,
    repository: repositoryAssessmentSchema,
    axes: z.array(axisAssessmentSchema),
    clusters: z.array(riskClusterSchema),
    evidence: z.array(evidenceSchema),
    semanticFindings: z.array(semanticFindingSchema),
    interventions: z.array(interventionSchema),
  })
  .strict();

export type RiskAxisId = z.infer<typeof riskAxisIdSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type SemanticFinding = z.infer<typeof semanticFindingSchema>;
export type RiskCluster = z.infer<typeof riskClusterSchema>;
export type AxisAssessment = z.infer<typeof axisAssessmentSchema>;
export type Intervention = z.infer<typeof interventionSchema>;
export type RepositoryAssessment = z.infer<typeof repositoryAssessmentSchema>;
export type DiagnosisReport = z.infer<typeof diagnosisReportSchema>;

export const SCORE_DISCLAIMER =
  'Regression Risk Score は将来のデグレ発生確率を保証しません。根拠と確信度とともに優先順位付けに使用してください。';
