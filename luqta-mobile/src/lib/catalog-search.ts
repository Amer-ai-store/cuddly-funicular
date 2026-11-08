import type { Product } from "../data/products.ts";
import { filterProducts } from "./recommendations.ts";

export type CatalogSort = "featured" | "low" | "high" | "rating";
export type CatalogFilters = {
  query: string;
  category: string;
  maxPrice?: number;
  inStockOnly: boolean;
  sort: CatalogSort;
};

export function parsePriceLimit(input: string): number | undefined {
  const normalized = input.trim()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, ".");
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) return undefined;
  const amount = Number(normalized);
  return amount > 0 && Number.isFinite(amount) ? amount : undefined;
}

export function searchCatalog(products: Product[], filters: CatalogFilters): Product[] {
  const matches = filterProducts(filters.query, products)
    .filter((product) => product.active !== false && !product.variantOf)
    .filter((product) => filters.category === "all" || product.category === filters.category)
    .filter((product) => filters.maxPrice === undefined || product.price <= filters.maxPrice)
    .filter((product) => !filters.inStockOnly || product.stock === undefined || product.stock > 0);
  if (filters.sort === "featured") return matches;
  const sorted = [...matches];
  if (filters.sort === "low") sorted.sort((a, b) => a.price - b.price);
  if (filters.sort === "high") sorted.sort((a, b) => b.price - a.price);
  if (filters.sort === "rating") sorted.sort((a, b) => b.rating - a.rating || b.reviews - a.reviews);
  return sorted;
}
