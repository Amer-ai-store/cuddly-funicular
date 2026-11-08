import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Banknote, CheckSquare, CreditCard, Square, Wallet, ShieldCheck, Truck, Zap, Store as StoreIcon } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { AddressForm, AddressDraft, addressPayload, addressProblem, draftFrom, emptyAddress } from "../components/AddressForm";
import { Badge, Button, Card, Chip, EmptyState, Field, KeyValue, Notice, Row, Tabs, Toggle, Txt } from "../components/ui";
import { useStore } from "../lib/store";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useMoney } from "../lib/money";
import { useApi } from "../lib/useApi";
import { api } from "../lib/api";
import type { Address } from "../lib/commerce-types";

type Slot = { date: string; window: string; label: string; from: string; to: string; remaining: number; available: boolean };
type DeliveryMode = "standard" | "express" | "pickup";
type DeliveryOptions = {
  express: { available: boolean; reason?: string; fee?: number; etaMinutes?: number; branch?: { id: string; name: string }; distanceKm?: number };
  pickup: { branchId: string; name: string; city?: string; hours?: string; readyInMinutes: number; available: boolean; distanceKm?: number }[];
  tips: number[];
};
type Quote = { subtotal: number; discount: number; couponError: string | null; shipping: number; giftWrapFee: number; total: number; tip?: number; expressFee?: number; deliveryMode?: DeliveryMode; zone: { name: string; etaMinutes: number } | null; tier: string | null; budget: { weeklyBudget: number | null; remaining: number | null; exceeds: boolean } | null };
type Step = "address" | "payment" | "review";
const newKey = () => `checkout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export default function Checkout() {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const money = useMoney();
  const { user, configured } = useSession();
  const store = useStore();
  const params = useLocalSearchParams<{ coupon?: string; mode?: string }>();
  const lines = params.mode === "buy-now" && store.buyNow ? store.buyNow : store.cart;
  const [step, setStep] = useState<Step>("address");
  const addresses = useApi<{ addresses: (Address & { id: string })[] }>("/addresses", { needsUser: true });
  const slots = useApi<{ slots: Slot[] }>("/delivery/slots?days=3");
  const wallet = useApi<{ balance: number }>("/wallet", { needsUser: true });
  const [selected, setSelected] = useState<string | "new">("new");
  const [draft, setDraft] = useState<AddressDraft>(emptyAddress);
  const [saveAddress, setSaveAddress] = useState(true);
  const [slot, setSlot] = useState<{ date: string; window: string } | null>(null);
  const [notes, setNotes] = useState("");
  const [gift, setGift] = useState({ wrap: false, message: "", recipient: "" });
  const [method, setMethod] = useState<"card" | "cod" | "wallet">("cod");
  const [card, setCard] = useState({ number: "", name: "", expiry: "", cvc: "" });
  const [cardToken, setCardToken] = useState<{ token: string; brand: string; last4: string } | null>(null);
  const [terms, setTerms] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("standard");
  const [pickupBranchId, setPickupBranchId] = useState<string | null>(null);
  const [tip, setTip] = useState(0);
  const [options, setOptions] = useState<DeliveryOptions | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const idempotency = useRef(newKey());
  // Pre-select the default saved address once the list arrives (adjusting state while rendering, not in an effect).
  const [seenAddresses, setSeenAddresses] = useState<typeof addresses.data>(null);
  if (addresses.data !== seenAddresses) {
    setSeenAddresses(addresses.data);
    const list = addresses.data?.addresses || [];
    if (list.length && selected === "new" && !draft.name) { const preferred = list.find((a) => a.isDefault) || list[0]; setSelected(preferred.id); setDraft(draftFrom(preferred)); }
  }
  const items = useMemo(() => Object.entries(lines).map(([productId, quantity]) => ({ productId, quantity })), [lines]);
  const giftPayload = gift.wrap || gift.message.trim() ? { wrap: gift.wrap, message: gift.message.trim() || undefined, recipient: gift.recipient.trim() || undefined } : null;
  // Express and pickup depend on the cart and the delivery point; the server decides what is available and its price.
  useEffect(() => {
    let active = true;
    if (!configured || !items.length) return;
    api.post<DeliveryOptions>("/delivery/options", { items, latitude: draft.latitude, longitude: draft.longitude })
      .then((o) => { if (active) setOptions(o); }).catch(() => { if (active) setOptions(null); });
    return () => { active = false; };
  }, [configured, items, draft.latitude, draft.longitude]);
  // A choice the server no longer offers falls back to standard delivery (adjusting state while rendering).
  const [seenOptions, setSeenOptions] = useState<DeliveryOptions | null>(null);
  if (options !== seenOptions) {
    setSeenOptions(options);
    if (deliveryMode === "express" && !options?.express.available) setDeliveryMode("standard");
    if (deliveryMode === "pickup" && !options?.pickup.some((b) => b.branchId === pickupBranchId && b.available)) { setDeliveryMode("standard"); setPickupBranchId(null); }
  }
  const fulfillment = { deliveryMode, pickupBranchId: deliveryMode === "pickup" ? pickupBranchId || undefined : undefined, tip: deliveryMode === "pickup" ? 0 : tip };
  useEffect(() => {
    let active = true;
    if (!configured || !items.length) return;
    if (deliveryMode === "pickup" && !pickupBranchId) return;
    api.post<Quote>("/checkout/quote", { items, couponCode: params.coupon || undefined, address: { city: draft.city, latitude: draft.latitude, longitude: draft.longitude }, deliverySlot: slot || undefined, gift: giftPayload || undefined, ...fulfillment })
      .then((q) => { if (active) { setQuote(q); setError(""); } }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "تعذر حساب الطلب"); });
    return () => { active = false; };
  }, [configured, items, params.coupon, draft.city, draft.latitude, draft.longitude, slot, gift.wrap, deliveryMode, pickupBranchId, tip]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!user) return <Shell title="إتمام الطلب"><EmptyState title="سجّل الدخول أولًا" detail="نحتاج حسابك لحفظ العنوان ومتابعة الطلب." action="تسجيل الدخول" href="/login" /></Shell>;
  if (!items.length) return <Shell title="إتمام الطلب"><EmptyState title="لا توجد منتجات للطلب" detail="أضف منتجات إلى السلة أولًا." /></Shell>;
  const productName = (id: string) => store.products.find((p) => p.id === id)?.name || id;
  const days = [...new Set((slots.data?.slots || []).map((s) => s.date))];
  async function toPayment() {
    setError("");
    const problem = addressProblem(draft); if (problem) { setError(problem); return; }
    if (deliveryMode === "pickup" && !pickupBranchId) { setError(tr("اختر الفرع الذي ستستلم منه")); return; }
    if (selected === "new" && saveAddress && configured) {
      try { const created = await api.post<{ address: Address & { id: string } }>("/addresses", addressPayload(draft)); setSelected(created.address.id); addresses.reload(); } catch (e) { setError(e instanceof Error ? e.message : "تعذر حفظ العنوان"); return; }
    }
    setStep("payment");
  }
  async function toReview() {
    setError("");
    if (method === "card" && !cardToken) {
      const [month, year] = card.expiry.split("/").map((v) => Number(v.trim()));
      setBusy(true);
      try {
        const token = await api.post<{ token: string; brand: string; last4: string }>("/payments/card/tokenize", { number: card.number, name: card.name, expMonth: month, expYear: year, cvc: card.cvc });
        setCardToken(token); setCard({ number: "", name: "", expiry: "", cvc: "" });
      } catch (e) { setError(e instanceof Error ? e.message : "تعذر التحقق من البطاقة"); setBusy(false); return; }
      setBusy(false);
    }
    if (method === "wallet" && quote && (wallet.data?.balance ?? 0) < quote.total) { setError("رصيد المحفظة غير كافٍ لهذا الطلب"); return; }
    setStep("review");
  }
  async function confirm() {
    setBusy(true); setError("");
    try {
      const order = await store.submitOrder({ items: lines, checkoutMode: params.mode === 'buy-now' && store.buyNow ? 'buy-now' : 'cart', address: addressPayload(draft) as Address, paymentMethod: method, couponCode: params.coupon || undefined, idempotencyKey: idempotency.current, ...fulfillment, deliverySlot: slot, deliveryNotes: notes.trim() || undefined, gift: giftPayload, acceptTerms: terms, cardToken: cardToken?.token });
      router.replace({ pathname: "/order/[id]", params: { id: order.id, placed: "1" } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إنشاء الطلب");
      if (method === "card") setCardToken(null);
    } finally { setBusy(false); }
  }
  return (
    <Shell title={step === "address" ? "وين نوصلك؟" : step === "payment" ? "طريقة الدفع" : "مراجعة الطلب"} subtitle={params.mode === "buy-now" ? "شراء مباشر" : undefined} back testID="checkout-screen">
      <Tabs testID="checkout-steps" value={step} onChange={(next) => { if (next === "address" || (next === "payment" && step === "review")) setStep(next); }} tabs={[{ id: "address", label: "١ العنوان" }, { id: "payment", label: "٢ الدفع" }, { id: "review", label: "٣ المراجعة" }]} />
      {error ? <View style={{ marginTop: 10 }}><Notice text={error} tone="danger" /></View> : null}

      {step === "address" ? (
        <View style={{ gap: 14, marginTop: 14 }}>
          {addresses.data?.addresses?.length ? (
            <Card style={{ gap: 8 }}>
              <Txt weight="bold">{tr("عناويني المحفوظة")}</Txt>
              <Row wrap>{addresses.data.addresses.map((a) => <Chip key={a.id} testID={`saved-address-${a.id}`} label={`${a.label || a.city} · ${a.street}`} active={selected === a.id} onPress={() => { setSelected(a.id); setDraft(draftFrom(a)); }} />)}<Chip label="+ عنوان جديد" active={selected === "new"} onPress={() => { setSelected("new"); setDraft(emptyAddress); }} /></Row>
            </Card>
          ) : null}
          <Card><AddressForm value={draft} onChange={(next) => { setDraft(next); if (selected !== "new") setSelected("new"); }} /></Card>
          {selected === "new" ? <Toggle label="احفظ العنوان لطلباتي القادمة" value={saveAddress} onChange={setSaveAddress} /> : null}
          <Card style={{ gap: 10 }} testID="fulfillment">
            <Txt weight="bold">{tr("طريقة الاستلام")}</Txt>
            {([
              ["standard", "توصيل عادي", Truck, quote?.zone ? tr("حسب منطقة {z}", { z: quote.zone.name }) : tr("في الموعد الذي تختاره"), true],
              ["express", "توصيل سريع", Zap, options?.express.available ? tr("+{m} · خلال {n} دقيقة تقريبًا من {b}", { m: money.format(options.express.fee || 0), n: options.express.etaMinutes || 0, b: options.express.branch?.name || "" }) : options?.express.reason || tr("حدّد موقع التوصيل على الخريطة لمعرفة التوصيل السريع"), !!options?.express.available],
              ["pickup", "استلام من الفرع", StoreIcon, tr("بلا رسوم توصيل، جاهز خلال {n} دقيقة", { n: options?.pickup[0]?.readyInMinutes || 30 }), !!options?.pickup.some((b) => b.available)],
            ] as const).map(([mode, label, Icon, detail, enabled]) => {
              const on = deliveryMode === mode;
              return (
                <Pressable key={mode} testID={`mode-${mode}`} accessibilityRole="radio" aria-checked={on} aria-disabled={!enabled} disabled={!enabled} accessibilityLabel={tr(label)} onPress={() => setDeliveryMode(mode)}
                  style={{ flexDirection: "row-reverse", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, borderWidth: on ? 2 : 1, borderColor: on ? t.primary : t.line, backgroundColor: on ? t.primarySoft : t.paper, opacity: enabled ? 1 : 0.55 }}>
                  <Icon size={20} color={on ? t.primary : t.muted} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt weight="bold" style={{ fontSize: 14 }}>{tr(label)}</Txt>
                    <Txt style={{ fontSize: 12, color: t.muted }}>{detail}</Txt>
                  </View>
                </Pressable>
              );
            })}
            {deliveryMode === "pickup" ? (
              <View testID="pickup-branches"><Row wrap>
                {(options?.pickup || []).map((b) => (
                  <Chip key={b.branchId} testID={`pickup-${b.branchId}`} active={pickupBranchId === b.branchId} onPress={() => b.available && setPickupBranchId(b.branchId)}
                    label={`${b.name}${b.distanceKm !== undefined ? ` · ${b.distanceKm} ${tr("كم")}` : ""}${b.available ? "" : ` · ${tr("غير متوفر كاملًا")}`}`} />
                ))}
              </Row></View>
            ) : (
              <View style={{ gap: 6 }} testID="tips">
                <Txt style={{ fontSize: 13 }}>{tr("إكرامية للسائق (اختيارية)")}</Txt>
                <Row wrap>{(options?.tips || [0, 0.5, 1, 2]).map((v) => <Chip key={v} testID={`tip-${v}`} label={v ? money.format(v) : tr("بدون")} active={tip === v} onPress={() => setTip(v)} />)}</Row>
              </View>
            )}
          </Card>
          <Card style={{ gap: 10 }} testID="slots">
            <Txt weight="bold">{tr("موعد التوصيل")}</Txt>
            {days.map((date) => (
              <View key={date} style={{ gap: 6 }}>
                <Txt style={{ color: t.muted, fontSize: 12 }}>{new Date(`${date}T12:00:00Z`).toLocaleDateString("ar-JO", { weekday: "long", day: "numeric", month: "long" })}</Txt>
                <Row wrap>{slots.data!.slots.filter((s) => s.date === date).map((s) => <Chip key={`${s.date}-${s.window}`} testID={`slot-${s.date}-${s.window}`} label={`${s.label} ${s.from}–${s.to}${s.available ? "" : ` · ${tr(s.remaining ? "مغلق" : "ممتلئ")}`}`} active={slot?.date === s.date && slot?.window === s.window} onPress={s.available ? () => setSlot({ date: s.date, window: s.window }) : undefined} />)}</Row>
              </View>
            ))}
            {!configured ? <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("المواعيد تظهر عند الاتصال بخادم المتجر.")}</Txt> : null}
            {slot ? <Chip label="أقرب وقت متاح بدل الموعد" onPress={() => setSlot(null)} /> : null}
          </Card>
          <Field label="ملاحظات للسائق" testID="delivery-notes" value={notes} onChangeText={setNotes} placeholder={tr("اتصل قبل الوصول، الباب الخلفي…")} multiline />
          <Card style={{ gap: 8 }}>
            <Toggle testID="gift-wrap" label="تغليف هدية 🎁" detail={tr("رسوم {m}", { m: money.format(store.settings.giftWrapFee ?? 1.5) })} value={gift.wrap} onChange={(wrap) => setGift((g) => ({ ...g, wrap }))} />
            {gift.wrap ? <><Field label="رسالة الهدية" testID="gift-message" value={gift.message} onChangeText={(message) => setGift((g) => ({ ...g, message }))} maxLength={200} /><Field label="اسم المُهدى إليه" value={gift.recipient} onChangeText={(recipient) => setGift((g) => ({ ...g, recipient }))} /></> : null}
          </Card>
          <Button title={tr("متابعة للدفع")} testID="to-payment" onPress={() => void toPayment()} />
        </View>
      ) : null}

      {step === "payment" ? (
        <View style={{ gap: 12, marginTop: 14 }}>
          {([["card", "بطاقة ائتمان", CreditCard], ["cod", "الدفع عند الاستلام", Banknote], ["wallet", "رصيد المحفظة", Wallet]] as const).map(([id, label, Icon]) => (
            <Card key={id} onPress={() => setMethod(id)} testID={`pay-${id}`} accessibilityLabel={tr(label)} style={{ borderColor: method === id ? t.primary : t.line, borderWidth: method === id ? 2 : 1 }}>
              <Row><Icon size={22} color={method === id ? t.primary : t.muted} /><Txt weight="bold" style={{ flex: 1 }}>{tr(label)}</Txt>{id === "wallet" && wallet.data ? <Badge label={money.format(wallet.data.balance)} /> : null}{method === id ? <Badge label="مختار" tone="success" /> : null}</Row>
            </Card>
          ))}
          {method === "card" ? (
            <Card style={{ gap: 10 }} testID="card-form">
              <Notice text="وضع تجريبي — لا خصم فعلي. استخدم بطاقة الاختبار 4242 4242 4242 4242." tone="warning" />
              {cardToken ? <Row><ShieldCheck size={18} color={t.success} /><Txt style={{ flex: 1 }}>{tr("بطاقة {b} تنتهي بـ {l} جاهزة", { b: cardToken.brand.toUpperCase(), l: cardToken.last4 })}</Txt><Chip label="تغيير" onPress={() => setCardToken(null)} /></Row> : <>
                <Field label="رقم البطاقة" testID="card-number" value={card.number} onChangeText={(number) => setCard((c) => ({ ...c, number }))} keyboardType="number-pad" placeholder="4242 4242 4242 4242" autoComplete="cc-number" />
                <Field label="الاسم على البطاقة" testID="card-name" value={card.name} onChangeText={(name) => setCard((c) => ({ ...c, name }))} autoComplete="cc-name" />
                <Row style={{ alignItems: "flex-start" }}>
                  <View style={{ flex: 1 }}><Field label="تاريخ الانتهاء" testID="card-expiry" value={card.expiry} onChangeText={(expiry) => setCard((c) => ({ ...c, expiry }))} placeholder="12/29" /></View>
                  <View style={{ flex: 1 }}><Field label="رمز التحقق" testID="card-cvc" value={card.cvc} onChangeText={(cvc) => setCard((c) => ({ ...c, cvc }))} keyboardType="number-pad" secureTextEntry maxLength={4} /></View>
                </Row>
                <Txt style={{ color: t.muted, fontSize: 11 }}>{tr("لا نحفظ رقم البطاقة ولا رمز التحقق؛ نحتفظ بآخر أربعة أرقام فقط.")}</Txt>
              </>}
            </Card>
          ) : null}
          <Button title={tr("مراجعة الطلب")} testID="to-review" busy={busy} onPress={() => void toReview()} />
        </View>
      ) : null}

      {step === "review" ? (
        <View style={{ gap: 12, marginTop: 14 }}>
          <Card style={{ gap: 6 }}>
            <Row style={{ justifyContent: "space-between" }}><Txt weight="bold">{tr("العنوان")}</Txt><Pressable accessibilityRole="button" onPress={() => setStep("address")}><Txt style={{ color: t.primary }}>{tr("تعديل")}</Txt></Pressable></Row>
            <Txt style={{ color: t.muted }}>{[draft.name, draft.city, draft.district, draft.street, draft.building].filter(Boolean).join("، ")}</Txt>
            <Row style={{ justifyContent: "space-between" }}><Txt weight="bold">{tr("الموعد")}</Txt><Pressable accessibilityRole="button" onPress={() => setStep("address")}><Txt style={{ color: t.primary }}>{tr("تعديل")}</Txt></Pressable></Row>
            <Txt style={{ color: t.muted }} testID="review-slot">{slot ? `${slots.data?.slots.find((s) => s.date === slot.date && s.window === slot.window)?.label || ""} · ${slot.date}` : quote?.zone ? tr("أقرب وقت (حوالي {h} ساعة)", { h: Math.round(quote.zone.etaMinutes / 60) }) : tr("أقرب وقت متاح")}</Txt>
            <Row style={{ justifyContent: "space-between" }}><Txt weight="bold">{tr("الدفع")}</Txt><Pressable accessibilityRole="button" onPress={() => setStep("payment")}><Txt style={{ color: t.primary }}>{tr("تعديل")}</Txt></Pressable></Row>
            <Txt style={{ color: t.muted }}>{method === "card" && cardToken ? `${cardToken.brand.toUpperCase()} •••• ${cardToken.last4} (${tr("تجريبي")})` : tr(method === "cod" ? "الدفع عند الاستلام" : method === "wallet" ? "رصيد المحفظة" : "بطاقة ائتمان")}</Txt>
            {notes ? <Txt style={{ color: t.muted, fontSize: 12 }}>📝 {notes}</Txt> : null}
            {gift.wrap ? <Txt style={{ color: t.muted, fontSize: 12 }}>🎁 {gift.message || tr("تغليف هدية")}</Txt> : null}
          </Card>
          <Card testID="review-summary">
            {items.map((i) => <KeyValue key={i.productId} label={`${productName(i.productId)} × ${i.quantity}`} value={money.format((store.products.find((p) => p.id === i.productId)?.price || 0) * i.quantity)} />)}
            <View style={{ height: 1, backgroundColor: t.line, marginVertical: 6 }} />
            <KeyValue label="المجموع الفرعي" value={money.format(quote?.subtotal ?? 0)} />
            {quote?.discount ? <KeyValue label="الخصم" value={`- ${money.format(quote.discount)}`} /> : null}
            <KeyValue testID="review-delivery" label={deliveryMode === "pickup" ? tr("استلام من {b}", { b: options?.pickup.find((b) => b.branchId === pickupBranchId)?.name || "" }) : deliveryMode === "express" ? tr("توصيل سريع (~{n} دقيقة)", { n: options?.express.etaMinutes || 0 }) : quote?.zone ? tr("التوصيل ({z})", { z: quote.zone.name }) : "التوصيل"} value={money.format(quote?.shipping ?? 0)} />
            {quote?.tip ? <KeyValue testID="review-tip" label="إكرامية السائق" value={money.format(quote.tip)} /> : null}
            {quote?.tier && quote.tier !== "bronze" ? <Txt style={{ color: t.success, fontSize: 12 }}>{tr("ميزة عضويتك طُبّقت على التوصيل")}</Txt> : null}
            {quote?.giftWrapFee ? <KeyValue label="تغليف الهدية" value={money.format(quote.giftWrapFee)} /> : null}
            <KeyValue label="الإجمالي" value={money.format(quote?.total ?? 0)} strong testID="review-total" />
          </Card>
          {quote?.budget?.exceeds ? <Notice text={tr("هذا الطلب يتجاوز ميزانيتك الأسبوعية (المتبقي {m})", { m: money.format(quote.budget.remaining ?? 0) })} tone="warning" /> : null}
          <Pressable testID="accept-terms" accessibilityRole="checkbox" aria-checked={terms} onPress={() => setTerms((v) => !v)} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10, minHeight: 44 }}>
            {terms ? <CheckSquare size={22} color={t.primary} /> : <Square size={22} color={t.muted} />}
            <Txt style={{ flex: 1 }}>{tr("أوافق على الشروط والأحكام وسياسة الإرجاع")}</Txt>
          </Pressable>
          <Button title={tr("تأكيد الطلب")} testID="confirm-order" busy={busy} disabled={!terms || !quote} onPress={() => void confirm()} />
        </View>
      ) : null}
    </Shell>
  );
}
