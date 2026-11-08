// Shared configuration and the navigation policy, kept pure so it can be unit-tested without Electron.
const DEFAULT_URL = "https://amer-ai-store.github.io/Mohammad-Ahmed-Ghannam/one/";

function appUrl(env) {
  const u = (env && env.JAWAFA_ONE_URL) || DEFAULT_URL;
  const parsed = new URL(u);
  const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !local) throw new Error("JAWAFA_ONE_URL must be https (or localhost for development)");
  return parsed.href;
}

// Hosts allowed to open inside the app: the app itself and the Google / Firebase sign-in flow.
const AUTH_HOSTS = [/^accounts\.google\.com$/, /\.firebaseapp\.com$/, /^apis\.google\.com$/, /^accounts\.youtube\.com$/];
function isAppOrigin(target, base) { try { return new URL(target).origin === new URL(base).origin; } catch { return false; } }
function isAuthPopup(target) {
  try { const u = new URL(target); return u.protocol === "https:" && AUTH_HOSTS.some(r => r.test(u.hostname)); } catch { return false; }
}
// Everything else (facebook/instagram/tiktok links, Google Maps, GitHub) opens in the system browser.
function openExternally(target) { try { return ["https:", "http:", "mailto:"].includes(new URL(target).protocol); } catch { return false; } }

// Google refuses sign-in from user agents that announce an embedded framework; present the
// underlying Chromium version only.
function cleanUserAgent(ua) { return String(ua).replace(/\s?Electron\/\S+/, "").replace(/\s?jawafa-one-desktop\/\S+/, ""); }

module.exports = { DEFAULT_URL, appUrl, isAppOrigin, isAuthPopup, openExternally, cleanUserAgent };
