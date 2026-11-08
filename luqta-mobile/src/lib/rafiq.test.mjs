import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { COMPANIONS, INTENTS, companionById, distanceKm, etaMinutes, findIntent, formatDistance, googleMapsDirections, normalizeArabic, placeBranches, productsForIntent } from "./rafiq.ts";
import { scriptJson, storesMapHtml } from "./storesMap.ts";

const catalog = JSON.parse(readFileSync(new URL("../../server/catalog.json", import.meta.url), "utf8"));
const products = (Array.isArray(catalog) ? catalog : catalog.products).map((p) => ({ ...p, stock: p.stock ?? 10 }));

test("Rafiq companions: three personalities, unknown ids fall back to Nira", () => {
  assert.deepEqual(COMPANIONS.map((c) => c.id), ["nira", "orion", "silk"]);
  assert.equal(companionById("orion").name, "أوريون");
  assert.equal(companionById("nope").id, "nira");
  for (const c of COMPANIONS) assert.ok(c.go.includes("{place}"), `${c.id} names the place it goes to`);
});

test("Arabic requests are understood across common spellings", () => {
  assert.equal(normalizeArabic("هديّة لأمّي"), "هديه لامي");
  assert.equal(findIntent("بدي هدية لأمي بعيد الأم")?.id, "gift");
  assert.equal(findIntent("عشا سريع لشخصين")?.id, "dinner");
  assert.equal(findIntent("سماعات للسفر")?.id, "travel");
  assert.equal(findIntent("فطور الصبح")?.id, "breakfast");
  assert.equal(findIntent("xyz"), null);
  assert.equal(findIntent("   "), null);
});

test("every intent gathers real products from the store catalog, in stock only", () => {
  for (const intent of INTENTS) {
    const picked = productsForIntent(intent, products);
    assert.ok(picked.length >= 2, `${intent.id} found ${picked.map((p) => p.id)}`);
    assert.equal(new Set(picked.map((p) => p.id)).size, picked.length, "no duplicates");
  }
  assert.deepEqual(productsForIntent(INTENTS.find((i) => i.id === "dinner"), products).map((p) => p.id), ["pasta", "tomato-sauce", "cheese"]);
  const noPasta = products.map((p) => (p.id === "pasta" ? { ...p, stock: 0 } : p));
  assert.ok(!productsForIntent(INTENTS.find((i) => i.id === "dinner"), noPasta).some((p) => p.id === "pasta"), "out of stock is skipped");
});

test("distance, delivery estimate and nearest-first branches", () => {
  const amman = { latitude: 31.9454, longitude: 35.8836 }, irbid = { latitude: 32.5415, longitude: 35.851 };
  const km = distanceKm(amman, irbid);
  assert.ok(km > 64 && km < 69, `Amman–Irbid ${km}`);
  assert.equal(etaMinutes(0), 15);
  assert.equal(etaMinutes(2.4), 15);
  assert.equal(etaMinutes(10), 30);
  assert.equal(formatDistance(0.84), "840 م");
  assert.equal(formatDistance(2.44), "2.4 كم");
  assert.equal(formatDistance(2.44, "en"), "2.4 km");
  const branches = [{ id: "a", name: "عبدون", latitude: amman.latitude, longitude: amman.longitude }, { id: "i", name: "إربد", latitude: irbid.latitude, longitude: irbid.longitude }, { id: "x", name: "بلا موقع" }, { id: "bad", name: "خطأ", latitude: 200, longitude: 0 }];
  const fromIrbid = placeBranches(branches, { latitude: 32.55, longitude: 35.85 });
  assert.deepEqual(fromIrbid.map((b) => b.id), ["i", "a"], "only located branches, nearest first");
  assert.ok(fromIrbid[0].km < 2 && fromIrbid[0].eta === 15);
  const unknown = placeBranches(branches, null);
  assert.deepEqual(unknown.map((b) => [b.id, b.km, b.eta]), [["a", null, null], ["i", null, null]]);
});

test("Google Maps directions carry only numeric coordinates", () => {
  const url = new URL(googleMapsDirections({ latitude: 31.9454123456, longitude: 35.8836 }, { latitude: 32.55, longitude: 35.85 }));
  assert.equal(url.origin + url.pathname, "https://www.google.com/maps/dir/");
  assert.equal(url.searchParams.get("api"), "1");
  assert.equal(url.searchParams.get("destination"), "31.945412,35.8836");
  assert.equal(url.searchParams.get("origin"), "32.55,35.85");
  assert.equal(googleMapsDirections({ latitude: Number.NaN, longitude: 1 }), null);
  assert.equal(new URL(googleMapsDirections({ latitude: 1, longitude: 2 }, null)).searchParams.has("origin"), false);
});

test("the branches map page cannot be broken out of by a branch name", () => {
  const evil = "</script><script>alert(1)</script>\u2028<img src=x onerror=alert(2)>";
  const html = storesMapHtml({
    home: { latitude: 32.55, longitude: 35.85 },
    branches: [{ id: "br_1", name: evil, city: evil, latitude: 32.54, longitude: 35.85, km: 1.2, eta: 15 }, { id: "x".repeat(65), name: "too long id", latitude: 1, longitude: 1, km: null, eta: null }],
    selectedId: "br_1", dark: true, lang: "ar",
    labels: { home: "منزلك", minutes: "د", error: "تعذر", aria: 'خريطة" onload="x' },
  });
  assert.equal((html.match(/<script/g) || []).length, 2, "only Leaflet and the page's own script");
  assert.ok(!html.includes("</script><script>alert"), "the name never closes the script");
  assert.ok(!html.includes("<img src=x"), "no markup from data");
  assert.ok(!html.includes("\u2028"), "no raw line separators inside the script");
  assert.ok(!html.includes('" onload="'), "the label cannot add attributes");
  assert.ok(html.includes("textContent"), "labels are set as text");
  assert.ok(!html.includes("too long id"), "invalid branch ids are dropped");
  assert.ok(html.includes("1.2 كم · 15 د"));
  assert.ok(html.includes("filter:invert(1)"), "dark tiles in the night look");
  assert.ok(html.includes("img-src data: https://tile.openstreetmap.org"), "tiles only from OpenStreetMap");
  assert.equal(scriptJson("</script>"), '"\\u003c/script\\u003e"');
});
