import { strict as assert } from "node:assert";
import { test } from "node:test";
import { canConfirmOrder, cartSignatureOf, computeTotals, expiryValid, formatCardNumber, luhnValid, maskCard } from "./checkout.ts";

test("F-G07-07 card form validation (demo only): Luhn, expiry, formatting, masking", () => {
  assert.equal(luhnValid("4242 4242 4242 4242"), true);
  assert.equal(luhnValid("4242 4242 4242 4241"), false);
  assert.equal(luhnValid("1234"), false);
  assert.equal(expiryValid("12/99", new Date("2026-11-02")), true);
  assert.equal(expiryValid("10/26", new Date("2026-11-02")), false);
  assert.equal(expiryValid("13/30"), false);
  assert.equal(formatCardNumber("4242424242424242"), "4242 4242 4242 4242");
  assert.equal(maskCard("4242424242421234"), "**** 1234");
});

test("F-G07-09 totals: discount never exceeds subtotal, free shipping threshold, 3-decimal JOD", () => {
  assert.deepEqual(computeTotals(9.4, 1, 1, 30), { subtotal: 9.4, discount: 1, shipping: 1, total: 9.4 });
  assert.deepEqual(computeTotals(5, 9, 1, 30), { subtotal: 5, discount: 5, shipping: 1, total: 1 });
  assert.equal(computeTotals(30, 0, 1, 30).shipping, 0);
  assert.equal(computeTotals(0, 0, 1, 30).total, 0);
  assert.equal(computeTotals(0.1 + 0.2, 0, 0, 30).subtotal, 0.3);
});

test("F-G07-11 an order cannot be confirmed without terms, address, cart check and supported payment", () => {
  const ok = { termsAccepted: true, hasAddress: true, cartChecked: true, cartOk: true, paymentSupported: true, busy: false };
  assert.equal(canConfirmOrder(ok).ok, true);
  for (const key of ["termsAccepted", "hasAddress", "cartChecked", "cartOk", "paymentSupported"]) {
    const r = canConfirmOrder({ ...ok, [key]: false });
    assert.equal(r.ok, false, key);
    assert.ok(r.reason && r.reason.length > 3);
  }
  assert.equal(canConfirmOrder({ ...ok, busy: true }).ok, false);
});

test("F-G05-06 coupon is bound to the exact cart contents", () => {
  assert.equal(cartSignatureOf({ milk: 2, rice: 1 }), cartSignatureOf({ rice: 1, milk: 2 }));
  assert.notEqual(cartSignatureOf({ rice: 1 }), cartSignatureOf({ rice: 2 }));
});
