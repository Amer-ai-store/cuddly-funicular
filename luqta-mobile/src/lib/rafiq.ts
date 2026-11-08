// "رفيق" — the AI companion on the home screen, from the Rafiq design: three companion personalities, the shopping
// intents they understand, and the distance and delivery-time estimate shown for the store's real branches.
// Pure functions only, so the node tests can check them without React Native.
import type { Product } from "../data/products.ts";

export type CompanionId = "nira" | "orion" | "silk";
export type Companion = {
  id: CompanionId;
  name: string;
  trait: string;
  hello: string;
  short: string;
  /** What the companion says when it takes the shopper to a store or a branch. */
  go: string;
  added: string;
};

export const COMPANIONS: Companion[] = [
  { id: "nira", name: "نيرا", trait: "هادئة وتختصر", hello: "مرحبًا بك. أنا نيرا، دليلتك في السوق. اختر متجرًا أو أخبرني بما تحتاجه وسأقودك إليه.", short: "مرحبًا بك", go: "تفضّل معي إلى {place}.", added: "أُضيفت إلى سلتك." },
  { id: "orion", name: "أوريون", trait: "دقيق ويقارن", hello: "أهلًا بك. أنا أوريون. أقارن لك الخيارات وأرتّبها حسب حاجتك وسعرها.", short: "في خدمتك", go: "أتوجّه الآن إلى {place}.", added: "سُجّلت. اختيار متوازن." },
  { id: "silk", name: "سِلك", trait: "سريع ويعرف العروض", hello: "أهلًا! أنا سِلك. أعرف أين تجد أفضل العروض في كل قسم.", short: "أهلًا!", go: "من هنا، {place} فيه ما تبحث عنه.", added: "تمّت الإضافة!" },
];
export const DEFAULT_COMPANION: CompanionId = "nira";
export const companionById = (id: string | null | undefined): Companion => COMPANIONS.find((c) => c.id === id) || COMPANIONS[0];
export const isCompanionId = (value: unknown): value is CompanionId => COMPANIONS.some((c) => c.id === value);

export type Intent = {
  id: string;
  label: string;
  /** A short line under the chip: what the companion will gather. */
  sub: string;
  /** Words in the shopper's request that point to this intent (normalised, see `normalizeArabic`). */
  keys: string[];
  /** Product tags or name words to gather, in order of priority. */
  terms: string[];
  reply: string;
};

export const INTENTS: Intent[] = [
  { id: "breakfast", label: "فطور العائلة", sub: "لبنة وبيض وخبز", keys: ["فطور", "ترويقه", "صباح", "افطار"], terms: ["لبنه", "بيض", "خبز", "فطور"], reply: "فطور يجمع العائلة: ألبان طازجة وخبز من الفرن. هذه أساسياته." },
  { id: "dinner", label: "عشاء سريع لشخصين", sub: "معكرونة بالصلصة", keys: ["عشاء", "عشا", "شخصين", "سريع", "باستا", "معكرونه", "طبخ", "جوعان"], terms: ["معكرونه", "صلصه", "جبنه", "زيت"], reply: "معكرونة بصلصة الطماطم تجهز في عشرين دقيقة. هذه مكوّناتها لشخصين." },
  { id: "salad", label: "سلطة فتوش", sub: "خضار طازجة اليوم", keys: ["سلطه", "فتوش", "خضار", "صحي", "دايت"], terms: ["فتوش", "سلطه", "طماطم", "ليمون"], reply: "خضار اليوم طازجة. هذه مكوّنات فتوش يكفي العائلة." },
  { id: "gift", label: "هدية لمن تحب", sub: "عطر وساعة وسماعات", keys: ["هديه", "هدايا", "عيد", "ميلاد", "امي", "مناسبه"], terms: ["هديه", "عطر", "ساعه"], reply: "اخترت لك ثلاث هدايا يحبها الجميع. أضف ما يناسب من تحب." },
  { id: "travel", label: "سماعات للسفر", sub: "عزل وبطارية طويلة", keys: ["سفر", "سماعه", "سماعات", "رحله", "رحلات", "تقنيه", "هاتف", "جوال"], terms: ["سماعات", "رحلات", "حقيبه"], reply: "للسفر أنصحك بعزل الضوضاء وبطارية طويلة. هذه أفضل الخيارات لدينا." },
  { id: "calm", label: "ركن هادئ في البيت", sub: "إضاءة وفواحة وكوب", keys: ["بيت", "منزل", "هدوء", "استرخاء", "ديكور", "غرفه"], terms: ["استرخاء", "اضاءه", "كوب", "منزل"], reply: "ركن هادئ يبدأ بإضاءة دافئة ورائحة لطيفة. هذه اقتراحاتي." },
];

