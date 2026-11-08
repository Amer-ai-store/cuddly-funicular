import { strict as assert } from "node:assert";
import { test } from "node:test";
import { scriptJson, viewerHtml } from "./viewer3d.ts";

// Built from code points so this file never contains raw line or paragraph separators.
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);

test("L088 the 3D viewer page cannot be broken out of by model data", () => {
  // Escaped JSON is still the same data, but can no longer close the <script> tag or end the line.
  const tricky = { shape: "</script><script>alert(1)</script>", note: `a${LS}b${PS}<!--` };
  const json = scriptJson(tricky);
  assert.equal(new RegExp(`[<>${LS}${PS}]`).test(json), false);
  assert.deepEqual(JSON.parse(json), tricky);
  const html = viewerHtml({ shape: "box</script><img src=x onerror=alert(1)>", color: "red;}</style>", scale: 2 }, "#FFFFFF</style>");
  assert.equal(html.match(/<\/script>/g).length, 1, "only the viewer's own closing tag");
  assert.doesNotMatch(html, /<img|onerror=|red;\}/);
  assert.match(html, /mountViewer\(document\.getElementById\('v'\),\{"shape":"boxscriptimgsrcxonerroralert1","color":"#7C5CFF","scale":2\},post\)/);
});
