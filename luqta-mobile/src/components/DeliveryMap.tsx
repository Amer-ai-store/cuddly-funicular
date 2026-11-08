import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import * as Linking from "expo-linking";
import { useTheme } from "../lib/theme";
import { Button, Txt } from "./ui";
import { deliveryMapHtml, DeliveryMapProps, validMapPoint } from "./deliveryMapHtml";

export type { MapPoint, DeliveryMapProps } from "./deliveryMapHtml";
export { validMapPoint } from "./deliveryMapHtml";

export default function DeliveryMap(props: DeliveryMapProps) {
  const { colors: t } = useTheme();
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  const driverLat = props.driver?.latitude, driverLng = props.driver?.longitude;
  const destinationLat = props.destination?.latitude, destinationLng = props.destination?.longitude;
  const html = useMemo(() => deliveryMapHtml({ driver: driverLat === undefined || driverLng === undefined ? null : { latitude: driverLat, longitude: driverLng }, destination: destinationLat === undefined || destinationLng === undefined ? null : { latitude: destinationLat, longitude: destinationLng }, route: props.route }), [driverLat, driverLng, destinationLat, destinationLng, props.route]);
  const hasRoute = Array.isArray(props.route) && props.route.length >= 2 && props.route.every(validMapPoint);
  if (!validMapPoint(props.driver) && !validMapPoint(props.destination)) return <View style={{ padding: 24, backgroundColor: t.secondary, borderRadius: 16 }}><Txt style={{ color: t.muted }}>لم تصل إحداثيات حقيقية بعد. ستظهر الخريطة عند مشاركة السائق لموقعه أو حفظ موقع عنوان التوصيل.</Txt></View>;
  return <View style={{ gap: 8 }}>
    <View style={{ height: props.height || 300, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: t.line }}>
      {failed ? <View style={{ flex: 1, justifyContent: "center", padding: 22, gap: 12, backgroundColor: t.paper }}><Txt>تعذر فتح الخريطة. تأكد من اتصال الإنترنت.</Txt><Button title="إعادة تحميل الخريطة" secondary onPress={() => { setFailed(false); setRetry((r) => r + 1); }} /></View> : <WebView key={retry} source={{ html }} javaScriptEnabled originWhitelist={["about:blank"]} applicationNameForUserAgent="LuqtaStore/2.0 delivery preview" onError={() => setFailed(true)} onOpenWindow={(event) => { if (event.nativeEvent.targetUrl === "https://www.openstreetmap.org/copyright") void Linking.openURL(event.nativeEvent.targetUrl).catch(() => {}); }} onShouldStartLoadWithRequest={(request) => request.url === "about:blank"} style={{ flex: 1, backgroundColor: t.secondary }} />}
    </View>
    <Txt style={{ fontSize: 12, color: t.muted, lineHeight: 20 }}>{hasRoute ? "الأخضر: السائق · البرتقالي: عنوان التوصيل. الخط المتصل هو مسار القيادة التقديري." : "الأخضر: السائق · البرتقالي: عنوان التوصيل. الخط المتقطع يربط النقطتين مباشرة، ولا يمثل مسار قيادة أو وقت وصول."}</Txt>
  </View>;
}
