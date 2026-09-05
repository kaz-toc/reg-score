import { addItem, totalQuantity, type CartItem } from './cart.js';
import { applyDiscount } from './pricing.js';
import { notify } from './notifications.js';

export function checkout(items: CartItem[]) {
  const total = applyDiscount(items);
  notify(`checkout:${total}`);
  return total;
}

export function cartSummary(items: CartItem[]): string {
  return `items=${totalQuantity(items)} total=${applyDiscount(items)}`;
}
