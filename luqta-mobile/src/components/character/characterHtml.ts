// Pure HTML builders shared by the native WebView, the web iframe and the
// browser tests. No React Native imports here so Node can run it directly.
import { AVATAR_JS, THREE_JS, VIEWER_JS } from "./webEngines.generated.ts";

export type AvatarAction =
  | "idle" | "walk" | "run" | "jump" | "sleep" | "wake" | "cart" | "come" | "wave"
  | "point" | "thumbs" | "think" | "crossed" | "listen" | "sit" | "stop" | "dance" | "sad" | "talk";

export const AVATAR_ACTIONS: AvatarAction[] = [
  "idle", "walk", "run", "jump", "sleep", "wake", "cart", "come", "wave",
  "point", "thumbs", "think", "crossed", "listen", "sit", "stop", "dance", "sad", "talk",
];

export type AvatarProfile = {
  skin?: string; hair?: string; outfit?: string; pants?: string; boots?: string;
  beard?: boolean; accessory?: AvatarAccessory; faceDataUrl?: string;
};
export type AvatarAccessory = "none" | "glasses" | "cap" | "headphones";

const LINE_SEPARATORS = new RegExp("[\\u2028\\u2029]", "g");
const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(LINE_SEPARATORS, " ");

function page(body: string, init: unknown, engine: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:;">
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;width:100%;height:100%;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}canvas{display:block;width:100%;height:100%;touch-action:none}</style></head>
<body>${body}<script>window.__LUQTA_INIT__=${safeJson(init)};</script><script>${THREE_JS}</script><script>${engine}</script></body></html>`;
}

export function avatarHtml(init: { action?: AvatarAction; profile?: AvatarProfile; reduceMotion?: boolean } = {}) {
  return page('<canvas id="stage" aria-hidden="true"></canvas>', init, AVATAR_JS);
}

export type ViewerModel = "chair" | "headphones" | "box";
export function viewerHtml(init: { model: ViewerModel; color?: string; dimensions?: { w: number; d: number; h: number }; imageDataUrl?: string }) {
  return page('<canvas id="stage" aria-label="عرض ثلاثي الأبعاد"></canvas>', init, VIEWER_JS);
}
