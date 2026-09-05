export type CartItem = { sku: string; quantity: number };

export function addItem(items: CartItem[], item: CartItem): CartItem[] {
  return [...items, item];
}
