import React from "react";
import { View } from "react-native";

export function VideoSurface({ url, poster }: { url: string; poster?: string | null }) {
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {React.createElement("video", { src: url, poster: poster || undefined, autoPlay: true, muted: true, loop: true, playsInline: true, onClick: (e: { currentTarget: HTMLVideoElement }) => { e.currentTarget.muted = !e.currentTarget.muted; }, style: { width: "100%", height: "100%", objectFit: "cover" } })}
    </View>
  );
}
