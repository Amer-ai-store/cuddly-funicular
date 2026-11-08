import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Camera, Mic, MicOff, Send, ShoppingCart, VolumeX } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Mascot } from "../components/Robot";
import { ProductImage } from "../components/ProductCard";
import { Button, Chip, Notice, Row, Txt } from "../components/ui";
import { useStore } from "../lib/store";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useMoney } from "../lib/money";
import { useRobot, type RobotMotion } from "../lib/robot";
import { useVoiceInput } from "../lib/voice";
import { api } from "../lib/api";
import { recommendProducts } from "../lib/recommendations";
import type { Product } from "../data/products";

type Basket = { budget: number; total: number; remaining: number; items: { product: Product; quantity: number; lineTotal: number; reason: string }[] };
type Recipe = { id: string; name: string; servings: number; total: number; missing: string[]; ingredients: { ingredient: string; quantity: number; product: Product | null }[] };
type Action = { intent: string; productId?: string; quantity?: number; path?: string; motion?: RobotMotion; label?: string };
type Reply = { intent: string; reply: string; products?: Product[]; basket?: Basket; recipe?: Recipe | null; action?: Action };
type Message = { id: string; role: "user" | "assistant"; text: string; reply?: Reply };
const STARTERS = ["جهز لي سلة بـ ٢٠ دينار", "وصفة كبسة لـ 6 أشخاص", "أضف ٢ حليب للسلة", "وين طلبي؟", "اقترح لي هدية", "يا لقطي ارقص"];

