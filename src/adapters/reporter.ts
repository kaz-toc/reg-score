import type { DiagnosisReport, DiffReport } from '../schema/report.v1.js';
import { formatDiffReport, formatReport } from '../reporting/format.js';
import { formatGitHubAnnotations } from '../reporting/github.js';

export type ReportFormat = 'json' | 'markdown' | 'console';

export type ReporterAdapter = {
  format(report: DiagnosisReport, format: ReportFormat): string;
  formatDiff(diff: DiffReport, format: ReportFormat): string;
  formatGitHubAnnotations(diff: DiffReport): string;
};

export class DefaultReporterAdapter implements ReporterAdapter {
  format(report: DiagnosisReport, format: ReportFormat): string {
    return formatReport(report, format);
  }

  formatDiff(diff: DiffReport, format: ReportFormat): string {
    return formatDiffReport(diff, format);
  }

  formatGitHubAnnotations(diff: DiffReport): string {
    return formatGitHubAnnotations(diff);
  }
}

export { formatReport, formatDiffReport };
