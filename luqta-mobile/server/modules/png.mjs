// Minimal PNG decoder (8-bit, non-interlaced) used by image search to find a photo's dominant colour.
// The app shrinks photos to a small PNG before upload, so only the formats it produces need to be supported.
import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function decodePng(buffer, maxPixels = 1_000_000) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 45 || !buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('الصورة ليست بصيغة PNG');
  let offset = 8, header = null, palette = null, alpha = null;
  const data = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('latin1', offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (chunk.length !== length) throw new Error('ملف PNG مقطوع');
    if (type === 'IHDR') header = { width: chunk.readUInt32BE(0), height: chunk.readUInt32BE(4), depth: chunk[8], color: chunk[9], interlace: chunk[12] };
    else if (type === 'PLTE') palette = chunk;
    else if (type === 'tRNS') alpha = chunk;
    else if (type === 'IDAT') data.push(chunk);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!header || !data.length) throw new Error('ملف PNG غير مكتمل');
  const { width, height, depth, color, interlace } = header;
  if (!width || !height || width * height > maxPixels) throw new Error('أبعاد الصورة كبيرة جدًا');
  if (depth !== 8 || interlace !== 0 || !(color in CHANNELS) || color === 3 && !palette) throw new Error('صيغة PNG غير مدعومة؛ أرسل صورة مصغّرة');
  const channels = CHANNELS[color], stride = width * channels;
  const raw = inflateSync(Buffer.concat(data), { maxOutputLength: (stride + 1) * height + 1024 });
  if (raw.length < (stride + 1) * height) throw new Error('بيانات PNG ناقصة');
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride, previous = y ? out - stride : -1;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[out + x - channels] : 0;
      const up = previous >= 0 ? pixels[previous + x] : 0;
      const corner = previous >= 0 && x >= channels ? pixels[previous + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) { const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner); value += pa <= pb && pa <= pc ? left : pb <= pc ? up : corner; }
      else if (filter !== 0) throw new Error('مرشح PNG غير صالح');
      pixels[out + x] = value & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    let r, g, b, a = 255;
    if (color === 0) r = g = b = pixels[s];
    else if (color === 4) { r = g = b = pixels[s]; a = pixels[s + 1]; }
    else if (color === 2) { r = pixels[s]; g = pixels[s + 1]; b = pixels[s + 2]; }
    else if (color === 6) { r = pixels[s]; g = pixels[s + 1]; b = pixels[s + 2]; a = pixels[s + 3]; }
    else { const index = pixels[s]; r = palette[index * 3]; g = palette[index * 3 + 1]; b = palette[index * 3 + 2]; if (alpha && index < alpha.length) a = alpha[index]; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }
  return { width, height, rgba };
}

export const hexToRgb = (hex) => { const v = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim()); if (!v) return null; const n = parseInt(v[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
export const rgbToHex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

// Most common colour, weighting the centre of the photo and ignoring transparent pixels and the
// near-white/near-black backdrop that product photos usually have.
export function dominantColor({ width, height, rgba }) {
  const buckets = new Map();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, [r, g, b, a] = [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
    if (a < 128) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const backdrop = max > 235 && max - min < 18 || max < 22;
    const dx = (x + 0.5) / width - 0.5, dy = (y + 0.5) / height - 0.5;
    const weight = (1.5 - Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2)) * (backdrop ? 0.15 : 1);
    const key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
    const bucket = buckets.get(key) || { weight: 0, r: 0, g: 0, b: 0 };
    bucket.weight += weight; bucket.r += r * weight; bucket.g += g * weight; bucket.b += b * weight;
    buckets.set(key, bucket);
  }
  let best = null;
  for (const bucket of buckets.values()) if (!best || bucket.weight > best.weight) best = bucket;
  if (!best || !best.weight) return null;
  return [best.r / best.weight, best.g / best.weight, best.b / best.weight];
}

// Perceptual distance (CIE76 on Lab), so "close" colours match the way people see them.
function lab([r, g, b]) {
  const lin = (v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), y = f(R * 0.2126 + G * 0.7152 + B * 0.0722), z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function colorDistance(a, b) { const [l1, a1, b1] = lab(a), [l2, a2, b2] = lab(b); return Math.hypot(l1 - l2, a1 - a2, b1 - b2); }

const NAMES = [['أحمر', [200, 40, 40]], ['برتقالي', [240, 130, 40]], ['أصفر', [240, 210, 60]], ['أخضر', [60, 150, 70]], ['أزرق', [40, 90, 200]], ['سماوي', [90, 190, 220]], ['بنفسجي', [130, 70, 180]], ['وردي', [235, 120, 170]], ['بني', [120, 80, 50]], ['بيج', [220, 200, 160]], ['رمادي', [130, 130, 130]], ['أسود', [25, 25, 25]], ['أبيض', [245, 245, 245]]];
export const colorName = (rgb) => NAMES.reduce((best, [label, value]) => { const d = colorDistance(rgb, value); return d < best.d ? { label, d } : best; }, { label: '', d: Infinity }).label;
