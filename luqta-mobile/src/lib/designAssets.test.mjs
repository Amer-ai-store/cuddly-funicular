// Guards the bitmaps taken from the لُقطة mockups (src/lib/designAssets.ts): every file the app bundles must exist
// and be a real image, and every key must point at something the catalog actually has, so no mapping goes stale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const source = readFileSync(join(ROOT, 'src/lib/designAssets.ts'), 'utf8');
const catalog = JSON.parse(readFileSync(join(ROOT, 'server/catalog.json'), 'utf8'));
const productIds = new Set(catalog.map((p) => p.id));

// Entries of one exported object: key → required path (or referenced designAssets key).
const block = (name) => {
  const match = source.match(new RegExp(`export const ${name}[^=]*= \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `${name} is exported`);
  return [...match[1].matchAll(/^\s*"?([\w-]+)"?: (?:require\("([^"]+)"\)|designAssets\.(\w+)),?$/gm)].map((m) => ({ key: m[1], path: m[2], ref: m[3] }));
};
const list = (name) => JSON.parse(source.match(new RegExp(`export const ${name}[^=]*= (?:new Set\\()?(\\[[^\\]]*\\])`))[1]);
const PNG = '89504e470d0a1a0a', JPEG = 'ffd8ff';

test('every bundled design image exists and is a real PNG or JPEG', () => {
  const required = [...source.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(required.length >= 30, `found ${required.length} images`);
  for (const rel of required) {
    const file = join(ROOT, 'src/lib', rel);
    assert.ok(existsSync(file), `${rel} exists`);
    const head = readFileSync(file).subarray(0, 8).toString('hex');
    assert.ok(head.startsWith(PNG) || head.startsWith(JPEG), `${rel} is a PNG or JPEG`);
  }
});

test('L018 product images and extra gallery views map to products the catalog sells', () => {
  const images = block('productImages');
  const keys = new Set(images.map((i) => i.key));
  const galleries = source.match(/export const productGalleries[^=]*= (\{[^}]*\})/)[1].replace(/(\w+):/g, '"$1":');
  const extraViews = Object.values(JSON.parse(galleries)).flat();
  for (const { key } of images) {
    if (!extraViews.includes(key)) assert.ok(productIds.has(key), `${key} is a catalog product`);
  }
  for (const [product, views] of Object.entries(JSON.parse(galleries))) {
    assert.ok(productIds.has(product), `${product} is a catalog product`);
    for (const view of views) assert.ok(keys.has(view), `${view} is a bundled image`);
  }
  for (const key of list('cutoutImages')) assert.ok(keys.has(key), `cut-out ${key} is a bundled image`);
  // The mockup's fourth headphones view is its video thumbnail (a play icon drawn on the picture): never a gallery photo.
  assert.ok(!/require\("[^"]*p-headphones-4\.png"\)/.test(source), 'the video thumbnail is not bundled');
});

test('L017 the home screen departments from the mockups are real categories, each with its illustration', () => {
  const featured = list('FEATURED_CATEGORIES');
  const art = block('categoryArt');
  assert.deepEqual(art.map((a) => a.key), featured);
  const designKeys = new Set(block('designAssets').map((d) => d.key));
  const products = readFileSync(join(ROOT, 'src/data/products.ts'), 'utf8');
  const categoryIds = new Set([...products.matchAll(/id: "([a-z-]+)", (?:name|ar|nameAr|label)/g)].map((m) => m[1]));
  for (const { key, ref } of art) {
    assert.ok(categoryIds.has(key), `${key} is a seeded category`);
    assert.ok(designKeys.has(ref), `${key} uses designAssets.${ref}`);
    assert.ok(catalog.some((p) => p.category === key), `${key} has products to show`);
  }
});

test('mockup cut-outs are RGBA PNGs, so they sit cleanly on the white product base', () => {
  for (const key of list('cutoutImages')) {
    const rel = block('productImages').find((i) => i.key === key).path;
    const file = readFileSync(join(ROOT, 'src/lib', rel));
    assert.equal(file.subarray(0, 8).toString('hex'), PNG, `${key} is a PNG`);
    assert.equal(file[25], 6, `${key} is RGBA (IHDR colour type 6)`);
  }
});
