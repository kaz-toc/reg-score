// Stable cart module — low regression risk fixture
export type CartItem = { sku: string; quantity: number };

export function addItem(items: CartItem[], item: CartItem): CartItem[] {
  const existing = items.find((entry) => entry.sku === item.sku);
  if (!existing) {
    return [...items, item];
  }
  return items.map((entry) =>
    entry.sku === item.sku ? { ...entry, quantity: entry.quantity + item.quantity } : entry,
  );
}

export function totalQuantity(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}
