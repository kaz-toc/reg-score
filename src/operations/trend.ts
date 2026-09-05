import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { DiagnosisReport, Intervention, TrendEntry } from '../schema/report.v1.js';
import { trendEntrySchema } from '../schema/report.v1.js';
import { RegScoreError } from '../shared/errors.js';

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
  let raw: string;
  try {
    const historyStat = await lstat(trendPath);
    if (historyStat.isSymbolicLink()) {
      throw new RegScoreError(`refusing to read trend history through symbolic link: ${trendPath}`);
    }
    raw = await readFile(trendPath, 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const entries: TrendEntry[] = [];
  const lines = raw.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    try {
      entries.push(trendEntrySchema.parse(JSON.parse(line)));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new RegScoreError(`trend history parse error at line ${index + 1}: ${reason}`);
    }
  }
  return entries;
}

export function analyzeTrend(entries: TrendEntry[]): TrendAnalysis {
  if (entries.length === 0) {
    return { entries: [], scoreDeltaFromFirst: 0, contributingClusterIds: [], contributingChanges: [] };
  }

  const contractVersions = new Set(entries.map((entry) => entry.contractVersion));
  if (contractVersions.size > 1) {
    throw new RegScoreError('trend entries span multiple assessment contract versions');
  }

  const sorted = [...entries].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) {
    return { entries: sorted, scoreDeltaFromFirst: 0, contributingClusterIds: [], contributingChanges: [] };
  }

  const scoreDeltaFromFirst = last.score - first.score;

  let degradationStartAt: string | undefined;
  if (sorted.length >= 2 && last.score > first.score) {
    let startIdx = sorted.length - 1;
    for (let index = 0; index < sorted.length; index += 1) {
      const entry = sorted[index];
      if (!entry) {
        continue;
      }
      const maxFromIndex = Math.max(...sorted.slice(index).map((item) => item.score));
      if (entry.score < last.score && maxFromIndex > entry.score) {
        startIdx = Math.min(startIdx, index);
      }
    }
    degradationStartAt = sorted[startIdx]?.generatedAt;
  }

  const startEntry = degradationStartAt ? sorted.find((entry) => entry.generatedAt === degradationStartAt) : undefined;
  const startClusters = new Map((startEntry?.topClusters ?? []).map((cluster) => [cluster.clusterId, cluster.score]));
  const contributingClusterIds = last.topClusters
    .filter((cluster) => (startClusters.get(cluster.clusterId) ?? 0) < cluster.score)
    .map((cluster) => cluster.clusterId);

  const contributingChanges: ContributingChange[] = degradationStartAt
    ? sorted
        .filter((entry) => entry.generatedAt > degradationStartAt)
        .filter((entry, idx, arr) => idx === 0 || entry.score > (arr[idx - 1]?.score ?? entry.score))
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
