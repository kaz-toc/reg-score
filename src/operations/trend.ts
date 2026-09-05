import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { DiagnosisReport, Intervention } from '../schema/report.v1.js';

export type TrendEntry = {
  generatedAt: string;
  inputId: string;
  score: number;
  confidence: number;
  contractVersion: number;
  commitSha?: string;
  changedFiles?: string[];
  topClusters: Array<{ clusterId: string; score: number }>;
};

export type ContributingChange = {
  generatedAt: string;
  commitSha?: string;
  score: number;
  changedFiles: string[];
};

export type TrendAnalysis = {
  entries: TrendEntry[];
  degradationStartAt?: string;
  scoreDeltaFromFirst: number;
  contributingClusterIds: string[];
  contributingChanges: ContributingChange[];
};

const COST_WEIGHT = { low: 1, medium: 2, high: 3 } as const;

export type InvestmentPriority = {
  intervention: Intervention;
  urgency: number;
  rationale: string;
};

export function rankInvestmentPriorities(report: DiagnosisReport): InvestmentPriority[] {
  return report.interventions
    .map((intervention) => {
      const linkedClusters = report.clusters.filter((cluster) =>
        intervention.linkedClusterIds.includes(cluster.clusterId),
      );
      const clusterScore = linkedClusters.length > 0 ? Math.max(...linkedClusters.map((c) => c.score)) : 0;
      const urgency = clusterScore / COST_WEIGHT[intervention.cost];
      return {
        intervention,
        urgency: Number(urgency.toFixed(2)),
        rationale: `clusterScore=${clusterScore}, cost=${intervention.cost}`,
      };
    })
    .sort((a, b) => b.urgency - a.urgency);
}

export async function loadTrendHistory(trendPath: string): Promise<TrendEntry[]> {
  try {
    const raw = await readFile(trendPath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TrendEntry);
  } catch {
    return [];
  }
}

export function analyzeTrend(entries: TrendEntry[]): TrendAnalysis {
  if (entries.length === 0) {
    return { entries: [], scoreDeltaFromFirst: 0, contributingClusterIds: [], contributingChanges: [] };
  }

  const sorted = [...entries].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) {
    return { entries: sorted, scoreDeltaFromFirst: 0, contributingClusterIds: [], contributingChanges: [] };
  }

  const scoreDeltaFromFirst = last.score - first.score;

  let degradationStartAt: string | undefined;
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = sorted[index - 1];
    if (current && previous && current.score > previous.score) {
      degradationStartAt = current.generatedAt;
      break;
    }
  }

  const contributingClusterIds = [
    ...new Set(last.topClusters.filter((cluster) => cluster.score >= 50).map((cluster) => cluster.clusterId)),
  ];

  const contributingChanges: ContributingChange[] = degradationStartAt
    ? sorted
        .filter((entry) => entry.generatedAt >= degradationStartAt)
        .map((entry) => ({
          generatedAt: entry.generatedAt,
          commitSha: entry.commitSha,
          score: entry.score,
          changedFiles: entry.changedFiles ?? [],
        }))
    : [];

  return {
    entries: sorted,
    degradationStartAt,
    scoreDeltaFromFirst,
    contributingClusterIds,
    contributingChanges,
  };
}

export function trendPathFor(repositoryPath: string, trendDir: string): string {
  return path.join(repositoryPath, trendDir, 'history.jsonl');
}
