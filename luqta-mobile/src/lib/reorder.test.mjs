import { strict as assert } from "node:assert";
import { test } from "node:test";
import { cartLimit, cartSubtotal, reorderCart } from "./reorder.ts";

test("reordering uses current prices and stock, skipping removed products and parents with SKUs", () => {
  const products = [
    { id: "a", price: 12.5, stock: 2, active: true },
    { id: "b", price: 4, stock: 0, active: true },
    { id: "c", price: 7, stock: 10, active: false },
    { id: "parent", price: 5, stock: 9, active: true, hasVariants: true },
  ];
  const historicalItems = [
    { productId: "a", name: "A", price: 9, quantity: 4 },
    { productId: "b", name: "B", price: 4, quantity: 1 },
    { productId: "c", name: "C", price: 7, quantity: 1 },
    { productId: "parent", name: "Parent", price: 5, quantity: 1 },
    { productId: "removed", name: "Removed", price: 1, quantity: 1 },
  ];
  const cart = reorderCart(historicalItems, products);
  assert.deepEqual(cart, { a: 2 });
  assert.equal(cartSubtotal(cart, products), 25);
  assert.notEqual(cartSubtotal(cart, products), historicalItems[0].price * cart.a);
});

test("reordering coalesces duplicate entries and rejects invalid quantities", () => {
  const products = [{ id: "a", price: 5, stock: 3 }];
  assert.deepEqual(reorderCart([
    { productId: "a", name: "A", price: 5, quantity: 2 },
    { productId: "a", name: "A", price: 5, quantity: 2 },
    { productId: "a", name: "A", price: 5, quantity: -1 },
  ], products), { a: 3 });
  assert.equal(cartLimit(products, "unknown"), 0);
});
