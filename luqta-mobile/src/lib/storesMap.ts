// The real map behind "من موقعي" on the home screen: OpenStreetMap tiles drawn by Leaflet, with the store's branches,
// the shopper's own place, and a dashed line to the chosen (or nearest) branch. Tapping a branch posts its id to the
// app. Only validated numbers and JSON-escaped text enter the page; labels are set with textContent, never as HTML.
import { formatDistance, validGeoPoint, type GeoPoint, type PlacedBranch } from "./rafiq.ts";

export type StoresMapInput = {
  home: GeoPoint | null;
  branches: PlacedBranch[];
  selectedId: string | null;
  dark: boolean;
  lang: "ar" | "en";
  labels: { home: string; minutes: string; error: string; aria: string };
};
export const STORES_MAP_MESSAGE = "luqta-branch";

/** JSON that is safe inside an inline <script>: no "</script>", no HTML comment openers, no line separators. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const clip = (value: unknown, max: number) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);

export function storesMapHtml({ home, branches, selectedId, dark, lang, labels }: StoresMapInput): string {
  const points = branches
    .filter((b) => validGeoPoint(b) && typeof b.id === "string" && b.id.length > 0 && b.id.length <= 64)
    .slice(0, 200)
    .map((b) => ({
      id: clip(b.id, 64),
      lat: b.latitude,
      lng: b.longitude,
      name: clip(b.name, 80),
      meta: b.km === null || b.eta === null ? clip(b.city, 60) : `${formatDistance(b.km, lang)} · ${b.eta} ${clip(labels.minutes, 12)}`,
      on: b.id === selectedId,
    }));
  const me = validGeoPoint(home) ? { lat: home.latitude, lng: home.longitude } : null;
  const data = scriptJson({ points, me, homeLabel: clip(labels.home, 40), message: STORES_MAP_MESSAGE });
  const c = dark
    ? { bg: "#0D1220", panel: "rgba(9,13,24,.86)", text: "#E8ECF5", muted: "#9BA4BA", line: "rgba(214,224,255,.22)", branch: "#D8B878", leaf: "#B4F28A", ink: "#070A12" }
    : { bg: "#EEF1F6", panel: "rgba(255,255,255,.94)", text: "#0D1220", muted: "#5A6378", line: "rgba(13,18,32,.16)", branch: "#A8813A", leaf: "#2F7A17", ink: "#FFFFFF" };
  const tiles = dark ? ".leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.82) contrast(.92) saturate(.55)}" : "";
  return `<!doctype html><html lang="${lang}" dir="${lang === "en" ? "ltr" : "rtl"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://unpkg.com; style-src 'unsafe-inline' https://unpkg.com; img-src data: https://tile.openstreetmap.org; connect-src https://tile.openstreetmap.org"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""><style>html,body,#map{height:100%;margin:0;background:${c.bg};font-family:'IBM Plex Sans Arabic',system-ui,sans-serif}${tiles}#error{position:absolute;z-index:2000;inset:0;display:none;align-items:center;justify-content:center;padding:20px;text-align:center;background:${c.bg};color:${c.text};line-height:1.7}.lbl{background:${c.panel};border:1px solid ${c.line};border-radius:10px;color:${c.text};box-shadow:none;padding:4px 10px;text-align:center;font-size:12px;cursor:pointer}.lbl:before{display:none}.lbl b{display:block;font-weight:600}.lbl small{display:block;font-size:10px;color:${c.muted}}.lbl.on,.lbl.home{border-color:${c.leaf}}.lbl.home b{color:${c.leaf}}.leaflet-control-attribution{direction:ltr;font-size:10px;background:${c.panel}!important;color:${c.muted}}.leaflet-control-attribution a{color:${c.muted}}.leaflet-bar a{background:${c.panel};color:${c.text};border-color:${c.line}}</style></head><body><div id="map" role="img" aria-label="${clip(labels.aria, 120).replace(/[<>&"]/g, " ")}"></div><div id="error"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script><script>(function(){var D=${data};var err=document.getElementById('error');err.textContent=${scriptJson(clip(labels.error, 200))};function fail(){err.style.display='flex';}function send(id){var msg=JSON.stringify({type:D.message,id:id});if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(msg);}else if(window.parent&&window.parent!==window){window.parent.postMessage(msg,'*');}}function label(title,meta){var el=document.createElement('div');var b=document.createElement('b');b.textContent=title;el.appendChild(b);if(meta){var s=document.createElement('small');s.textContent=meta;el.appendChild(s);}return el;}try{if(!window.L){fail();return;}if(!D.points.length&&!D.me){fail();return;}var map=L.map('map',{scrollWheelZoom:false,zoomControl:true,attributionControl:true});var tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'}).addTo(map);var loaded=false;tiles.on('tileload',function(){loaded=true;});tiles.on('tileerror',function(){if(!loaded)fail();});var all=[];var target=null;D.points.forEach(function(p){var m=L.circleMarker([p.lat,p.lng],{radius:p.on?11:9,color:'${c.ink}',weight:2,fillColor:p.on?'${c.leaf}':'${c.branch}',fillOpacity:1}).addTo(map);m.bindTooltip(label(p.name,p.meta),{permanent:true,direction:'top',offset:[0,-10],className:'lbl'+(p.on?' on':''),interactive:true});m.on('click',function(){send(p.id);});m.getTooltip().on('click',function(){send(p.id);});all.push([p.lat,p.lng]);if(p.on)target=p;});if(D.me){L.circleMarker([D.me.lat,D.me.lng],{radius:16,color:'${c.leaf}',weight:1,fill:false,opacity:.6}).addTo(map);L.circleMarker([D.me.lat,D.me.lng],{radius:8,color:'${c.ink}',weight:2,fillColor:'${c.leaf}',fillOpacity:1}).addTo(map).bindTooltip(label(D.homeLabel,''),{permanent:true,direction:'bottom',offset:[0,10],className:'lbl home'});all.push([D.me.lat,D.me.lng]);var to=target||D.points[0];if(to){L.polyline([[D.me.lat,D.me.lng],[to.lat,to.lng]],{color:'${c.leaf}',weight:2.5,dashArray:'6 8',opacity:.9}).addTo(map);}}if(all.length>1){map.fitBounds(all,{padding:[48,48],maxZoom:15});}else{map.setView(all[0],14);}setTimeout(function(){map.invalidateSize();},200);}catch(e){fail();}})();</script></body></html>`;
}
