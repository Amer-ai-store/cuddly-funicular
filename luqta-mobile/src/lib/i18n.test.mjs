import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STAFF_ONLY, staffStrings } from '../../scripts/staff-strings.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
// Staff screens (store admin, merchant, driver, command center) have their own, stricter check below.
const PATTERNS = [/\btr?\(\s*"([^"]*[؀-ۿ][^"]*)"/g, /\b(?:title|label|detail|subtitle|action|text|message|robot|placeholder)="([^"]*[؀-ۿ][^"]*)"/g, /\[\s*"[a-z_-]+"\s*,\s*"([^"]*[؀-ۿ][^"]*)"/g];

function dictionary() {
  const source = readFileSync(join(root, 'src/lib/i18n-en.ts'), 'utf8');
  const body = source.slice(source.indexOf('{') , source.lastIndexOf('}') + 1);
  return JSON.parse(body.replace(/,\s*}$/, '}'));
}
function customerStrings() {
  const files = [];
  const walk = (dir) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(name)) files.push(p); } };
  walk(join(root, 'src/app')); walk(join(root, 'src/components'));
  const found = new Map();
  for (const file of files) {
    const rel = relative(root, file);
    if (STAFF_ONLY.test(rel)) continue;
    const source = readFileSync(file, 'utf8');
    for (const pattern of PATTERNS) for (const m of source.matchAll(pattern)) if (!found.has(m[1])) found.set(m[1], rel);
  }
  return found;
}

test('L124 every customer-facing string sent through the translator has an English version', () => {
  const en = dictionary(), missing = [];
  for (const [arabic, file] of customerStrings()) if (!en[arabic]) missing.push(`${file}: ${arabic}`);
  assert.deepEqual(missing, [], `missing English text:\n${missing.join('\n')}`);
});

test('L124 every staff-screen string (admin, merchant, driver, command center) has an English version', () => {
  const en = dictionary();
  const { strings, problems } = staffStrings(root);
  assert.ok(strings.size > 300, `found ${strings.size} staff strings`);
  for (const [arabic, file] of strings) if (!en[arabic]) problems.push(`${file}: ${arabic}`);
  assert.deepEqual(problems, [], `staff strings without English:\n${problems.join('\n')}`);
});

test('L124 English translations keep the same placeholders and are never empty', () => {
  const en = dictionary(), problems = [];
  const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [arabic, english] of Object.entries(en)) {
    if (!english.trim()) problems.push(`empty: ${arabic}`);
    if (holes(arabic) !== holes(english)) problems.push(`placeholders differ: ${arabic} → ${english}`);
  }
  assert.deepEqual(problems, []);
});
