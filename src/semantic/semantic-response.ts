function balancedArrayCandidates(text: string): string[] {
  const candidates: Array<{ start: number; value: string }> = [];
  const starts: number[] = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (starts.length === 0) {
      inString = false;
      escaped = false;
      if (character === '[') starts.push(index);
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '[') starts.push(index);
    else if (character === ']') {
      const start = starts.pop();
      if (start !== undefined) candidates.push({ start, value: text.slice(start, index + 1) });
    }
  }

  return candidates
    .sort((a, b) => a.start - b.start || b.value.length - a.value.length)
    .map((candidate) => candidate.value);
}

function jsonArrayCandidates(responseText: string): string[] {
  const candidates: string[] = [];
  const jsonFence = /```[ \t]*json[ \t]*\r?\n([\s\S]*?)```/giu;
  for (const match of responseText.matchAll(jsonFence)) {
    if (match[1]) {
      candidates.push(match[1].trim());
      candidates.push(...balancedArrayCandidates(match[1]));
    }
  }
  candidates.push(...balancedArrayCandidates(responseText));
  return [...new Set(candidates)];
}

export function parseSemanticResponse(responseText: string): unknown {
  for (const candidate of jsonArrayCandidates(responseText)) {
    try {
      const raw = JSON.parse(candidate) as unknown;
      if (Array.isArray(raw)) return raw;
    } catch {
      continue;
    }
  }
  throw new Error('semantic response did not contain a JSON array');
}
