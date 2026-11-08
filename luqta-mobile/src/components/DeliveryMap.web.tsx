import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { useTheme } from "../lib/theme";
import { Button, Txt } from "./ui";
import { deliveryMapHtml, DeliveryMapProps, validMapPoint } from "./deliveryMapHtml";

export type { MapPoint, DeliveryMapProps } from "./deliveryMapHtml";
export { validMapPoint } from "./deliveryMapHtml";

export default function DeliveryMap(props: DeliveryMapProps) {
  const { colors: t } = useTheme();
  const [retry, setRetry] = useState(0);
  const driverLat = props.driver?.latitude, driverLng = props.driver?.longitude;
  const destinationLat = props.destination?.latitude, destinationLng = props.destination?.longitude;
  const html = useMemo(() => deliveryMapHtml({ driver: driverLat === undefined || driverLng === undefined ? null : { latitude: driverLat, longitude: driverLng }, destination: destinationLat === undefined || destinationLng === undefined ? null : { latitude: destinationLat, longitude: destinationLng }, route: props.route }), [driverLat, driverLng, destinationLat, destinationLng, props.route]);
  const hasRoute = Array.isArray(props.route) && props.route.length >= 2 && props.route.every(validMapPoint);
  if (!validMapPoint(props.driver) && !validMapPoint(props.destination)) return <View style={{ padding: 24, backgroundColor: t.secondary, borderRadius: 16 }}><Txt style={{ color: t.muted }}>لم تصل إحداثيات حقيقية بعد. ستظهر الخريطة عند مشاركة السائق لموقعه أو حفظ موقع عنوان التوصيل.</Txt></View>;
  return <View style={{ gap: 8 }}>
    <View style={{ height: props.height || 300, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: t.line }}>
      {React.createElement("iframe", { key: retry, title: "خريطة تتبع التوصيل", srcDoc: html, sandbox: "allow-scripts allow-popups allow-popups-to-escape-sandbox", referrerPolicy: "strict-origin-when-cross-origin", style: { border: 0, width: "100%", height: "100%" } })}
    </View>
    <Txt style={{ fontSize: 12, color: t.muted, lineHeight: 20 }}>{hasRoute ? "الأخضر: السائق · البرتقالي: عنوان التوصيل. الخط المتصل هو مسار القيادة التقديري." : "الأخضر: السائق · البرتقالي: عنوان التوصيل. الخط المتقطع يربط النقطتين مباشرة، ولا يمثل مسار قيادة أو وقت وصول."}</Txt>
    <Button title="إعادة تحميل الخريطة" secondary onPress={() => setRetry((r) => r + 1)} />
  </View>;
}
