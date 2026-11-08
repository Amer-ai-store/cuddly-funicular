import React from "react";
import { HtmlFrame } from "./HtmlFrame";

const escape = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
export function VideoPlayer({ uri, title }: { uri: string; title: string }) {
  if (!/^https:\/\//.test(uri)) return null;
  return <HtmlFrame title={title} height={230} html={`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#000;height:100%}video{width:100%;height:100%;object-fit:contain}</style></head><body><video src="${escape(uri)}" controls playsinline preload="metadata"></video></body></html>`} />;
}
