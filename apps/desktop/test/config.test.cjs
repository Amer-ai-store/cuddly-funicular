const test = require("node:test");
const assert = require("node:assert/strict");
const c = require("../config.cjs");
test("DESK-01 start URL must be https unless localhost", () => {
  assert.equal(c.appUrl({}), c.DEFAULT_URL);
  assert.equal(c.appUrl({ JAWAFA_ONE_URL: "http://127.0.0.1:8000/one/" }), "http://127.0.0.1:8000/one/");
  assert.throws(() => c.appUrl({ JAWAFA_ONE_URL: "http://example.com/" }));
});
test("DESK-02 only the app origin and Google/Firebase sign-in open inside the app", () => {
  assert.ok(c.isAppOrigin("https://amer-ai-store.github.io/x", c.DEFAULT_URL));
  assert.ok(!c.isAppOrigin("https://evil.github.io/", c.DEFAULT_URL));
  assert.ok(c.isAuthPopup("https://ameraistore-1c81d.firebaseapp.com/__/auth/handler?x=1"));
  assert.ok(c.isAuthPopup("https://accounts.google.com/o/oauth2/auth"));
  assert.ok(!c.isAuthPopup("https://accounts.google.com.evil.com/"));
  assert.ok(!c.isAuthPopup("http://accounts.google.com/"));
  assert.ok(c.openExternally("https://www.facebook.com/jawafa"));
  assert.ok(!c.openExternally("javascript:alert(1)"));
  assert.ok(!c.openExternally("file:///C:/Windows"));
});
test("DESK-03 user agent hides the Electron token", () => {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) jawafa-one-desktop/0.1.0 Chrome/130.0.6723.137 Electron/33.2.1 Safari/537.36";
  assert.equal(c.cleanUserAgent(ua), "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.137 Safari/537.36");
});