export default function Assistant() {
  const { colors: t } = useTheme();
  const { t: tr, lang, isRTL } = useI18n();
  const money = useMoney();
  const store = useStore();
  const { configured } = useSession();
  const robot = useRobot();
  const voice = useVoiceInput(lang);
  const params = useLocalSearchParams<{ q?: string }>();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ id: "hello", role: "assistant", text: tr("أهلًا! أنا لُقطي 🤖 قل لي ميزانيتك أو وصفتك أو اسم منتج، وأنا أجهز لك كل شي.") }]);
  const scroll = useRef<ScrollView>(null);
  const asked = useRef(false);
  const run = (action?: Action) => {
    if (!action) return;
    if (action.intent === "add_to_cart" && action.productId) store.addToCart(action.productId, action.quantity || 1);
    if (action.intent === "remove_from_cart" && action.productId) store.setQuantity(action.productId, 0);
    if (action.intent === "navigate" && action.path) setTimeout(() => router.push(action.path as never), 600);
    if (action.intent === "track_order") { const active = store.orders.find((o) => !["delivered", "cancelled"].includes(o.status)); setTimeout(() => router.push(active ? `/tracking/${active.id}` : "/orders"), 600); }
    if (action.intent === "robot" && action.motion) robot.play(action.motion, tr("حاضر! 🤖"));
  };
  async function send(text: string) {
    const message = text.trim(); if (!message || busy) return;
    setInput(""); setBusy(true);
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: "user", text: message }]);
    try {
      let reply: Reply;
      if (configured) reply = await api.post<Reply>("/ai/chat", { message });
      else {
        const local = recommendProducts(message, store.products, store.settings.currency);
        const products = local.productIds.map((pid) => store.products.find((p) => p.id === pid)).filter((p): p is Product => !!p);
        reply = { intent: products.length ? "recommendations" : "no_match", reply: local.message || tr("اربط خادم المتجر لتجربة لُقطي الكاملة."), products };
      }
      setMessages((m) => [...m, { id: `a${Date.now()}`, role: "assistant", text: reply.reply, reply }]);
      run(reply.action);
      if (!reply.action || reply.action.intent !== "robot") robot.play(reply.basket || reply.recipe ? "jump" : "talk", "");
      robot.speak(reply.reply);
    } catch (e) {
      setMessages((m) => [...m, { id: `e${Date.now()}`, role: "assistant", text: e instanceof Error ? e.message : tr("حصل خطأ، جرّب مرة ثانية") }]);
      robot.react("error");
    } finally { setBusy(false); setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 100); }
  }
  useEffect(() => { if (params.q && !asked.current) { asked.current = true; void send(params.q); } });
  const listen = () => {
    if (!voice.supported) { setMessages((m) => [...m, { id: `v${Date.now()}`, role: "assistant", text: tr("الأوامر الصوتية مدعومة في المتصفح؛ على الهاتف استخدم ميكروفون لوحة المفاتيح.") }]); return; }
    robot.play("come", tr("أسمعك… 🎙️"));
    voice.start((text) => void send(text));
  };
  const addBasket = (basket: Basket) => store.addManyToCart(Object.fromEntries(basket.items.map((i) => [i.product.id, i.quantity])));
  const addRecipe = (recipe: Recipe) => store.addManyToCart(Object.fromEntries(recipe.ingredients.filter((i) => i.product).map((i) => [i.product!.id, i.quantity])));
  const saveRecipeList = async (recipe: Recipe) => {
    try {
      const created = await api.post<{ list: { id: string } }>("/lists", { name: recipe.name });
      for (const i of recipe.ingredients) await api.post(`/lists/${created.list.id}/items`, i.product ? { productId: i.product.id, quantity: i.quantity } : { title: i.ingredient, quantity: i.quantity });
      router.push(`/list/${created.list.id}`);
    } catch (e) { store.notify(e instanceof Error ? e.message : "سجّل الدخول لحفظ القائمة"); }
  };
  const mini = (p: Product, quantity?: number, note?: string) => (
    <Row key={p.id} style={{ backgroundColor: t.background, borderRadius: 16, padding: 8 }}>
      <Pressable accessibilityRole="button" onPress={() => router.push(`/product/${p.id}`)} style={{ width: 46, height: 46, borderRadius: 12, overflow: "hidden" }}><ProductImage product={p} /></Pressable>
      <View style={{ flex: 1 }}><Txt weight="bold" numberOfLines={1} style={{ fontSize: 13 }}>{quantity ? `${quantity} × ` : ""}{p.name}</Txt><Txt style={{ color: t.muted, fontSize: 11 }}>{money.format(p.price)}{note ? ` · ${tr(note)}` : ""}</Txt></View>
      <Pressable testID={`assistant-add-${p.id}`} accessibilityRole="button" accessibilityLabel={`${tr("أضف إلى السلة")} ${p.name}`} onPress={() => store.addToCart(p.id, quantity || 1)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.primary, alignItems: "center", justifyContent: "center" }}><Txt weight="extra" style={{ color: t.onPrimary, textAlign: "center" }}>+</Txt></Pressable>
    </Row>
  );
  return (
    <Shell title="تسوق بالمحادثة" subtitle="لُقطي يجهز سلتك ووصفاتك ويفهم أوامرك" scroll={false} testID="assistant">
      <View style={{ flex: 1, gap: 10 }}>
        <Row style={{ justifyContent: "center" }}><Mascot size={96} bubble="side" /></Row>
        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 12 }} testID="assistant-messages">
          {messages.map((m) => (
            <View key={m.id} style={{ alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
              <View testID={`bubble-${m.role}`} style={{ maxWidth: "92%", backgroundColor: m.role === "user" ? t.primary : t.paper, borderRadius: 22, borderWidth: m.role === "user" ? 0 : 1, borderColor: t.line, padding: 12, gap: 8 }}>
                <Txt style={{ color: m.role === "user" ? t.onPrimary : t.ink, lineHeight: 22 }}>{m.text}</Txt>
                {m.reply?.basket ? <View style={{ gap: 6 }} testID="basket">
                  {m.reply.basket.items.map((i) => mini(i.product, i.quantity, i.reason))}
                  <Row style={{ justifyContent: "space-between" }}><Txt weight="bold">{tr("المجموع التقديري")}</Txt><Txt weight="extra" style={{ color: t.orange }} testID="basket-total">{money.format(m.reply.basket.total)}</Txt></Row>
                  <Button title={tr("أضف السلة كاملة")} testID="add-basket" icon={<ShoppingCart size={16} color={t.onAccent} />} onPress={() => addBasket(m.reply!.basket!)} />
                </View> : null}
                {m.reply?.recipe ? <View style={{ gap: 6 }} testID="recipe">
                  <Txt weight="bold">{tr("مكونات {r} ({n} أشخاص)", { r: m.reply.recipe.name, n: m.reply.recipe.servings })}</Txt>
                  {m.reply.recipe.ingredients.map((i) => i.product ? mini(i.product, i.quantity) : <Txt key={i.ingredient} style={{ color: t.muted, fontSize: 12 }}>• {i.ingredient} — {tr("غير متوفر")}</Txt>)}
                  <Row><Button title={tr("أضف المكونات للسلة")} testID="add-recipe" onPress={() => addRecipe(m.reply!.recipe!)} style={{ flex: 1 }} /><Button title={tr("احفظها كقائمة")} secondary onPress={() => void saveRecipeList(m.reply!.recipe!)} style={{ flex: 1 }} /></Row>
                </View> : null}
                {m.reply?.products?.length ? <View style={{ gap: 6 }} testID="assistant-products">{m.reply.products.slice(0, 4).map((p) => mini(p))}</View> : null}
              </View>
            </View>
          ))}
          {busy ? <Txt style={{ color: t.muted }}>{tr("لُقطي يفكر…")}</Txt> : null}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
          {STARTERS.map((s) => <Chip key={s} testID={`starter-${s}`} label={s} onPress={() => void send(tr(s))} />)}
        </ScrollView>
        {voice.listening ? <Notice text="أستمع إليك… تكلّم الآن" tone="accent" /> : null}
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 6, backgroundColor: t.paper, borderRadius: 24, borderWidth: 1, borderColor: t.line, padding: 6 }}>
          <Pressable testID="assistant-camera" accessibilityRole="button" accessibilityLabel={tr("بحث بالصورة")} onPress={() => router.push({ pathname: "/explore", params: { mode: "image" } })} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.orangeSoft, alignItems: "center", justifyContent: "center" }}><Camera size={18} color={t.orange} /></Pressable>
          <TextInput testID="assistant-input" accessibilityLabel={tr("اكتب طلبك")} value={input} onChangeText={setInput} onSubmitEditing={() => void send(input)} placeholder={tr("جهز لي سلة بـ ٢٠ دينار…")} placeholderTextColor={t.muted} style={{ flex: 1, minHeight: 42, color: t.ink, fontFamily: "Tajawal_500Medium", textAlign: isRTL ? "right" : "left", paddingHorizontal: 6 }} />
          {robot.speaking ? <Pressable accessibilityRole="button" accessibilityLabel={tr("إيقاف الصوت")} onPress={robot.stopSpeaking} style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" }}><VolumeX size={18} color={t.muted} /></Pressable> : null}
          <Pressable testID="assistant-mic" accessibilityRole="button" accessibilityLabel={tr(voice.listening ? "إيقاف الاستماع" : "أمر صوتي")} onPress={() => (voice.listening ? voice.stop() : listen())} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: voice.listening ? t.orange : t.primarySoft, alignItems: "center", justifyContent: "center" }}>{voice.listening ? <MicOff size={18} color={t.onAccent} /> : <Mic size={18} color={t.primary} />}</Pressable>
          <Pressable testID="assistant-send" accessibilityRole="button" accessibilityLabel={tr("إرسال")} disabled={busy || !input.trim()} onPress={() => void send(input)} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.primary, alignItems: "center", justifyContent: "center", opacity: busy || !input.trim() ? 0.5 : 1 }}><Send size={17} color={t.onPrimary} /></Pressable>
        </View>
      </View>
    </Shell>
  );
}
