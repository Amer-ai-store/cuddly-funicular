import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createCommerceServer } from "./commerce.mjs";

test("favorites synchronize between separate sign-ins and remain private", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "luqta-wishlist-"));
  const app = await createCommerceServer({ dbPath: resolve(directory, "store.sqlite") });
  await new Promise((done) => app.server.listen(0, "127.0.0.1", done));
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  const password = "test-password-1234";
  const request = async (path, method, token, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  const first = await request("/auth/register", "POST", null, { name: "مشتري", email: "buyer@example.test", password });
  assert.equal(first.status, 201);
  const second = await request("/auth/login", "POST", null, { email: "buyer@example.test", password });
  assert.equal(second.status, 200);
  const stranger = await request("/auth/register", "POST", null, { name: "آخر", email: "other@example.test", password });
  assert.equal(stranger.status, 201);
  assert.notEqual(first.body.token, second.body.token);
  assert.equal((await request("/wishlist", "PUT", first.body.token, { productIds: ["mug", "lamp"] })).status, 200);
  assert.deepEqual((await request("/wishlist", "GET", second.body.token)).body.productIds, ["mug", "lamp"]);
  assert.deepEqual((await request("/wishlist", "GET", stranger.body.token)).body.productIds, []);
  assert.equal((await request("/wishlist", "PUT", second.body.token, { productIds: ["lamp"] })).status, 200);
  assert.deepEqual((await request("/wishlist", "GET", first.body.token)).body.productIds, ["lamp"]);
});
