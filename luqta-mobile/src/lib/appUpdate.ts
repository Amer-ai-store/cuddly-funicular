// "A new version is available": the Android app is installed from GitHub Releases, not a store, so it cannot update
// itself. It compares its own version with the latest published release and offers the APK. Only links to this
// repository's release downloads are ever opened.
export const RELEASES_API = "https://api.github.com/repos/Amer-ai-store/Mohammad-Ahmed-Ghannam/releases/latest";
const DOWNLOAD_PREFIX = "https://github.com/Amer-ai-store/Mohammad-Ahmed-Ghannam/releases/download/";

const parts = (v: string) => String(v || "").trim().replace(/^v/i, "").split(".").map((n) => (/^\d+$/.test(n) ? Number(n) : NaN));

/** True when `latest` (e.g. "v2.0.97") is a higher dotted version than `current` (e.g. "2.0.95"). */
export function isNewer(current: string | null | undefined, latest: string | null | undefined): boolean {
  if (!current || !latest) return false;
  const a = parts(current), b = parts(latest);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (y !== x) return y > x;
  }
  return false;
}

export function safeApkUrl(url: unknown): string | null {
  if (typeof url !== "string" || url.length > 300 || !url.startsWith(DOWNLOAD_PREFIX) || !url.endsWith(".apk")) return null;
  try { const parsed = new URL(url); return parsed.protocol === "https:" && parsed.hostname === "github.com" && !parsed.search && !parsed.hash ? url : null; } catch { return null; }
}

export type ReleaseInfo = { version: string; url: string };

/** The latest release with an APK from this repository, or null. */
export function releaseFrom(body: unknown): ReleaseInfo | null {
  if (!body || typeof body !== "object") return null;
  const release = body as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: { name?: unknown; browser_download_url?: unknown }[] };
  if (release.draft === true || release.prerelease === true || typeof release.tag_name !== "string") return null;
  const apk = (Array.isArray(release.assets) ? release.assets : []).map((a) => safeApkUrl(a?.browser_download_url)).find(Boolean);
  const version = release.tag_name.replace(/^v/i, "");
  return apk && /^\d+(\.\d+){1,3}$/.test(version) ? { version, url: apk } : null;
}
