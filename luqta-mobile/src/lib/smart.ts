// G14 — client side of the features merged from the "أسواق جوافة / Aura" app.
// Pure helpers (no React Native imports) so Node tests can run them directly.
// Server data is always preferred; demo computations are labelled "تجريبي" by callers.
import type { Product } from "../data/products.ts";

export type PricePoint = { price: number; at: string; oldPrice?: number | null };
export type PriceStats = { min: number; max: number; avg: number; changePct: number; trend: "down" | "up" | "flat"; advice: string };
export type PriceHistory = { productId: string; days: number; points: PricePoint[]; stats: PriceStats };
export type PulseCategory = { category: string; products: number; avgPrice: number; changePct: number; offers: number; stock: number };
export type Mover = { productId: string; name: string; image?: string; from: number; to: number; changePct: number };
export type MarketPulse = { generatedAt: string; totals: { products: number; offers: number; priceChanges30d: number }; categories: PulseCategory[]; drops: Mover[]; rises: Mover[]; mostViewed: { productId: string; views: number }[]; timeline: { day: string; changes: number; avg: number }[] };
export type Watch = { productId: string; name: string; image: string | null; price: number | null; target: number; reached: boolean; notifiedAt: string | null; createdAt: string };
export type Rate = { source: string; ours: boolean; price: number; shipping: number; total: number; url: string | null; updatedAt: string; inStock: boolean; lowest: boolean };
export type Comparison = { productId: string; name: string; rates: Rate[]; spread: number; savingVsHighest: number; branches: { id: string; name: string; stock: number | null }[] };
export type Bundle = { id: string; name: string; percent: number; productIds: string[]; base: number; discount: number };
export type Alternative = { productId: string; name: string; price: number; quantity: number; saving: number; replaceWith: { id: string; name: string; price: number; image?: string; rating: number } };
export type Optimization = { objective: Objective; subtotal: number; alternatives: Alternative[]; alternativesSaving: number; bundle: Bundle | null; branches: { id: string; name: string; city?: string; canFulfill: boolean; missing: string[] }[]; recommendedBranch: { id: string; name: string } | null; freeShipping: { threshold: number; fee: number; remaining: number }; optimizedSubtotal: number; estimatedTotal: number; tips: string[]; demo?: boolean };
export type Objective = "cheapest" | "single-branch" | "fastest";
export type Insights = { orders: number; spent: number; saved: number; avgBasket: number; monthly: { month: string; total: number }[]; byCategory: { category: string; total: number; share: number }[]; tips: string[]; green: { ecoOrders: number; co2SavedKg: number } };
export type ListItem = { id: string; productId: string | null; title: string; quantity: number; done: boolean; addedBy: string; price: number | null; lineTotal: number | null };
export type ShoppingList = { id: string; name: string; budget: number | null; family: boolean; shareCode: string | null; ownerId: string; members: { id: string; name: string; role: string }[]; items: ListItem[]; createdAt: string; updatedAt: string };
export type Badge = { id: string; title: string; detail: string; earned: boolean };
export type Level = { id: string; name: string; min: number; next: { id: string; name: string; min: number } | null; progress: number };
export type RewardsProfile = { points: number; lifetime: number; level: Level; levels: { id: string; name: string; min: number }[]; streak: number; checkedInToday: boolean; nextCheckinPoints: number; gamePlayedToday: boolean; badges: Badge[] };
export type PublicCoupon = { code: string; title: string | null; type: "percent" | "fixed"; value: number; minSubtotal: number; expiresAt: string | null };
export type MediaPost = { id: string; kind: "video" | "story"; title: string; mediaUrl: string; posterUrl: string | null; productId: string | null; views: number; likes: number; liked: boolean; expiresAt: string | null; createdAt: string };
export type Campaign = { id: string; title: string; subtitle: string | null; image: string | null; productId: string | null; category: string | null; startsAt: string | null; endsAt: string | null; active: boolean };
export type ReceiptItem = { name: string; price: number; quantity: number };
export type ReceiptMatch = { name: string; theirPrice: number; ourProductId: string; ourName: string; ourPrice: number; saving: number };

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Local "best time to buy" stats — mirrors server/features.mjs priceStats. */
export function localPriceStats(points: PricePoint[], current: number): PriceStats {
  if (!points.length) return { min: current, max: current, avg: current, changePct: 0, trend: "flat", advice: "لا توجد تغييرات سعر مسجلة بعد لهذا المنتج." };
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices, current), max = Math.max(...prices, current);
  const avg = round(prices.reduce((a, b) => a + b, 0) / prices.length);
  const first = prices[0], changePct = first ? Math.round(((current - first) / first) * 1000) / 10 : 0;
  const trend = changePct < -0.5 ? "down" : changePct > 0.5 ? "up" : "flat";
  const advice = current <= min ? "السعر الحالي هو الأدنى خلال الفترة — وقت مناسب للشراء." : trend === "down" ? "السعر يتجه للانخفاض؛ فعّل تنبيه السعر." : trend === "up" ? "السعر يتجه للارتفاع؛ الشراء الآن قد يوفر عليك." : "السعر مستقر تقريبًا خلال الفترة.";
  return { min, max, avg, changePct, trend, advice };
}

