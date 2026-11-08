// Plays an https video (mp4/webm/HLS-capable WebView) muted-looping, tap to unmute.
import React from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
export const videoHtml = (url: string, poster?: string | null) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#000}video{width:100%;height:100%;object-fit:cover}</style></head><body><video src="${esc(url)}" ${poster ? `poster="${esc(poster)}"` : ""} autoplay muted loop playsinline onclick="this.muted=!this.muted"></video></body></html>`;

// Only the page itself may load in the frame: the exact local origin, so a look-alike host such as
// media.luqta.local.example.com never passes.
const LOCAL_PAGE = /^https:\/\/media\.luqta\.local(\/|$)/;

export function VideoSurface({ url, poster }: { url: string; poster?: string | null }) {
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <WebView source={{ html: videoHtml(url, poster), baseUrl: "https://media.luqta.local/" }} originWhitelist={["*"]} javaScriptEnabled={false} mediaPlaybackRequiresUserAction={false} allowsInlineMediaPlayback allowFileAccess={false} setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(r) => LOCAL_PAGE.test(r.url) || r.url === "about:blank"} style={{ backgroundColor: "#000" }} />
    </View>
  );
}
