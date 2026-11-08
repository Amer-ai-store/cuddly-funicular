// Product page additions from the Aura app: live flash-sale countdown, freshness badge,
// "frequently bought together" (real orders) and view/share tracking for «الرائج».
import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { Sparkles, Timer } from "lucide-react-native";
import { Txt } from "../ui";
import { Card, Chip, SectionHeader } from "../design/kit";
import { MiniProductCard } from "../ProductCard";
import { api } from "../../lib/api";
import { track } from "../../lib/analytics";
import { useSession } from "../../lib/session";
import { useStore } from "../../lib/store";
import { countdown, freshness } from "../../lib/smart";
import { useTheme } from "../../lib/theme";
import type { Product } from "../../data/products";

export function useCountdown(iso?: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!iso) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [iso]);
  return countdown(iso, now);
}

export function FlashBadges({ product }: { product: Product }) {
  const left = useCountdown(product.offerEndsAt);
  const [now] = useState(() => Date.now());
  const f = freshness(product.expiresAt, now);
  if (!left && !f) return null;
  return (
    <View style={{ flexDirection: "row-reverse", gap: 6, flexWrap: "wrap", marginTop: 6 }} testID="flash-badges">
      {left ? <Chip label={`ينتهي العرض خلال ${left}`} tone="warn" icon={Timer} /> : null}
      {f ? <Chip label={f.state === "expired" ? "منتهي الصلاحية" : f.state === "soon" ? `صالح ${f.days} يوم — طازج` : `صالح حتى ${new Date(product.expiresAt as string).toLocaleDateString("ar")}`} tone={f.state === "expired" ? "warn" : "success"} /> : null}
    </View>
  );
}

export function useProductEvents(productId?: string) {
  const { configured } = useSession();
  useEffect(() => { if (configured && productId) { void api.post(`/products/${productId}/event`, { kind: "view" }).catch(() => {}); track("view_product"); } }, [configured, productId]);
  return (kind: "share") => { if (configured && productId) { void api.post(`/products/${productId}/event`, { kind }).catch(() => {}); track("share"); } };
}

export function TogetherSection({ product }: { product: Product }) {
  const { colors: t } = useTheme();
  const { configured } = useSession();
  const { products } = useStore();
  const local = useMemo(() => products.filter((p) => p.id !== product.id && p.category !== product.category).sort((a, b) => b.rating - a.rating).slice(0, 6), [products, product.id, product.category]);
  const [remote, setRemote] = useState<{ items: Product[]; source: "orders" | "category" } | null>(null);
  useEffect(() => {
    let active = true;
    if (!configured) return;
    api.get<{ source: "orders" | "category"; products: Product[] }>(`/products/${product.id}/together`).then((r) => { if (active) setRemote({ items: r.products.map((p) => products.find((x) => x.id === p.id) || p), source: r.source }); }).catch(() => { if (active) setRemote(null); });
    return () => { active = false; };
  }, [product.id, configured, products]);
  const items = configured && remote ? remote.items : local;
  const source: "orders" | "category" | "local" = configured && remote ? remote.source : "local";
  if (!items.length) return null;
  return (
    <Card style={{ marginTop: 14 }} testID="together">
      <SectionHeader title={source === "orders" ? "يُشترى عادةً معًا" : "قد يعجبك أيضًا"} icon={Sparkles} />
      {source === "orders" ? <Txt style={{ color: t.muted, fontSize: 12, marginBottom: 6 }}>من طلبات عملاء لُقطة الفعلية</Txt> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, flexDirection: "row-reverse" }}>
        {items.map((p) => <MiniProductCard key={p.id} product={p} width={140} />)}
      </ScrollView>
    </Card>
  );
}
