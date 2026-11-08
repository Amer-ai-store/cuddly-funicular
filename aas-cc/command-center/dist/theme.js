/** Device-only appearance preference. No workspace data is stored here. */
const STORAGE_KEY = 'aas-theme';
const PREFERENCES = new Set(['system', 'light', 'dark']);
const root = document.documentElement;
const subscribers = new Set();
const systemTheme = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

function readPreference() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (PREFERENCES.has(saved)) return saved;
  } catch { /* Appearance continues to work when browser storage is unavailable. */ }
  return 'system';
}

let preference = readPreference();
let resolved;

function get() {
  return Object.freeze({ preference, resolved });
}

function apply() {
  const next = preference === 'system'
    ? (systemTheme?.matches ? 'dark' : 'light')
    : preference;
  const changed = root.dataset.themePreference !== preference || resolved !== next;
  resolved = next;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = resolved === 'dark' ? '#0d1614' : '#f7f8f5';
  if (!changed) return;
  const value = get();
  document.dispatchEvent(new CustomEvent('aas-theme-change', { detail: value }));
  for (const listener of subscribers) listener(value);
}

function set(nextPreference) {
  if (!PREFERENCES.has(nextPreference)) {
    throw new TypeError('Theme preference must be system, light, or dark.');
  }
  preference = nextPreference;
  try { window.localStorage.setItem(STORAGE_KEY, preference); } catch { /* Device storage is optional. */ }
  apply();
  return get();
}

function subscribe(listener) {
  if (typeof listener !== 'function') throw new TypeError('Theme subscriber must be a function.');
  subscribers.add(listener);
  listener(get());
  return () => subscribers.delete(listener);
}

const onSystemChange = () => { if (preference === 'system') apply(); };
if (systemTheme?.addEventListener) systemTheme.addEventListener('change', onSystemChange);
else if (systemTheme?.addListener) systemTheme.addListener(onSystemChange);

window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  preference = readPreference();
  apply();
});

export const theme = Object.freeze({ get, set, subscribe });
window.AASTheme = theme;
apply();

export default theme;
