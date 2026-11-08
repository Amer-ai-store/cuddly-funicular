// A branch's own page: where it is, opening hours, phone, distance and delivery estimate from the shopper, directions
// in Google Maps, the map, and the products in stock there with a quick search. "Make it my branch" sets it for orders.
import React, { useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import { CheckCircle2, Clock, MapPin, Navigation, Package, Phone, Search } from "lucide-react-native";
import { Shell } from "../../components/Shell";
import { Button, EmptyState, Row, SectionTitle, Skeleton, StatTile, Txt } from "../../components/ui";
import { ProductGrid } from "../../components/ProductGrid";
import StoresMap from "../../components/rafiq/StoresMap";
import { useApi } from "../../lib/useApi";
import { useStore } from "../../lib/store";
import { useNearby } from "../../lib/useNearby";
import { dialable, formatDistance, googleMapsDirections, placeBranches, type Branch } from "../../lib/rafiq";
import { normalizeArabic } from "../../lib/rafiq";
import { useI18n } from "../../lib/i18n";
import { useTheme } from "../../lib/theme";

export default function BranchScreen() {
  const { colors: t, fonts } = useTheme();
  const { t: tr, lang, isRTL } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const nearby = useNearby();
  const data = useApi<{ branch: Branch; stock: { productId: string; quantity: number }[] }>(id ? `/branches/${encodeURIComponent(String(id))}/stock` : null);
  const [query, setQuery] = useState("");
  const branch = data.data?.branch;
  const placed = useMemo(() => (branch ? placeBranches([branch], nearby.home)[0] : undefined), [branch, nearby.home]);
  const products = useMemo(() => {
    const quantities = new Map((data.data?.stock || []).map((s) => [s.productId, s.quantity]));
    const q = normalizeArabic(query);
    return store.products.filter((p) => p.active !== false && (quantities.get(p.id) ?? 0) > 0 && (!q || normalizeArabic(`${p.name} ${(p.tags || []).join(" ")}`).includes(q)));
  }, [data.data, store.products, query]);
  const mine = store.branchId === branch?.id;
  const phone = dialable(branch?.phone);
  const directions = placed ? googleMapsDirections(placed, nearby.home) : null;

  if (data.error) return <Shell title="الفرع" back testID="branch-screen"><EmptyState title="الفرع غير متاح" detail="ربما أُغلق هذا الفرع أو تغيّر رابطه. اختر فرعًا آخر من المتاجر القريبة." action="المتاجر القريبة" href="/nearby" /></Shell>;
  return (
    <Shell title={branch?.name || "الفرع"} subtitle={branch ? [branch.city, branch.address].filter(Boolean).join(" · ") : undefined} back testID="branch-screen">
      {!branch ? (
        <View style={{ gap: 10 }}><Skeleton height={90} radius={16} /><Skeleton height={220} radius={16} /><Skeleton height={140} radius={16} /></View>
      ) : (
        <>
          <Row gap={8} wrap>
            <StatTile testID="branch-distance" tone="accent" label="المسافة عنك" value={placed && placed.km !== null ? formatDistance(placed.km, lang) : "—"} icon={<MapPin size={16} color={t.orange} />} />
            <StatTile testID="branch-eta" tone="success" label="توصيل تقريبي" value={placed && placed.eta !== null ? tr("{n} د", { n: placed.eta }) : "—"} icon={<Clock size={16} color={t.success} />} />
            <StatTile testID="branch-count" label="منتجات متوفرة" value={String((data.data?.stock || []).filter((s) => s.quantity > 0).length)} icon={<Package size={16} color={t.primary} />} />
          </Row>
          {branch.hours ? <Txt style={{ marginTop: 10, fontSize: 13, color: t.muted }}>{tr("ساعات العمل: {h}", { h: branch.hours })}</Txt> : null}
          <View style={{ gap: 8, marginTop: 14 }}>
            <Button testID="make-my-branch" title={mine ? "هذا فرعك للطلبات" : "اجعله فرعي للطلبات"} disabled={mine} icon={<CheckCircle2 size={18} color={t.onAccent} />} onPress={() => { store.setBranch(branch.id); store.notify(tr("صار {name} فرعك للطلبات", { name: branch.name })); }} />
            <Row gap={8}>
              {directions ? <Button testID="branch-directions" secondary title="الاتجاهات في خرائط Google" icon={<Navigation size={16} color={t.ink} />} onPress={() => void Linking.openURL(directions).catch(() => {})} style={{ flex: 1 }} /> : null}
              {phone ? <Button testID="branch-call" secondary title="اتصل بالفرع" icon={<Phone size={16} color={t.ink} />} onPress={() => void Linking.openURL(`tel:${phone}`).catch(() => {})} style={{ flex: 1 }} /> : null}
            </Row>
          </View>
          {placed ? (
            <View style={{ marginTop: 14, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: t.line }}>
              <StoresMap home={nearby.home} branches={[placed]} selectedId={placed.id} onSelect={() => {}} height={220} />
            </View>
          ) : null}
          <SectionTitle title="متوفر في هذا الفرع" subtitle={tr("{n} منتج", { n: products.length })} />
          <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8, backgroundColor: t.paper, borderRadius: 14, borderWidth: 1, borderColor: t.line, paddingHorizontal: 12, minHeight: 48, marginBottom: 12 }}>
            <Search size={18} color={t.muted} />
            <TextInput testID="branch-search" accessibilityLabel={tr("ابحث في منتجات الفرع")} value={query} onChangeText={setQuery} placeholder={tr("ابحث في منتجات الفرع…")} placeholderTextColor={t.muted} style={{ flex: 1, minWidth: 0, minHeight: 44, color: t.ink, fontFamily: fonts.medium, fontSize: 15, textAlign: isRTL ? "right" : "left" }} />
          </View>
          {products.length ? <ProductGrid items={products} /> : <Txt style={{ color: t.muted, fontSize: 13 }}>{tr(query ? "لا نتائج لهذا البحث في الفرع." : "لا منتجات متوفرة في هذا الفرع الآن.")}</Txt>}
        </>
      )}
    </Shell>
  );
}
