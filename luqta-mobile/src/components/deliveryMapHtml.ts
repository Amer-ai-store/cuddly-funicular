export type MapPoint = { latitude: number; longitude: number };
export type DeliveryMapProps = {
  driver?: MapPoint | null;
  destination?: MapPoint | null;
  route?: MapPoint[] | null;
  height?: number;
};

export function validMapPoint(point?: MapPoint | null): point is MapPoint {
  return !!point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
}

export function deliveryMapHtml({ driver, destination, route }: DeliveryMapProps) {
  // Only validated numeric coordinates enter the document. Labels and URLs are static.
  const points = [
    ...(validMapPoint(driver) ? [{ lat: driver.latitude, lng: driver.longitude, kind: "driver" }] : []),
    ...(validMapPoint(destination) ? [{ lat: destination.latitude, lng: destination.longitude, kind: "destination" }] : []),
  ];
  const drivingRoute = Array.isArray(route) && route.length >= 2 && route.length <= 5000 && route.every(validMapPoint)
    ? route.map((point) => [point.latitude, point.longitude]) : [];
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://unpkg.com; style-src 'unsafe-inline' https://unpkg.com; img-src data: https://tile.openstreetmap.org; connect-src https://tile.openstreetmap.org"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""><style>html,body,#map{height:100%;margin:0;font-family:Arial,sans-serif}#map{background:#eceee8}#error{position:absolute;z-index:2000;inset:0;display:none;align-items:center;justify-content:center;padding:20px;text-align:center;background:#f8f7f4;color:#252a27;line-height:1.7}.leaflet-popup-content{text-align:right}.leaflet-control-attribution{direction:ltr;font-size:10px}</style></head><body><div id="map" role="img" aria-label="خريطة موقع السائق وعنوان التوصيل"></div><div id="error">تعذر تحميل الخريطة. تحقق من الإنترنت وأعد المحاولة. الإحداثيات تبقى ظاهرة خارج الخريطة.</div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script><script>(function(){function fail(){document.getElementById('error').style.display='flex';}try{if(!window.L){fail();return;}var points=${JSON.stringify(points)};var drivingRoute=${JSON.stringify(drivingRoute)};if(!points.length){fail();return;}var map=L.map('map',{scrollWheelZoom:false});var tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'}).addTo(map);var loaded=false;tiles.on('tileload',function(){loaded=true;});tiles.on('tileerror',function(){if(!loaded)fail();});points.forEach(function(p){L.circleMarker([p.lat,p.lng],{radius:10,color:'#ffffff',weight:3,fillColor:p.kind==='driver'?'#42765D':'#EB6A3E',fillOpacity:1}).addTo(map).bindPopup(p.kind==='driver'?'موقع السائق':'عنوان التوصيل');});if(points.length>1){var latlngs=points.map(function(p){return[p.lat,p.lng];});if(drivingRoute.length>1){L.polyline(drivingRoute,{color:'#EB6A3E',weight:4,opacity:0.95}).addTo(map);map.fitBounds(drivingRoute,{padding:[35,35],maxZoom:15});}else{L.polyline(latlngs,{color:'#EB6A3E',weight:3,dashArray:'8 8'}).addTo(map);map.fitBounds(latlngs,{padding:[35,35],maxZoom:15});}}else{map.setView([points[0].lat,points[0].lng],15);}setTimeout(function(){map.invalidateSize();},200);}catch(e){fail();}})();</script></body></html>`;
}
