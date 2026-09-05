import type { DiagnosisReport } from '../schema/report.v1.js';
import { formatConsoleReport, formatJsonReport, formatMarkdownReport } from '../reporting/format.js';

export type ReportFormat = 'json' | 'markdown' | 'console';

export type ReporterAdapter = {
  format(report: DiagnosisReport, format: ReportFormat): string;
};

export class DefaultReporterAdapter implements ReporterAdapter {
  format(report: DiagnosisReport, format: ReportFormat): string {
    switch (format) {
      case 'json':
        return formatJsonReport(report);
      case 'markdown':
        return formatMarkdownReport(report);
      case 'console':
        return formatConsoleReport(report);
    }
  }
}
