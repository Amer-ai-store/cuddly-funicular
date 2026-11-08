import React, { useEffect, useImperativeHandle, useRef } from "react";
import { View } from "react-native";
import { useTheme } from "../lib/theme";
import { ModelSpec, VIEWER_JS, ViewerCommand, ViewerEvent } from "../lib/viewer3d";

export type Viewer3DHandle = { command: (command: ViewerCommand) => void };
type Props = { spec: ModelSpec; onEvent?: (event: ViewerEvent) => void; height?: number; ref?: React.Ref<Viewer3DHandle> };
type Mounted = { command: (name: string) => void; destroy: () => void };
const mountViewer = new Function(`${VIEWER_JS}; return mountViewer;`)() as (el: HTMLElement, spec: ModelSpec, emit: (e: ViewerEvent) => void) => Mounted;

export function Viewer3D({ spec, onEvent, height = 340, ref }: Props) {
  const { colors: t } = useTheme();
  const host = useRef<View>(null);
  const viewer = useRef<Mounted | null>(null);
  const events = useRef(onEvent);
  useEffect(() => { events.current = onEvent; }, [onEvent]);
  useEffect(() => {
    const node = host.current as unknown as HTMLElement | null;
    if (!node) return;
    viewer.current = mountViewer(node, spec, (event) => events.current?.(event));
    (node as HTMLElement & { viewer?: Mounted }).viewer = viewer.current;
    return () => { viewer.current?.destroy(); viewer.current = null; };
  }, [spec.shape, spec.color, spec.scale]); // eslint-disable-line react-hooks/exhaustive-deps
  useImperativeHandle(ref, () => ({ command: (command) => viewer.current?.command(command) }), []);
  return <View ref={host} testID="viewer-3d" style={{ height, borderRadius: 24, overflow: "hidden", backgroundColor: t.imageBackground }} />;
}
