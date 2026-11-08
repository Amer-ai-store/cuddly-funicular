// WP-13 client fallback: Arabic list → real catalog products; unknown items never invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileIntent, splitList, parseLine, budgetFrom } from './intent.ts';

const catalog = [
  { id: 'rice', name: 'أرز بسمتي', category: 'grocery', price: 3.25, tags: ['رز', 'ارز'], stock: 40 },
  { id: 'milk', name: 'حليب طويل الأمد', category: 'grocery', price: 2.2, tags: ['حليب'], stock: 60 },
  { id: 'sugar', name: 'سكر', category: 'grocery', price: 1, tags: [], stock: 0 },
];
test('WP-13 list-to-cart parsing and matching (client fallback)', () => {
  assert.deepEqual(splitList('٢ حليب، رز\nسكر و زيت'), ['2 حليب', 'رز', 'سكر', 'زيت']);
  assert.equal(parseLine('ثلاث علب حليب').quantity, 3);
  assert.equal(budgetFrom('فطور تحت ٢٠ دينار'), 20);
  const r = compileIntent('٢ حليب، رز، سكر، كافيار\nتحت 20 دينار', catalog);
  const by = Object.fromEntries(r.items.map((i) => [i.query, i]));
  assert.equal(by['حليب'].productId, 'milk'); assert.equal(by['حليب'].quantity, 2);
  assert.equal(by['رز'].productId, 'rice');
  assert.equal(by['سكر'].status, 'out_of_stock');
  assert.equal(by['كافيار'].status, 'not_found'); assert.equal(by['كافيار'].productId, undefined);
  assert.equal(r.total, 7.65); assert.equal(r.withinBudget, true);
});
