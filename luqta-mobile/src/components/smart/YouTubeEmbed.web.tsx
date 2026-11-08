import React from "react";

export function YouTubeEmbed({ id }: { id: string }) {
  return React.createElement("iframe", { src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0`, title: "فيديو العرض", allow: "encrypted-media; picture-in-picture", allowFullScreen: true, style: { border: 0, width: "100%", height: "100%" } });
}
