// The real map of the store's branches (OpenStreetMap via Leaflet in a WebView). A tap on a branch reports its id.
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import * as Linking from "expo-linking";
import { useTheme } from "../../lib/theme";
import { Button, Txt } from "../ui";
import { STORES_MAP_MESSAGE } from "../../lib/storesMap";
import { useStoresMapHtml, type StoresMapProps } from "./useStoresMapHtml";

export type { StoresMapProps } from "./useStoresMapHtml";

export default function StoresMap(props: StoresMapProps) {
  const { colors: c } = useTheme();
  const html = useStoresMapHtml(props);
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  const known = useMemo(() => new Set(props.branches.map((b) => b.id)), [props.branches]);
  return (
    <View testID="stores-map" style={{ height: props.height || 300, overflow: "hidden", backgroundColor: c.secondary }}>
      {failed ? (
        <View style={{ flex: 1, justifyContent: "center", padding: 22, gap: 12 }}>
          <Txt>تعذر فتح الخريطة. تأكد من اتصال الإنترنت.</Txt>
          <Button title="إعادة تحميل الخريطة" secondary onPress={() => { setFailed(false); setRetry((r) => r + 1); }} />
        </View>
      ) : (
        <WebView
          key={retry}
          source={{ html }}
          javaScriptEnabled
          originWhitelist={["about:blank"]}
          applicationNameForUserAgent="LuqtaStore/2.0 branches map"
          onError={() => setFailed(true)}
          onMessage={(event) => {
            try {
              const data = JSON.parse(event.nativeEvent.data);
              if (data && data.type === STORES_MAP_MESSAGE && typeof data.id === "string" && known.has(data.id)) props.onSelect(data.id);
            } catch { /* not a branch tap */ }
          }}
          onOpenWindow={(event) => { if (event.nativeEvent.targetUrl === "https://www.openstreetmap.org/copyright") void Linking.openURL(event.nativeEvent.targetUrl).catch(() => {}); }}
          onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
          style={{ flex: 1, backgroundColor: c.secondary }}
        />
      )}
    </View>
  );
}
