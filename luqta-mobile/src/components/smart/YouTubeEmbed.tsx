import React from "react";
import { WebView } from "react-native-webview";

export function YouTubeEmbed({ id }: { id: string }) {
  return (
    <WebView source={{ uri: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?playsinline=1&rel=0` }} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction javaScriptEnabled allowsFullscreenVideo setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(r) => /^https:\/\/(www\.)?(youtube-nocookie\.com|youtube\.com|i\.ytimg\.com|googlevideo\.com|accounts\.google\.com)/.test(r.url) || r.url === "about:blank"} />
  );
}
