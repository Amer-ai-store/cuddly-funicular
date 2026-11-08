import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parsePriceLimit, searchCatalog } from "./catalog-search.ts";

const products = [
  { id: "lamp", name: "مصباح إضاءة", category: "home", price: 25.5, rating: 4.2, reviews: 30, stock: 2, active: true, tags: ["غرفة"], subtitle: "", brand: "A", description: "", features: [], colors: [] },
  { id: "headphones", name: "سماعات لاسلكية", category: "electronics", price: 70, rating: 4.9, reviews: 45, stock: 0, active: true, tags: ["صوت"], subtitle: "", brand: "B", description: "", features: [], colors: [] },
  { id: "speaker", name: "مكبر صوت", category: "electronics", price: 40, rating: 4.9, reviews: 12, stock: 5, active: true, tags: ["موسيقى"], subtitle: "", brand: "C", description: "", features: [], colors: [] },
  { id: "lamp-blue", name: "مصباح إضاءة", variantOf: "lamp", variantLabel: "أزرق", category: "home", price: 25.5, rating: 0, reviews: 0, stock: 2, active: true, tags: [], subtitle: "", brand: "A", description: "", features: [], colors: [] },
  { id: "hidden", name: "مصباح مخفي", category: "home", price: 5, rating: 5, reviews: 100, stock: 9, active: false, tags: [], subtitle: "", brand: "E", description: "", features: [], colors: [] },
];
const defaults = { query: "", category: "all", inStockOnly: false, sort: "featured" };
const ids = (filters) => searchCatalog(products, { ...defaults, ...filters }).map((product) => product.id);

test("Arabic query, category, stock and hidden SKU filtering combine", () => {
  assert.deepEqual(ids({ query: "إِضاءة" }), ["lamp"]);
  assert.deepEqual(ids({ category: "electronics", inStockOnly: true }), ["speaker"]);
  assert.deepEqual(ids({ query: "مكبر", category: "home" }), []);
});

test("price bounds and all sort orders use current prices", () => {
  assert.deepEqual(ids({ maxPrice: 40 }), ["lamp", "speaker"]);
  assert.deepEqual(ids({ sort: "low" }), ["lamp", "speaker", "headphones"]);
  assert.deepEqual(ids({ sort: "high" }), ["headphones", "speaker", "lamp"]);
  assert.deepEqual(ids({ sort: "rating" }), ["headphones", "speaker", "lamp"]);
});

test("custom JOD limit accepts Arabic and Persian digits to three decimals", () => {
  assert.equal(parsePriceLimit("٢٥٫٥٠٠"), 25.5);
  assert.equal(parsePriceLimit("۴۰,۰۰۰"), 40);
  for (const bad of ["", "0", "-5", "1.2345", "Infinity"]) assert.equal(parsePriceLimit(bad), undefined);
});
