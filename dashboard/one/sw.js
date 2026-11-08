// JAWAFA ONE AI service worker: caches only the static shell of this folder.
// Firestore, Firebase Auth and any API responses are never cached (company data stays live and private).
const CACHE = "jawafa-one-v1";
const SHELL = ["./", "./index.html", "./styles.css", "./core.js", "./app.js", "./icon.svg", "./manifest.webmanifest", "../firebase-config.js", "../aas/official-agent-roster.mjs"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Network first so a new deployment is picked up; the cache is only an offline fallback.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && SHELL.some((p) => new URL(p, self.registration.scope).href === url.href)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request)));
});
