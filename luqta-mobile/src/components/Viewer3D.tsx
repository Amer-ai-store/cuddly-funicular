import React, { useImperativeHandle, useMemo, useRef } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { Camera } from "expo-camera";
import { useTheme } from "../lib/theme";
import { ModelSpec, ViewerCommand, ViewerEvent, viewerHtml } from "../lib/viewer3d";

export type Viewer3DHandle = { command: (command: ViewerCommand) => void };
type Props = { spec: ModelSpec; onEvent?: (event: ViewerEvent) => void; height?: number; ref?: React.Ref<Viewer3DHandle> };

export function Viewer3D({ spec, onEvent, height = 340, ref }: Props) {
  const { colors: t } = useTheme();
  const web = useRef<WebView>(null);
  const html = useMemo(() => viewerHtml(spec, t.imageBackground), [spec, t.imageBackground]);
  useImperativeHandle(ref, () => ({
    command: (command) => {
      const send = () => web.current?.injectJavaScript(`window.viewer&&window.viewer.command(${JSON.stringify(command)});true;`);
      // The in-room view needs the camera; ask once before the WebView opens it.
      if (command === "ar-on") Camera.requestCameraPermissionsAsync().then((p) => (p.granted ? send() : onEvent?.({ type: "ar-error", message: "permission" }))).catch(() => onEvent?.({ type: "ar-error", message: "permission" }));
      else send();
    },
  }), [onEvent]);
  return (
    <View style={{ height, borderRadius: 24, overflow: "hidden", backgroundColor: t.imageBackground }}>
      <WebView ref={web} source={{ html }} originWhitelist={["*"]} javaScriptEnabled allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} mediaCapturePermissionGrantType="grant" onMessage={(event) => { try { onEvent?.(JSON.parse(event.nativeEvent.data)); } catch { /* ignore malformed messages */ } }} style={{ flex: 1, backgroundColor: "transparent" }} />
    </View>
  );
}
