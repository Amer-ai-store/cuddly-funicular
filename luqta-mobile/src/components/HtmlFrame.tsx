import React from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";

// Shows trusted, app-generated HTML (invoices, videos). Navigation away from the document is blocked.
export function HtmlFrame({ html, height = 420, title }: { html: string; height?: number; title: string }) {
  return (
    <View style={{ height, borderRadius: 20, overflow: "hidden" }} accessibilityLabel={title}>
      <WebView source={{ html }} originWhitelist={["about:blank"]} onShouldStartLoadWithRequest={(r) => r.url === "about:blank"} allowsInlineMediaPlayback style={{ flex: 1 }} />
    </View>
  );
}
