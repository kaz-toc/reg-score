import { describe, expect, it } from 'vitest';

import { applyDiscount } from '../pricing.js';

describe('pricing', () => {
  it('applies discount', () => {
    expect(applyDiscount([{ sku: 'a', quantity: 2 }])).toBe(20);
  });
});
