import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { isStrictPath, num, svgPath } from "./svgPath.ts";

test("numbers in path data are plain decimals: no exponent, NaN, Infinity or -0", () => {
  assert.equal(num(1.23456), "1.23");
  assert.equal(num(1e-7), "0");
  assert.equal(num(-0.001), "0");
  assert.equal(num(Number.NaN), "0");
  assert.equal(num(Infinity), "0");
  assert.equal(num(1234567.891), "1234567.89");
});

test("a literal minus before a value never produces a double sign (the Android crash on narrow phones)", () => {
  const stripe = -0.19; // what the awning stripe width became on a 360 dp phone
  assert.equal(svgPath`h-${stripe}`, "h0.19");
  assert.equal(svgPath`h-${0.5}`, "h-0.5");
  assert.ok(isStrictPath(svgPath`M${10} ${20}h${5}l-2 ${3}h-${stripe}z`));
  assert.equal(isStrictPath("M1 2h--0.19z"), false, "the string that closed the app is rejected");
  assert.equal(isStrictPath("M1 2L1e-7 3"), false);
  assert.equal(isStrictPath("M1 2LNaN 3"), false);
});

test("the floating-market awning and door are valid at every phone and tablet width", () => {
  for (let width = 240; width <= 1400; width += 3) {
    const scale = Math.min(1.15, Math.max(0.75, width / 400));
    for (const spot of [0.85, 1.05]) {
      const s = spot * scale, w = 34 * s, h = 26 * s, x = width * 0.3, y = 180;
      for (let i = 0; i < 4; i++) {
        const left = x - w / 2 - 5 * s + i * ((w + 10 * s) / 4), sw = Math.max(4, (w + 10 * s) / 8), top = y - h, bottom = y - h + 5 * s;
        const d = svgPath`M${left} ${top}L${left + sw} ${top}L${left + sw - 2} ${bottom}L${left + 2} ${bottom}Z`;
        assert.ok(isStrictPath(d), `${width}px: ${d}`);
      }
      const door = svgPath`M${x - 5 * s} ${y}L${x - 5 * s} ${y - h * 0.45}A${5 * s} ${5 * s} 0 0 1 ${x + 5 * s} ${y - h * 0.45}L${x + 5 * s} ${y}Z`;
      assert.ok(isStrictPath(door), door);
    }
  }
});

test("every computed path in the Rafiq components goes through svgPath", () => {
  for (const file of ["../components/rafiq/FloatingMarket.tsx", "../components/rafiq/marks.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(!/d=\{`/.test(source), `${file} builds a path with a raw template string`);
  }
});
