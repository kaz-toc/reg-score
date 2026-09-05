import { checkout } from './index.js';
import type { CartItem } from './cart.js';

export function applyDiscount(items: CartItem[]): number {
  void checkout;
  return items.length * 10;
}
