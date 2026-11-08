// G14 client helpers (receipt parser, memory game, optimizer, countdown…).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, flip, settle, elapsedSeconds, FACES } from './memoryGame.ts';
import { demoOptimize, demoPulse, freeShippingProgress, countdown, freshness, cartNutrition, cleanVoiceQuery, localPriceStats } from './smart.ts';
import { products } from '../data/products.ts';

test('F-G14-25 لعبة الذاكرة: مطابقة وإغلاق وفوز', () => {
  let g = newGame(42);
  assert.equal(g.cards.length, 12);
  const pairs = FACES.map((f) => g.cards.map((c, i) => (c.face === f ? i : -1)).filter((i) => i >= 0));
  // wrong pair locks, settle closes
  const wrongB = pairs[1][0];
  g = flip(g, pairs[0][0], 1000); g = flip(g, wrongB, 1500);
  assert.equal(g.locked, true); assert.equal(flip(g, pairs[2][0]), g, 'locked board ignores taps');
  g = settle(g); assert.equal(g.cards.filter((c) => c.open).length, 0);
  let t = 2000;
  for (const [a, b] of pairs) { g = flip(g, a, t); g = flip(g, b, t += 1000); }
  assert.equal(g.matches, 6); assert.ok(g.finishedAt); assert.equal(g.moves, 7);
  assert.equal(elapsedSeconds(g), 7);
});

test('F-G14-05 محسّن السلة التجريبي يقترح بديلًا أرخص من نفس القسم', () => {
  const expensive = [...products].sort((a, b) => b.price - a.price)[0];
  const r = demoOptimize(products, { [expensive.id]: 1 }, 'cheapest', 30, 2.5);
  assert.equal(r.demo, true);
  if (r.alternatives.length) { assert.ok(r.alternatives[0].replaceWith.price <= expensive.price * 0.95); assert.equal(r.optimizedSubtotal, Math.round((expensive.price - r.alternatives[0].saving) * 1000) / 1000); }
  assert.equal(demoOptimize(products, { [expensive.id]: 1 }, 'fastest', 30, 2.5).alternatives.length, 0);
  assert.ok(demoPulse(products).categories.length >= 1);
});

test('F-G14-27/30/41 العدّ التنازلي والطزاجة وتقدم التوصيل المجاني وتغذية السلة', () => {
  assert.equal(countdown('2026-01-01T01:02:03Z', Date.parse('2026-01-01T00:00:00Z')), '01:02:03');
  assert.equal(countdown('2026-01-03T01:00:00Z', Date.parse('2026-01-01T00:00:00Z')), '2 يوم 01:00');
  assert.equal(countdown('2020-01-01T00:00:00Z'), null);
  assert.equal(freshness('2026-01-05T00:00:00Z', Date.parse('2026-01-01T00:00:00Z')).state, 'soon');
  assert.equal(freshness('2025-12-01T00:00:00Z', Date.parse('2026-01-01T00:00:00Z')).state, 'expired');
  assert.deepEqual(freeShippingProgress(20, 30), { progress: 2 / 3, remaining: 10, qualified: false });
  assert.equal(freeShippingProgress(35, 30).qualified, true);
  const withN = [{ ...products[0], nutrition: { calories: 100, protein: 2 } }];
  assert.equal(cartNutrition(withN, { [products[0].id]: 3 }).total.calories, 300);
  assert.equal(cleanVoiceQuery('ابحث عن سماعات لاسلكية؟'), 'سماعات لاسلكية');
  assert.equal(localPriceStats([{ price: 10, at: 'a' }], 8).advice.includes('الأدنى'), true);
});
