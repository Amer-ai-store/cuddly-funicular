import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { View, type ViewStyle } from "react-native";
import { WebView } from "react-native-webview";
import type { EngineMessage, FrameHandle } from "./CharacterFrame.types";

// Android/iOS: the app's own WebGL engine in a WebView that may not navigate anywhere. Taps go to the character's
// Pressable, and screen readers skip the canvas (the Pressable carries the description).
export const CharacterFrame = forwardRef<FrameHandle, { html: string; title: string; onMessage: (message: EngineMessage) => void; style?: ViewStyle }>(
  function CharacterFrame({ html, title, onMessage, style }, ref) {
    const view = useRef<WebView>(null);
    useImperativeHandle(ref, () => ({
      send: (message) => view.current?.injectJavaScript(`window.LuqtaAvatar&&window.LuqtaAvatar.command(${JSON.stringify(message)});true;`),
    }), []);
    return (
      <View style={style} pointerEvents="none" accessibilityLabel={title} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <WebView
          ref={view}
          source={{ html }}
          originWhitelist={["about:blank"]}
          onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
          onMessage={(event) => { try { onMessage(JSON.parse(event.nativeEvent.data)); } catch { /* not a message from the engine */ } }}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          style={{ flex: 1, backgroundColor: "transparent" }}
          containerStyle={{ backgroundColor: "transparent" }}
        />
      </View>
    );
  },
);
