import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { View, type ViewStyle } from "react-native";
import type { EngineMessage, FrameHandle } from "./CharacterFrame.types";

// Web: the app's own WebGL engine in a sandboxed iframe (scripts only, opaque origin, no network by its CSP).
// Taps go to the character's Pressable, not the iframe.
export const CharacterFrame = forwardRef<FrameHandle, { html: string; title: string; onMessage: (message: EngineMessage) => void; style?: ViewStyle }>(
  function CharacterFrame({ html, title, onMessage, style }, ref) {
    const frame = useRef<HTMLIFrameElement | null>(null);
    const handler = useRef(onMessage);
    handler.current = onMessage;
    useImperativeHandle(ref, () => ({ send: (message) => frame.current?.contentWindow?.postMessage(JSON.stringify(message), "*") }), []);
    useEffect(() => {
      const listener = (event: MessageEvent) => {
        if (event.source !== frame.current?.contentWindow || typeof event.data !== "string") return;
        try { handler.current(JSON.parse(event.data)); } catch { /* not a message from the engine */ }
      };
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    }, []);
    return (
      <View style={style} pointerEvents="none">
        {React.createElement("iframe", { ref: frame, title, srcDoc: html, sandbox: "allow-scripts", "aria-hidden": true, tabIndex: -1, // colorScheme matches the engine page (light): when an iframe's scheme differs from the page's, browsers paint
        // an opaque backdrop behind it, which showed as a white box in dark mode.
        style: { border: 0, width: "100%", height: "100%", background: "transparent", colorScheme: "light" } })}
      </View>
    );
  },
);
