// "Near you": locate the shopper (with permission), the store's branches by distance with a delivery estimate and
// Google Maps directions, the real map, and the products in stock at the chosen or nearest branch. Both designs use
// it: the classic home shows it as a section, Rafiq's "from my location" mode puts the map on its stage.
import React from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import * as Linking from "expo-linking";
import { Check, ChevronLeft, LocateFixed, MapPin, Navigation } from "lucide-react-native";
import { router } from "expo-router";
import { Button, Txt } from "../ui";
import StoresMap from "./StoresMap";
import { ProductTile } from "./ProductTile";
import { formatDistance, googleMapsDirections } from "../../lib/rafiq";
import type { useNearby } from "../../lib/useNearby";
import type { Product } from "../../data/products";
import { useI18n } from "../../lib/i18n";
import { useTheme } from "../../lib/theme";

type Nearby = ReturnType<typeof useNearby>;

const STATUS_TEXT = {
  idle: "حدّد موقعك لنرتّب الفروع حسب قربها منك ونعرض ما هو متوفر قربك.",
  asking: "نطلب صلاحية الموقع من جهازك…",
  denied: "لم تُمنح صلاحية الموقع. يمكنك تفعيلها من إعدادات الجهاز، أو اختيار فرع من القائمة.",
  unavailable: "تعذّر تحديد موقعك الآن. تأكد من تشغيل خدمة الموقع ثم أعد المحاولة.",
  located: "",
} as const;

export function NearbyStores({ nearby, map = "toggle", mapHeight = 280, onChoose, onAdded }: {
  nearby: Nearby;
  /** "inline" shows the map at once, "toggle" behind a button (lighter home screen), "none" when a parent draws it. */
  map?: "inline" | "toggle" | "none";
  mapHeight?: number;
  onChoose?: (branchId: string) => void;
  onAdded?: (product: Product) => void;
}) {
  const { colors: t } = useTheme();
  const { t: tr, lang } = useI18n();
  const [showMap, setShowMap] = React.useState(map === "inline");
  const choose = (id: string) => { nearby.select(id); onChoose?.(id); };
  const open = (url: string | null) => { if (url) void Linking.openURL(url).catch(() => {}); };
  return (
    <View testID="nearby" style={{ gap: 12 }}>
      {nearby.status !== "located" ? (
        <View testID="locate-card" style={{ flexDirection: "row-reverse", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: t.line, backgroundColor: t.paper }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.orangeSoft, alignItems: "center", justifyContent: "center" }}><MapPin size={20} color={t.orange} /></View>
          <Txt style={{ flex: 1, fontSize: 13, lineHeight: 21, color: t.muted }}>{tr(STATUS_TEXT[nearby.status])}</Txt>
          <View style={{ gap: 6 }}>
            <Button testID="locate-me" title="حدّد موقعي" icon={<LocateFixed size={16} color={t.onAccent} />} busy={nearby.status === "asking"} onPress={() => void nearby.locate()} style={{ minHeight: 42, paddingVertical: 8, paddingHorizontal: 14 }} />
            {nearby.status === "denied" && Platform.OS !== "web" ? <Button title="فتح الإعدادات" secondary onPress={() => void Linking.openSettings().catch(() => {})} style={{ minHeight: 38, paddingVertical: 6, paddingHorizontal: 12 }} /> : null}
          </View>
        </View>
      ) : null}

      {map !== "none" && nearby.branches.length ? (
        showMap ? (
          <View style={{ borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: t.line }}>
            <StoresMap home={nearby.home} branches={nearby.branches} selectedId={nearby.selectedId} onSelect={choose} height={mapHeight} />
          </View>
        ) : (
          <Button testID="show-map" title="عرض الفروع على الخريطة" secondary icon={<MapPin size={16} color={t.ink} />} onPress={() => setShowMap(true)} />
        )
      ) : null}

      {nearby.branches.length ? (
        <View style={{ gap: 8 }}>
          {nearby.branches.slice(0, 6).map((b, i) => {
            const on = b.id === nearby.selectedId;
            const meta = b.km === null || b.eta === null
              ? [b.city, b.hours].filter(Boolean).join(" · ")
              : `${formatDistance(b.km, lang)} · ${tr("توصيل {n} د تقريبًا", { n: b.eta })}${i === 0 && !nearby.selectedId ? ` · ${tr("الأقرب")}` : ""}`;
            return (
              <View key={b.id} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderWidth: on ? 2 : 1, borderColor: on ? t.orange : t.line, backgroundColor: t.paper }}>
                <Pressable testID={`nearby-branch-${b.id}`} accessibilityRole="radio" aria-checked={on} accessibilityLabel={`${b.name}، ${meta}`} onPress={() => choose(b.id)} style={{ flex: 1, flexDirection: "row-reverse", alignItems: "center", gap: 10 }}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: on ? t.orange : t.line, backgroundColor: on ? t.orange : "transparent", alignItems: "center", justifyContent: "center" }}>{on ? <Check size={14} color={t.onAccent} /> : null}</View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt weight="bold" style={{ fontSize: 14 }}>{b.name}</Txt>
                    <Txt style={{ fontSize: 12, color: t.muted }}>{meta}</Txt>
                  </View>
                </Pressable>
                <Pressable testID={`directions-${b.id}`} accessibilityRole="link" accessibilityLabel={tr("الاتجاهات إلى {name} في خرائط Google", { name: b.name })} onPress={() => open(googleMapsDirections(b, nearby.home))}
                  style={({ pressed }) => ({ flexDirection: "row-reverse", alignItems: "center", gap: 6, minHeight: 38, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: t.line, backgroundColor: pressed ? t.secondary : "transparent" })}>
                  <Navigation size={15} color={t.primary} />
                  <Txt weight="medium" style={{ fontSize: 12, color: t.primary }}>{tr("خرائط Google")}</Txt>
                </Pressable>
                <Pressable testID={`branch-details-${b.id}`} accessibilityRole="link" accessibilityLabel={tr("تفاصيل {name}", { name: b.name })} onPress={() => router.navigate({ pathname: "/branch/[id]", params: { id: b.id } })} hitSlop={6}
                  style={({ pressed }) => ({ width: 34, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? t.secondary : "transparent" })}>
                  <ChevronLeft size={18} color={t.muted} />
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : !nearby.loading ? (
        <Txt style={{ fontSize: 13, color: t.muted }}>{tr("لم يحدد المتجر مواقع فروعه على الخريطة بعد.")}</Txt>
      ) : null}

      {nearby.focus && nearby.products.length ? (
        <View testID="nearby-products" style={{ gap: 8 }}>
          <Txt weight="bold" style={{ fontSize: 14 }}>{tr("متوفر الآن في {name}", { name: nearby.focus.name })}</Txt>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {nearby.products.map((p) => <ProductTile key={p.id} product={p} prefix="nearby" onAdded={onAdded} />)}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
