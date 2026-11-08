// Web build of the branches map: the same Leaflet page in a sandboxed iframe. Messages are accepted only from that
// iframe and only for branch ids the screen knows.
import React, { useEffect, useMemo, useRef } from "react";
import { View } from "react-native";
import { useTheme } from "../../lib/theme";
import { STORES_MAP_MESSAGE } from "../../lib/storesMap";
import { useStoresMapHtml, type StoresMapProps } from "./useStoresMapHtml";

export type { StoresMapProps } from "./useStoresMapHtml";

export default function StoresMap(props: StoresMapProps) {
  const { colors: c } = useTheme();
  const html = useStoresMapHtml(props);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const known = useMemo(() => new Set(props.branches.map((b) => b.id)), [props.branches]);
  const { onSelect } = props;
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow || typeof event.data !== "string") return;
      try {
        const data = JSON.parse(event.data);
        if (data && data.type === STORES_MAP_MESSAGE && typeof data.id === "string" && known.has(data.id)) onSelect(data.id);
      } catch { /* not a branch tap */ }
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [known, onSelect]);
  return (
    <View testID="stores-map" style={{ height: props.height || 300, overflow: "hidden", backgroundColor: c.secondary }}>
      {React.createElement("iframe", { ref: frame, title: "خريطة الفروع", srcDoc: html, sandbox: "allow-scripts allow-popups allow-popups-to-escape-sandbox", referrerPolicy: "strict-origin-when-cross-origin", style: { border: 0, width: "100%", height: "100%" } })}
    </View>
  );
}
