import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isNewer, releaseFrom, safeApkUrl } from "./appUpdate.ts";

test("version comparison for the update notice", () => {
  assert.equal(isNewer("2.0.95", "v2.0.97"), true);
  assert.equal(isNewer("2.0.95", "v2.0.95"), false);
  assert.equal(isNewer("2.0.95", "v2.0.9"), false);
  assert.equal(isNewer("2.0.95", "v2.1.0"), true);
  assert.equal(isNewer("1.2.0", "v2.0.1"), true);
  assert.equal(isNewer("2.0.95", "latest"), false);
  assert.equal(isNewer(null, "v2.0.97"), false);
});

test("only this repository's release APKs are offered", () => {
  const good = "https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/releases/download/v2.0.97/amer-store.apk";
  assert.equal(safeApkUrl(good), good);
  for (const bad of ["http://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/releases/download/v1/a.apk", "https://github.com/someone/else/releases/download/v1/a.apk", "https://github.com.evil.example/Amer-ai-store/Mohammad-Ahmed-Ghannam/releases/download/v1/a.apk", `${good}?x=1`, "javascript:alert(1)", 42]) assert.equal(safeApkUrl(bad), null, String(bad));
  assert.deepEqual(releaseFrom({ tag_name: "v2.0.97", assets: [{ name: "amer-store.apk", browser_download_url: good }] }), { version: "2.0.97", url: good });
  assert.equal(releaseFrom({ tag_name: "v2.0.97", draft: true, assets: [{ browser_download_url: good }] }), null);
  assert.equal(releaseFrom({ tag_name: "v2.0.97", assets: [] }), null);
  assert.equal(releaseFrom({ tag_name: "nightly", assets: [{ browser_download_url: good }] }), null);
});
