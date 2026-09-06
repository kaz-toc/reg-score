import type { RepositorySnapshot } from '../intake/snapshot.js';
import type { Evidence } from '../schema/report.v1.js';

export type ContextPacket = Readonly<{
  prompt: string;
  includedFilePaths: readonly string[];
  omittedFileCount: number;
}>;

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export function buildContextPacket(
  snapshot: RepositorySnapshot,
  evidence: Evidence[],
  maxPromptBytes: number,
): ContextPacket {
  const sections: string[] = [];
  const includedFilePaths: string[] = [];
  let usedBytes = 0;
  let omittedFileCount = 0;

  const evidenceSummary = [
    'Evidence summary:',
    ...evidence.map(
      (item) =>
        `- ${item.evidenceId} ${item.signalId} ${item.severity} ${item.path ?? '(no path)'}: ${item.message}`,
    ),
  ].join('\n');
  sections.push(evidenceSummary);
  usedBytes += utf8Bytes(evidenceSummary);

  for (const file of snapshot.files) {
    const header = `\nFile: ${file.relativePath} (${file.nonBlankLines} non-blank lines)\n`;
    const body = file.content.length > 0 ? file.content : '(empty file)\n';
    const section = `${header}${body}`;
    const sectionBytes = utf8Bytes(section);
    if (usedBytes + sectionBytes > maxPromptBytes) {
      omittedFileCount += 1;
      continue;
    }
    sections.push(section);
    includedFilePaths.push(file.relativePath);
    usedBytes += sectionBytes;
  }

  if (omittedFileCount > 0) {
    sections.push(`\n[omitted ${omittedFileCount} file(s) due to prompt byte budget ${maxPromptBytes}]`);
  }

  return {
    prompt: sections.join(''),
    includedFilePaths,
    omittedFileCount,
  };
}
