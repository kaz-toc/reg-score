import { describe, expect, it } from 'vitest';

import { parseSemanticResponse } from '../../src/semantic/semantic-response.js';

describe('parseSemanticResponse', () => {
  it('parses a bare JSON array', () => {
    const raw = parseSemanticResponse('[{"axisId":"semantic-ambiguity","summary":"x","confidence":0.5}]');
    expect(raw).toEqual([{ axisId: 'semantic-ambiguity', summary: 'x', confidence: 0.5 }]);
  });

  it('parses a fenced JSON array', () => {
    const raw = parseSemanticResponse('```json\n[{"axisId":"semantic-ambiguity","summary":"x","confidence":0.5}]\n```');
    expect(Array.isArray(raw)).toBe(true);
  });

  it('throws when no JSON array is present', () => {
    expect(() => parseSemanticResponse('not json')).toThrow(/JSON array/);
  });
});
