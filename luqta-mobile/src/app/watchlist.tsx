// "تنبيهات الأسعار" — products the customer tracks with a target price (server trigger notifies).
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { BellRing, Trash2 } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Txt } from "../components/ui";
import { AccountGate } from "../components/AccountKit";
import { Card, Chip, CTA, ErrorBlock, InfoNote, LoadingBlock } from "../components/design/kit";
import { useMoney } from "../components/smart/Bits";
import { ProductImage } from "../components/ProductCard";
import { useStore } from "../lib/store";
import { useRemote } from "../lib/useRemote";
import { api } from "../lib/api";
import type { Watch } from "../lib/smart";
import { useTheme } from "../lib/theme";

export default function WatchlistScreen() {
  return <Shell title="تنبيهات الأسعار" subtitle="نخبرك فور وصول السعر إلى هدفك"><AccountGate><WatchBody /></AccountGate></Shell>;
}
function WatchBody() {
  const { colors: t } = useTheme();
  const money = useMoney();
  const { products, notify } = useStore();
  const { data, setData, loading, error, reload } = useRemote<{ watches: Watch[] }>("/watchlist", { auth: true });
  const [busy, setBusy] = useState("");
  async function remove(id: string) {
    setBusy(id);
    try { await api.delete(`/watchlist/${id}`); setData((d) => (d ? { watches: d.watches.filter((w) => w.productId !== id) } : d)); notify("أُلغيت المتابعة"); }
    catch (e) { notify(e instanceof Error ? e.message : "تعذّر الإلغاء"); } finally { setBusy(""); }
  }
  if (loading && !data) return <LoadingBlock />;
  if (!data) return <ErrorBlock message={error || "تعذّر التحميل"} onRetry={reload} />;
  if (!data.watches.length) return (
    <Card style={{ alignItems: "center", gap: 10 }}>
      <BellRing size={44} color={t.orange} />
      <Txt weight="bold" style={{ fontSize: 19, color: t.title }}>لا تتابع أي منتج بعد</Txt>
      <Txt style={{ color: t.muted, textAlign: "center" }}>افتح أي منتج واضغط «تابع السعر» وحدد السعر الذي تنتظره.</Txt>
      <CTA title="تصفّح المنتجات" onPress={() => router.navigate("/explore")} style={{ alignSelf: "stretch" }} />
    </Card>
  );
  return (
    <View style={{ gap: 10 }} testID="watchlist">
      {data.watches.map((w) => {
        const p = products.find((x) => x.id === w.productId);
        return (
          <Card key={w.productId} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={w.name} onPress={() => router.push(`/product/${w.productId}`)} style={{ width: 60, height: 68 }}>{p ? <ProductImage product={p} /> : null}</Pressable>
            <View style={{ flex: 1, alignItems: "flex-end", gap: 3 }}>
              <Txt weight="bold" numberOfLines={2} style={{ color: t.title }}>{w.name}</Txt>
              <Txt style={{ color: t.muted }}>الحالي {money(w.price)} · الهدف {money(w.target)}</Txt>
              {w.reached ? <Chip label="وصل للهدف" tone="success" /> : <Chip label="بانتظار الانخفاض" tone="info" />}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`إلغاء متابعة ${w.name}`} disabled={busy === w.productId} onPress={() => void remove(w.productId)} hitSlop={8}><Trash2 size={24} color={t.orange} /></Pressable>
          </Card>
        );
      })}
      <InfoNote text="يُرسل التنبيه مرة واحدة عند وصول السعر لهدفك، ويظهر في الإشعارات." />
    </View>
  );
}
