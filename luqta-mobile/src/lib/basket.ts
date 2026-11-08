// "جهّز لي سلة بـ 20 دينار" — builds a suggested basket within a budget from the
// current catalogue. Suggestions only: nothing is added to the cart until the user taps
// "أضف" / "راجع السلة المقترحة", and nothing is ordered without the checkout confirm.
import type { Product } from "../data/products.ts";
import { normalizeSearch } from "./recommendations.ts";

export type BasketLine = { productId: string; quantity: number; price: number };
export type BasketSuggestion = { budget: number; lines: BasketLine[]; total: number; message: string };

const ESSENTIALS = ["rice", "milk", "banana", "أرز", "حليب", "موز", "خبز", "بيض", "سكر", "زيت", "شاي", "معكرونة"];
const AR = "٠١٢٣٤٥٦٧٨٩";
const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)));

export function parseBasketRequest(prompt: string): { budget: number } | null {
  const text = normalizeSearch(toLatin(prompt));
  if (!/(سله|سلة|basket|اساسيات|أساسيات|جهز|جهزلي|حضر)/.test(text) && !/سل[ةه]/.test(prompt)) return null;
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:دينار|د ا|دا|jod|jd)?/);
  if (!m) return null;
  const budget = Number(m[1].replace(",", "."));
  return Number.isFinite(budget) && budget > 0 && budget <= 10000 ? { budget } : null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function buildBasket(budget: number, catalogue: Product[], maxPerItem = 3): BasketSuggestion {
  const rank = (p: Product) => {
    const hay = `${p.id} ${p.name} ${p.tags.join(" ")}`.toLowerCase();
    const i = ESSENTIALS.findIndex((k) => hay.includes(k.toLowerCase()));
    return i === -1 ? (p.category === "grocery" ? 50 : 100) : i;
  };
  const pool = catalogue
    .filter((p) => !p.variantOf && !p.hasVariants && p.active !== false && (p.stock === undefined || p.stock > 0) && p.price > 0 && p.price <= budget)
    .sort((a, b) => rank(a) - rank(b) || a.price - b.price);
  const essentials = pool.filter((p) => rank(p) < 100);
  const source = essentials.length ? essentials : pool;
  const lines: BasketLine[] = [];
  let total = 0;
  // pass 1: one of each essential; pass 2+: add quantities round-robin while within budget
  for (let round = 0; round < maxPerItem; round++) {
    let added = false;
    for (const p of source) {
      const line = lines.find((l) => l.productId === p.id);
      const qty = line ? line.quantity : 0;
      if (qty !== round) continue;
      if (p.stock !== undefined && qty + 1 > p.stock) continue;
      if (round3(total + p.price) > budget) continue;
      total = round3(total + p.price);
      if (line) line.quantity++; else lines.push({ productId: p.id, quantity: 1, price: p.price });
      added = true;
    }
    if (!added) break;
  }
  const message = lines.length
    ? `حسنًا! اخترت لك منتجات أساسية من المتجر لتحقيق أفضل قيمة وبما يناسب ميزانيتك ${budget} دينار.`
    : `لم أجد منتجات متوفرة ضمن ميزانية ${budget} دينار. جرّب ميزانية أعلى.`;
  return { budget, lines, total, message };
}
