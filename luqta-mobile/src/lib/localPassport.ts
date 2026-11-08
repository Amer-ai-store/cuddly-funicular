import AsyncStorage from "@react-native-async-storage/async-storage";

// Non-sensitive, device-local preferences. Never substitute these for a verified commerce identity.
export const LOCAL_PASSPORT_KEY = "luqta-local-passport-v1";
export const REGIONS = ["JO", "AE", "SA", "EG", "US", "GB", "IN", "BR", "OTHER"] as const;
export type Region = (typeof REGIONS)[number];
export type LocalPassport = { displayName: string; region: Region; categories: string[] };
export const EMPTY_PASSPORT: LocalPassport = { displayName: "", region: "JO", categories: [] };

export function normalizeLocalPassport(raw: unknown): LocalPassport {
  const input: Record<string, unknown> =
    raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const name = typeof input.displayName === "string"
    ? input.displayName.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40)
    : "";
  const region: Region = typeof input.region === "string" && REGIONS.some((r) => r === input.region)
    ? input.region as Region : "JO";
  const categories = Array.isArray(input.categories)
    ? [...new Set(input.categories.filter((x): x is string => typeof x === "string" && /^[a-z0-9_-]{1,48}$/i.test(x)))].slice(0, 8)
    : [];
  return { displayName: name, region, categories };
}

export function rankByLocalInterests<T extends { category?: string; rating?: number }>(
  products: readonly T[], interests: readonly string[],
): T[] {
  const selected = new Set(interests);
  return [...products].sort((a, b) => {
    const relevance = Number(selected.has(b.category || "")) - Number(selected.has(a.category || ""));
    return relevance || (b.rating || 0) - (a.rating || 0);
  });
}

export async function readLocalPassport(): Promise<LocalPassport> {
  const raw = await AsyncStorage.getItem(LOCAL_PASSPORT_KEY);
  if (!raw) return { ...EMPTY_PASSPORT, categories: [] };
  try { return normalizeLocalPassport(JSON.parse(raw)); }
  catch { return { ...EMPTY_PASSPORT, categories: [] }; }
}

export async function saveLocalPassport(value: LocalPassport): Promise<LocalPassport> {
  const normalized = normalizeLocalPassport(value);
  await AsyncStorage.setItem(LOCAL_PASSPORT_KEY, JSON.stringify(normalized));
  return normalized;
}
