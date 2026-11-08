import React from "react";
import { View } from "react-native";

export function VideoPlayer({ uri, title }: { uri: string; title: string }) {
  if (!/^https:\/\//.test(uri)) return null;
  return (
    <View style={{ height: 230, borderRadius: 20, overflow: "hidden", backgroundColor: "#000" }}>
      {React.createElement("video", { src: uri, controls: true, playsInline: true, preload: "metadata", "aria-label": title, "data-testid": "product-video", style: { width: "100%", height: "100%", objectFit: "contain" } })}
    </View>
  );
}
