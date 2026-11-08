// Pure checkout helpers (no React Native imports — unit tested in checkout.test.mjs).
export const DEMO_COUPON = { code: "LUQTA1", discount: 1 };
export const cartSignatureOf = (cart: Record<string, number>) => JSON.stringify(Object.entries(cart).sort(([a], [b]) => a.localeCompare(b)));
/** Unique key so a retried confirm never creates a second order on the server. */
export const newIdempotencyKey = () => `app-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Luhn check used only to validate the demo card form; card data is never stored or sent. */
export function luhnValid(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
export function expiryValid(input: string, now = new Date()): boolean {
  const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(input.trim());
  if (!m) return false;
  const month = Number(m[1]), year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return false;
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);
}
export const formatCardNumber = (v: string) => v.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
export const maskCard = (v: string) => { const d = v.replace(/\D/g, ""); return d.length >= 4 ? `**** ${d.slice(-4)}` : ""; };

export type Totals = { subtotal: number; discount: number; shipping: number; total: number };
export function computeTotals(subtotal: number, discount: number, shippingFee: number, freeThreshold: number): Totals {
  const sub = round3(Math.max(0, subtotal));
  const disc = round3(Math.min(Math.max(0, discount), sub));
  const shipping = sub === 0 || sub >= freeThreshold ? 0 : round3(shippingFee);
  return { subtotal: sub, discount: disc, shipping, total: round3(sub - disc + shipping) };
}

/** An order may only be confirmed when every safety condition holds. */
export function canConfirmOrder(input: { termsAccepted: boolean; hasAddress: boolean; cartChecked: boolean; cartOk: boolean; paymentSupported: boolean; busy: boolean }): { ok: boolean; reason?: string } {
  if (input.busy) return { ok: false, reason: "جارٍ التنفيذ" };
  if (!input.hasAddress) return { ok: false, reason: "أضف عنوان التوصيل" };
  if (!input.paymentSupported) return { ok: false, reason: "طريقة الدفع غير متاحة للطلبات الحقيقية" };
  if (!input.cartChecked) return { ok: false, reason: "يجب التحقق من السعر والمخزون أولًا" };
  if (!input.cartOk) return { ok: false, reason: "تغيّر السعر أو المخزون؛ راجع السلة" };
  if (!input.termsAccepted) return { ok: false, reason: "وافق على الشروط والأحكام" };
  return { ok: true };
}