/** Demo market pulse from the bundled catalogue (no history → offers & averages only). */
export function demoPulse(products: Product[]): MarketPulse {
  const byCat = new Map<string, PulseCategory>();
  for (const p of products) {
    const c = byCat.get(p.category) || { category: p.category, products: 0, avgPrice: 0, changePct: 0, offers: 0, stock: 0 };
    c.products++; c.avgPrice += p.price; c.stock += p.stock ?? 0;
    if (p.oldPrice && p.oldPrice > p.price) { c.offers++; c.changePct += ((p.price - p.oldPrice) / p.oldPrice) * 100; }
    byCat.set(p.category, c);
  }
  const categories = [...byCat.values()].map((c) => ({ ...c, avgPrice: round(c.avgPrice / c.products), changePct: Math.round((c.changePct / c.products) * 10) / 10 }));
  const drops = products.filter((p) => p.oldPrice && p.oldPrice > p.price).map((p) => ({ productId: p.id, name: p.name, from: p.oldPrice as number, to: p.price, changePct: Math.round(((p.price - (p.oldPrice as number)) / (p.oldPrice as number)) * 1000) / 10 })).sort((a, b) => a.changePct - b.changePct);
  return { generatedAt: new Date().toISOString(), totals: { products: products.length, offers: drops.length, priceChanges30d: 0 }, categories, drops, rises: [], mostViewed: [], timeline: [] };
}

/** Demo basket optimizer — same rules as the server, on the local catalogue. */
export function demoOptimize(products: Product[], cart: Record<string, number>, objective: Objective, threshold: number, fee: number): Optimization {
  const lines = Object.entries(cart).map(([id, quantity]) => ({ p: products.find((x) => x.id === id), quantity })).filter((l): l is { p: Product; quantity: number } => !!l.p && l.quantity > 0);
  const subtotal = round(lines.reduce((a, l) => a + l.p.price * l.quantity, 0));
  const inCart = new Set(lines.map((l) => l.p.id));
  const alternatives: Alternative[] = objective === "fastest" ? [] : lines.map((l): Alternative | null => {
    const alt = products.filter((c) => c.category === l.p.category && !inCart.has(c.id) && (c.stock ?? 1) >= l.quantity && c.price <= l.p.price * 0.95).sort((a, b) => a.price - b.price || b.rating - a.rating)[0];
    return alt ? { productId: l.p.id, name: l.p.name, price: l.p.price, quantity: l.quantity, saving: round((l.p.price - alt.price) * l.quantity), replaceWith: { id: alt.id, name: alt.name, price: alt.price, rating: alt.rating, ...(typeof alt.image === "string" ? { image: alt.image } : {}) } } : null;
  }).filter((x): x is Alternative => !!x);
  const alternativesSaving = round(alternatives.reduce((a, x) => a + x.saving, 0));
  const optimizedSubtotal = round(subtotal - alternativesSaving);
  const tips = optimizedSubtotal < threshold ? [`أضف ${round(threshold - optimizedSubtotal)} للحصول على توصيل مجاني.`] : [];
  return { objective, subtotal, alternatives, alternativesSaving, bundle: null, branches: [], recommendedBranch: null, freeShipping: { threshold, fee, remaining: Math.max(0, round(threshold - optimizedSubtotal)) }, optimizedSubtotal, estimatedTotal: round(optimizedSubtotal + (optimizedSubtotal >= threshold ? 0 : fee)), tips, demo: true };
}

/** Free-shipping progress 0..1 and the amount still missing. */
export function freeShippingProgress(subtotal: number, threshold: number) {
  if (!threshold || threshold <= 0) return { progress: 1, remaining: 0, qualified: true };
  const remaining = Math.max(0, round(threshold - subtotal));
  return { progress: Math.min(1, subtotal / threshold), remaining, qualified: remaining === 0 };
}

/** "02:13:09" countdown (or days) until an ISO date; null when passed/invalid. */
export function countdown(iso: string | undefined | null, nowMs = Date.now()): string | null {
  if (!iso) return null;
  const end = Date.parse(iso); if (!Number.isFinite(end) || end <= nowMs) return null;
  let s = Math.floor((end - nowMs) / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return d > 0 ? `${d} يوم ${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Days until a freshness date: "fresh" (>7), "soon" (1..7), "expired". */
export function freshness(iso: string | undefined | null, nowMs = Date.now()): { state: "fresh" | "soon" | "expired"; days: number } | null {
  if (!iso) return null;
  const t = Date.parse(iso); if (!Number.isFinite(t)) return null;
  const days = Math.ceil((t - nowMs) / 86400_000);
  return { state: days < 0 ? "expired" : days <= 7 ? "soon" : "fresh", days };
}

/** Sum nutrition facts of a cart (only products that declare them). */
export function cartNutrition(products: Product[], cart: Record<string, number>) {
  const total = { calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0 }; let covered = 0, items = 0;
  for (const [id, q] of Object.entries(cart)) {
    if (q <= 0) continue; items++;
    const n = products.find((p) => p.id === id)?.nutrition as Record<string, number> | undefined;
    if (!n) continue; covered++;
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] = round(total[k] + (Number(n[k]) || 0) * q);
  }
  return { total, covered, items };
}

/** Eco delivery: one consolidated trip instead of a dedicated one. */
export const CO2_PER_TRIP_KG = 0.9;

/** Share text + deep link for a product. */
export function shareMessage(product: { id: string; name: string; price: number }, price: string) {
  return { title: product.name, message: `${product.name} بسعر ${price} على لُقطة\nluqta://product/${product.id}` };
}

// -------- voice/visual search keyword cleanup --------
const FILLER = ["ابحث", "عن", "بدي", "اريد", "أريد", "ابغى", "لو", "سمحت", "please", "find", "search", "for", "show", "me"];
export function cleanVoiceQuery(text: string): string {
  return text.replace(/[؟?!.,،]/g, " ").split(/\s+/).filter((w) => w && !FILLER.includes(w.toLowerCase())).join(" ").trim();
}
