// WP-13 client-side fallback of the server's shopping-intent compiler (used in demo mode
// when no store server is linked). Matches only real catalog products; unknown lines are
// returned as "not_found" — nothing is invented.
import type { Product } from "../data/products";

export type IntentItem = { raw: string; query: string; quantity: number | null; unit: string | null; status: "matched" | "ambiguous" | "out_of_stock" | "not_found"; confidence: number; productId?: string; name?: string; price?: number; available?: number; alternatives: { productId: string; name: string; price: number; confidence: number }[] };
export type Intent = { budget: number | null; withinBudget: boolean | null; total: number; items: IntentItem[] };

const AR = "٠١٢٣٤٥٦٧٨٩";
const WORD_NUM: Record<string, number> = { واحد: 1, واحده: 1, اثنين: 2, ثنتين: 2, تنين: 2, ثلاث: 3, ثلاثه: 3, تلات: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, ثمان: 8, تسع: 9, عشر: 10, عشره: 10 };
const UNITS: Record<string, string> = { كيلو: "kg", كغ: "kg", غرام: "g", جرام: "g", لتر: "l", ليتر: "l", حبه: "piece", حبات: "piece", قطعه: "piece", علبه: "pack", علب: "pack", كيس: "pack", باكيت: "pack" };
const STOP = new Set(["بدي", "ابغى", "اريد", "جيب", "هات", "لي", "من", "و", "مع", "كمان", "بس", "اضف"]);
export const normalize = (q: string) => String(q || "").toLowerCase().replace(/[ً-ٰـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
const digits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)));
export const splitList = (text: string) => digits(String(text || "")).split(/[\n،,;؛]+|\s+و(?=\s*[\p{L}\d])/u).map((s) => s.trim()).filter(Boolean).slice(0, 60);
export function parseLine(line: string) {
  let quantity: number | null = null, unit: string | null = null; const words: string[] = [];
  for (const w of normalize(line).split(" ")) {
    if (/^\d+(\.\d+)?$/.test(w)) { quantity = Number(w); continue; }
    if (w in WORD_NUM && quantity === null) { quantity = WORD_NUM[w]; continue; }
    const bare = w.replace(/^ال/, "");
    if (UNITS[w] || UNITS[bare]) { unit = UNITS[w] || UNITS[bare]; continue; }
    if (!STOP.has(w)) words.push(w);
  }
  return { raw: line, query: words.join(" "), quantity, unit };
}
export function budgetFrom(text: string) { const m = digits(String(text || "")).match(/(?:تحت|اقل من|أقل من|بـ|ب|ميزانيه|ميزانية)\s*(\d+(?:\.\d+)?)\s*(?:دينار)?/); return m ? Number(m[1]) : null; }
function score(query: string, p: Product) {
  const q = normalize(query); if (!q) return 0;
  const name = normalize(p.name), hay = normalize([p.name, p.category, ...(p.tags || [])].join(" "));
  if (p.barcode && q.replace(/\s/g, "") === p.barcode) return 1;
  if (name === q) return 0.98;
  const tokens = q.split(" ").filter((t) => t.length > 1); if (!tokens.length) return 0;
  const hit = tokens.filter((t) => hay.includes(t) || hay.includes(t.replace(/^ال/, ""))).length;
  return Math.round((hit / tokens.length) * (name.includes(tokens[0].replace(/^ال/, "")) ? 0.9 : 0.7) * 100) / 100;
}
export function compileIntent(text: string, catalog: Product[], stockOf: (p: Product) => number = (p) => p.stock ?? 99): Intent {
  const budget = budgetFrom(text);
  const items: IntentItem[] = splitList(text).map(parseLine).filter((l) => l.query || l.quantity !== null).map((l) => {
    const scored = catalog.map((p) => ({ p, s: score(l.query, p) })).filter((x) => x.s >= 0.45).sort((a, b) => b.s - a.s);
    const best = scored[0];
    if (!best) return { ...l, status: "not_found", confidence: 0, alternatives: [] };
    const available = stockOf(best.p), qty = l.unit && ["kg", "g", "l", "ml"].includes(l.unit) ? 1 : Math.max(1, Math.round(l.quantity || 1));
    return { ...l, status: available < 1 ? "out_of_stock" : best.s >= 0.85 ? "matched" : "ambiguous", confidence: best.s, productId: best.p.id, name: best.p.name, price: best.p.price, available, quantity: qty, alternatives: scored.slice(1, 4).map((x) => ({ productId: x.p.id, name: x.p.name, price: x.p.price, confidence: x.s })) };
  });
  const total = Math.round(items.filter((i) => i.status === "matched").reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0) * 1000) / 1000;
  return { budget, withinBudget: budget == null ? null : total <= budget, total, items };
}
