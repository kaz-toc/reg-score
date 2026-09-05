import { describe, expect, it } from 'vitest';

import { addItem, totalQuantity } from '../cart.js';

describe('cart', () => {
  it('adds items', () => {
    const items = addItem([], { sku: 'a', quantity: 2 });
    expect(totalQuantity(items)).toBe(2);
  });
});
