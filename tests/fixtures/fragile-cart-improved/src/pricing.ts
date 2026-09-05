import type { CartItem } from './cart.js';

export function applyDiscount(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0) * 10;
}
