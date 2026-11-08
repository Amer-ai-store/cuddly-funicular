import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildBasket, parseBasketRequest } from "./basket.ts";

const p = (id, name, price, category, stock, tags = []) => ({ id, name, price, category, stock, tags, subtitle: "", brand: "", rating: 0, reviews: 0, image: "", description: "", features: [], colors: [], active: true });
const catalogue = [p("rice", "أرز بسمتي", 3.25, "grocery", 40, ["أرز"]), p("milk", "حليب طويل الأمد", 2.2, "grocery", 60, ["حليب"]), p("banana", "موز", 1.75, "grocery", 2, ["موز"]), p("headphones", "سماعات", 12.5, "electronics", 8), p("oos", "سكر", 1, "grocery", 0, ["سكر"])];

test("F-G06-03 parses Arabic basket requests with Arabic or Latin digits", () => {
  assert.deepEqual(parseBasketRequest("جهز لي سلة بـ 20 دينار"), { budget: 20 });
  assert.deepEqual(parseBasketRequest("جهّز لي سلة بـ ٢٠ دينار"), { budget: 20 });
  assert.equal(parseBasketRequest("سماعات لاسلكية"), null);
});

test("F-G06-04 basket stays within budget, prefers essentials, respects stock and skips out-of-stock", () => {
  const r = buildBasket(20, catalogue);
  assert.ok(r.total <= 20);
  assert.ok(r.lines.length >= 3);
  assert.ok(!r.lines.some((l) => l.productId === "headphones"), "non-essentials excluded while essentials exist");
  assert.ok(!r.lines.some((l) => l.productId === "oos"));
  assert.ok((r.lines.find((l) => l.productId === "banana")?.quantity || 0) <= 2, "never exceeds stock");
  assert.equal(Math.round(r.lines.reduce((a, l) => a + l.price * l.quantity, 0) * 1000) / 1000, r.total);
  assert.equal(buildBasket(1, catalogue).lines.length, 0);
});
