import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  filterProducts,
  normalizeSearch,
  recommendProducts,
} from "./recommendations.ts";

// Isolated fixtures keep tests runnable without Metro's bundled image loader.
const fixtures = [
  [
    "headphones",
    "سماعات هدوء",
    "electronics",
    249,
    ["سماعات", "هدية", "مكتب", "عمل", "headphones"],
  ],
  ["speaker", "مكبر صوت", "electronics", 179, ["مكبر صوت", "هدية", "speaker"]],
  [
    "keyboard",
    "لوحة مفاتيح",
    "electronics",
    199,
    ["كيبورد", "مكتب", "عمل", "keyboard"],
  ],
  [
    "lamp",
    "مصباح هالة",
    "home",
    129,
    ["مصباح", "مكتب", "عمل", "نوم", "غرفة", "هدية"],
  ],
  ["chair", "كرسي ركن", "home", 449, ["كرسي", "منزل"]],
  ["mug", "كوب صباح", "home", 59, ["كوب", "مكتب", "عمل", "هدية"]],
  ["sneakers", "حذاء ستريت", "fashion", 219, ["حذاء", "shoes"]],
  ["bag", "حقيبة كل يوم", "fashion", 149, ["حقيبة", "مكتب", "عمل", "هدية"]],
  ["watch", "ساعة مومنت", "fashion", 279, ["ساعة", "هدية"]],
  ["serum", "سيروم الترطيب", "care", 89, ["سيروم", "بشرة", "عناية"]],
  ["fragrance", "عطر وود", "care", 199, ["عطر", "عناية", "هدية"]],
  [
    "diffuser",
    "فواحة سكون",
    "care",
    119,
    ["فواحة", "عناية", "نوم", "غرفة", "هدية"],
  ],
];
const products = fixtures.map(([id, name, category, price, tags]) => ({
  id,
  name,
  category,
  price,
  tags,
  subtitle: "",
  brand: "DEMO",
  rating: 4.8,
  reviews: 10,
  image: "",
  description: "",
  features: [],
  colors: [],
}));

test("normalizes Arabic forms, tashkeel, and Arabic and Persian numbers", () => {
  assert.equal(normalizeSearch("إضَاءة ٢۵۰"), "اضاءه 250");
  assert.equal(filterProducts("سَمَّاعَات", products)[0]?.id, "headphones");
  assert.equal(filterProducts("إلكترونيات", products).length, 3);
});

test("respects Arabic and Persian digit budgets and strict caps", () => {
  for (const prompt of [
    "هدايا تحت ٣٠٠",
    "هدية أقل من ۲۵۰",
    "مكتب بميزانية ١٥٠",
  ]) {
    const result = recommendProducts(prompt, products);
    assert.ok(result.productIds.length > 0);
    assert.ok(result.budget !== undefined);
    for (const id of result.productIds) {
      assert.ok(
        products.find((product) => product.id === id).price < result.budget,
      );
    }
  }
  assert.deepEqual(
    recommendProducts("سماعات أقل من 249", products).productIds,
    [],
  );
  assert.deepEqual(
    recommendProducts("سماعات ميزانيتي 249", products).productIds,
    ["headphones"],
  );
});

test("returns empty recommendations when intent or budget has no matches", () => {
  assert.deepEqual(recommendProducts("أريد دراجة", products).productIds, []);
  assert.deepEqual(
    recommendProducts("سماعات تحت 100", products).productIds,
    [],
  );
  assert.deepEqual(recommendProducts("هدايا تحت 10", products).productIds, []);
});

test("selects appropriate products for named intents", () => {
  assert.deepEqual(recommendProducts("أحتاج headphones", products).productIds, [
    "headphones",
  ]);
  assert.deepEqual(recommendProducts("أريد shoes", products).productIds, [
    "sneakers",
  ]);
  const care = recommendProducts("منتجات عناية", products).productIds;
  assert.ok(care.length > 0);
  assert.ok(
    care.every(
      (id) => products.find((product) => product.id === id).category === "care",
    ),
  );
  const bedroom = recommendProducts("شيء لغرفة نوم", products).productIds;
  assert.ok(bedroom.includes("lamp"));
  const gifts = recommendProducts("هدية تحت 100", products).productIds;
  assert.deepEqual(gifts, ["mug"]);
});

test("uses product facts for comparisons and explicitly labels demo suggestions", () => {
  const result = recommendProducts("قارن منتجات للمكتب تحت 300", products);
  assert.ok(result.productIds.length <= 2);
  assert.match(result.message, /اقتراح تجريبي/);
  assert.match(result.message, /مقارنة/);
  assert.ok(
    result.productIds.every(
      (id) => products.find((product) => product.id === id).price < 300,
    ),
  );
});

test("keeps all choices within an explicit budget range", () => {
  const result = recommendProducts("هدية بين ١٠٠ و٢٠٠", products);
  assert.equal(result.budget, 200);
  assert.ok(result.productIds.length > 0);
  assert.ok(
    result.productIds.every((id) => {
      const price = products.find((product) => product.id === id).price;
      return price >= 100 && price <= 200;
    }),
  );
});

test("uses the configured currency and understands a Jordanian dinar budget", () => {
  const result = recommendProducts("قارن هدايا 200 دينار", products, "JOD");
  assert.equal(result.budget, 200);
  assert.match(result.message, /د\.أ|JOD/);
  assert.doesNotMatch(result.message, /ر\.س/);
  assert.ok(result.productIds.length > 0);
  assert.ok(result.productIds.every((id) => products.find((product) => product.id === id).price <= 200));
});
