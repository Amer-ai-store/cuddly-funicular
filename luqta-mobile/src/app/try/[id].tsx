import React, { useCallback, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Box, Home, RotateCcw, RotateCw, ZoomIn, ZoomOut, Undo2 } from "lucide-react-native";
import { Shell } from "../../components/Shell";
import { Viewer3D, type Viewer3DHandle } from "../../components/Viewer3D";
import { Button, Card, EmptyState, IconButton, Notice, Row, Tabs, Txt } from "../../components/ui";
import { useStore } from "../../lib/store";
import { useTheme } from "../../lib/theme";
import { useI18n } from "../../lib/i18n";
import { useMoney } from "../../lib/money";
import { defaultModel, type ViewerEvent } from "../../lib/viewer3d";

export default function TryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const money = useMoney();
  const { products, addToCart } = useStore();
  const product = products.find((p) => p.id === id);
  const viewer = useRef<Viewer3DHandle>(null);
  const [mode, setMode] = useState<"3d" | "room">("3d");
  const [status, setStatus] = useState({ ready: false, zoom: 1, ar: false, error: "" });
  const spec = useMemo(() => product?.model3d ?? defaultModel(product?.category || ""), [product?.model3d, product?.category]);
  const onEvent = useCallback((event: ViewerEvent) => {
    if (event.type === "ready") setStatus((s) => ({ ...s, ready: true }));
    if (event.type === "zoom" || event.type === "state") setStatus((s) => ({ ...s, zoom: event.zoom ?? s.zoom, ar: event.ar ?? s.ar }));
    if (event.type === "ar") setStatus((s) => ({ ...s, ar: !!event.active, error: "" }));
    if (event.type === "ar-error") { setMode("3d"); setStatus((s) => ({ ...s, ar: false, error: event.message === "permission" || event.message === "NotAllowedError" ? "اسمح باستخدام الكاميرا لرؤية المنتج في غرفتك." : "الكاميرا غير متاحة على هذا الجهاز؛ جرّب العرض ثلاثي الأبعاد." })); }
    if (event.type === "error") setStatus((s) => ({ ...s, error: "جهازك لا يدعم العرض ثلاثي الأبعاد." }));
  }, []);
  if (!product) return <Shell title="جرّب قبل ما تختار"><EmptyState title="المنتج غير متاح" detail="ارجع إلى المتجر واختر منتجًا." /></Shell>;
  const switchMode = (next: "3d" | "room") => { setMode(next); viewer.current?.command(next === "room" ? "ar-on" : "ar-off"); };
  return (
    <Shell title="جرّب قبل ما تختار" subtitle={product.name} back robot={mode === "room" ? "حرّكه بإصبعك لمكانه 👆" : "لفّه وكبّره بإصبعك"} testID="try">
      <Tabs testID="try-mode" value={mode} onChange={switchMode} tabs={[{ id: "3d", label: "ثلاثي الأبعاد" }, { id: "room", label: "في غرفتي" }]} />
      <View style={{ marginTop: 12 }}>
        <Viewer3D ref={viewer} spec={spec} onEvent={onEvent} height={360} />
      </View>
      <Row style={{ justifyContent: "center", marginTop: 12 }}>
        <IconButton testID="rotate-left" label="تدوير لليسار" icon={<RotateCcw size={18} color={t.ink} />} onPress={() => viewer.current?.command("rotate-left")} />
        <IconButton testID="zoom-out" label="تصغير" icon={<ZoomOut size={18} color={t.ink} />} onPress={() => viewer.current?.command("zoom-out")} />
        <IconButton testID="reset-view" label="إعادة الضبط" tone="primary" icon={<Undo2 size={18} color={t.onPrimary} />} onPress={() => viewer.current?.command("reset")} />
        <IconButton testID="zoom-in" label="تكبير" icon={<ZoomIn size={18} color={t.ink} />} onPress={() => viewer.current?.command("zoom-in")} />
        <IconButton testID="rotate-right" label="تدوير لليمين" icon={<RotateCw size={18} color={t.ink} />} onPress={() => viewer.current?.command("rotate-right")} />
      </Row>
      <Txt testID="viewer-status" style={{ color: t.muted, fontSize: 12, textAlign: "center", marginTop: 8 }}>{status.ready ? tr("التكبير {z}× · {m}", { z: status.zoom.toFixed(1), m: tr(status.ar ? "الكاميرا تعمل" : "عرض ثلاثي الأبعاد") }) : tr("جارٍ تجهيز النموذج…")}</Txt>
      {status.error ? <View style={{ marginTop: 10 }}><Notice text={status.error} tone="warning" /></View> : null}
      <Card style={{ marginTop: 14, gap: 8 }}>
        <Row>{mode === "room" ? <Home size={18} color={t.primary} /> : <Box size={18} color={t.primary} />}<Txt weight="bold" style={{ flex: 1 }}>{tr(mode === "room" ? "شوفه بمكانه قبل ما تشتري" : "قلّبه من كل الجهات")}</Txt></Row>
        <Txt style={{ color: t.muted, fontSize: 13, lineHeight: 21 }}>{tr(mode === "room" ? "نفتح الكاميرا الخلفية ونضع المنتج فوق الصورة. اسحب لتحريكه، واستخدم التكبير لتقدير حجمه." : "اسحب للتدوير، واستخدم إصبعين أو أزرار التكبير، واضغط إعادة الضبط للعودة.")}</Txt>
        <Row style={{ justifyContent: "space-between" }}>
          <Txt weight="extra" style={{ color: t.orange, fontSize: 20 }}>{money.format(product.price)}</Txt>
          <Button title={tr("أضف إلى السلة")} onPress={() => addToCart(product.id)} style={{ minHeight: 46, paddingVertical: 10 }} />
        </Row>
        <Button title={tr("رجوع للمنتج")} secondary onPress={() => router.back()} />
      </Card>
    </Shell>
  );
}