/** Folds the spellings people type interchangeably (hamza forms, taa marbuta, alif maqsura, diacritics). */
export function normalizeArabic(value: string): string {
  return value
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase()
    .trim();
}

export function findIntent(text: string): Intent | null {
  const t = normalizeArabic(text);
  if (!t) return null;
  return INTENTS.find((intent) => intent.keys.some((k) => t.includes(k))) || null;
}

type Pickable = Pick<Product, "id" | "name" | "tags" | "stock" | "category"> & { active?: boolean };

/** Up to `limit` in-stock products for an intent, ordered by the intent's terms, one product per term first. */
export function productsForIntent<T extends Pickable>(intent: Intent, products: T[], limit = 3): T[] {
  const available = products.filter((p) => p.active !== false && (p.stock ?? 1) > 0);
  const words = (p: T) => [p.name, ...(p.tags || [])].map(normalizeArabic);
  const picked: T[] = [];
  const take = (p: T | undefined) => { if (p && !picked.includes(p) && picked.length < limit) picked.push(p); };
  for (const term of intent.terms) take(available.find((p) => words(p).some((w) => w.includes(term))));
  for (const term of intent.terms) for (const p of available) if (words(p).some((w) => w.includes(term))) take(p);
  return picked;
}

export type GeoPoint = { latitude: number; longitude: number };
export const validGeoPoint = (p: Partial<GeoPoint> | null | undefined): p is GeoPoint =>
  !!p && typeof p.latitude === "number" && typeof p.longitude === "number" && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
  && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;

export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * A rough delivery time: ten minutes to prepare the order and city driving at about 30 km/h, rounded up to five
 * minutes. It is labelled as an estimate wherever it is shown.
 */
export function etaMinutes(km: number): number {
  const minutes = 10 + (Math.max(0, km) / 30) * 60;
  return Math.max(15, Math.ceil(minutes / 5) * 5);
}

/** "850 م" under one kilometre, "2.4 كم" up to 100 km, whole kilometres beyond. */
export function formatDistance(km: number, lang: "ar" | "en" = "ar"): string {
  if (km < 1) { const m = Math.max(10, Math.round((km * 1000) / 10) * 10); return lang === "en" ? `${m} m` : `${m} م`; }
  const value = km < 100 ? (Math.round(km * 10) / 10).toString() : Math.round(km).toString();
  return lang === "en" ? `${value} km` : `${value} كم`;
}

export type Branch = { id: string; name: string; city?: string; address?: string; latitude?: number | null; longitude?: number | null; hours?: string; phone?: string };
export type PlacedBranch = Branch & { latitude: number; longitude: number; km: number | null; eta: number | null };

/** Branches that have coordinates, with distance and ETA from `home` when it is known, nearest first. */
export function placeBranches(branches: Branch[], home: GeoPoint | null): PlacedBranch[] {
  const placed = branches
    .filter((b) => validGeoPoint({ latitude: b.latitude ?? undefined, longitude: b.longitude ?? undefined }))
    .map((b) => {
      const point = { latitude: b.latitude as number, longitude: b.longitude as number };
      const km = home ? distanceKm(home, point) : null;
      return { ...b, ...point, km, eta: km === null ? null : etaMinutes(km) };
    });
  return home ? placed.sort((a, b) => (a.km as number) - (b.km as number)) : placed;
}

/**
 * Directions in Google Maps (the app on a phone, the website elsewhere). Only validated coordinates go into the
 * link, so a branch name can never change where it points. No API key is needed for this link.
 */
export function googleMapsDirections(destination: GeoPoint, origin: GeoPoint | null = null): string | null {
  if (!validGeoPoint(destination)) return null;
  const fix = (n: number) => Number(n.toFixed(6));
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", `${fix(destination.latitude)},${fix(destination.longitude)}`);
  if (validGeoPoint(origin)) url.searchParams.set("origin", `${fix(origin.latitude)},${fix(origin.longitude)}`);
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}

/** A phone number safe to dial: digits with an optional leading +, spaces and dashes removed. */
export function dialable(phone: string | null | undefined): string | null {
  if (typeof phone !== "string") return null;
  const digits = phone.replace(/[\s-]/g, "");
  return /^\+?[0-9]{6,15}$/.test(digits) ? digits : null;
}
