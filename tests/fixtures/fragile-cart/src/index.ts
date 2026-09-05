import { addItem } from './cart.js';
import { applyDiscount } from './pricing.js';
import { notify } from './notifications.js';

export function checkout(items: Parameters<typeof addItem>[0]) {
  const total = applyDiscount(items);
  notify(`checkout:${total}`);
  return total;
}

export * from './cart.js';
export * from './pricing.js';
