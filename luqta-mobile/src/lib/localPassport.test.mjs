import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLocalPassport, rankByLocalInterests, EMPTY_PASSPORT } from "./localPassport.ts";

test("rejects malformed and untrusted local preference data", () => {
  assert.deepEqual(normalizeLocalPassport(null), EMPTY_PASSPORT);
  const model = normalizeLocalPassport({
    displayName: "  Hello\u0000 World  ",
    region: "bad",
    categories: ["food", "food", "../secret", "tech", 17, "x".repeat(49)],
  });
  assert.deepEqual(model, { displayName: "Hello World", region: "JO", categories: ["food", "tech"] });
  assert.equal(normalizeLocalPassport({ displayName: "x".repeat(100) }).displayName.length, 40);
  assert.equal(normalizeLocalPassport({ region: "BR" }).region, "BR");
});

test("prioritizes locally selected categories without modifying input", () => {
  const items = Object.freeze([
    { id: "a", category: "electronics", rating: 4.9 },
    { id: "b", category: "food", rating: 3.0 },
    { id: "c", category: "food", rating: 4.5 },
  ]);
  assert.deepEqual(rankByLocalInterests(items, ["food"]).map((p) => p.id), ["c", "b", "a"]);
  assert.equal(items[0].id, "a");
  assert.deepEqual(rankByLocalInterests(items, []).map((p) => p.id), ["a", "c", "b"]);
});
