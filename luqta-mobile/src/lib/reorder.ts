import type { Product } from "../data/products.ts";
import type { CommerceOrder } from "./commerce-types.ts";

type CatalogItem = Pick<Product, "id" | "price" | "stock" | "active"> & { hasVariants?: boolean };

export function cartLimit(products: CatalogItem[], id: string): number {
  const product = products.find((item) => item.id === id && item.active !== false);
  if (!product || product.hasVariants) return 0;
  const stock = product.stock === undefined ? 10 : product.stock;
  return Number.isFinite(stock) ? Math.max(0, Math.min(99, Math.floor(stock))) : 0;
}

export function reorderCart(items: CommerceOrder["items"], products: CatalogItem[]): Record<string, number> {
  const cart: Record<string, number> = {};
  for (const item of items) {
    if (!item.productId || !Number.isInteger(item.quantity) || item.quantity <= 0) continue;
    const maximum = cartLimit(products, item.productId);
    if (maximum > 0) cart[item.productId] = Math.min(maximum, (cart[item.productId] || 0) + item.quantity);
  }
  return cart;
}

export function cartSubtotal(cart: Record<string, number>, products: CatalogItem[]): number {
  return products.reduce((sum, product) => sum + product.price * (cart[product.id] || 0), 0);
}
