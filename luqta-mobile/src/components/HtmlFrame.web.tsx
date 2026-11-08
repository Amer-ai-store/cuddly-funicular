import React from "react";
import { View } from "react-native";

export function HtmlFrame({ html, height = 420, title }: { html: string; height?: number; title: string }) {
  return (
    <View style={{ height, borderRadius: 20, overflow: "hidden" }}>
      {React.createElement("iframe", { title, srcDoc: html, sandbox: "allow-same-origin allow-modals", style: { border: 0, width: "100%", height: "100%", background: "#fff" } })}
    </View>
  );
}
