// F-G16-10 Accessibility & Arabic localisation gate: every touchable declares a role, every
// text field has a spoken label, and user-facing screens carry Arabic titles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : []; });
const openingTags = (s, name) => { const out = []; const re = new RegExp(`(?<!useRef)<${name}\\b`, 'g'); let m; while ((m = re.exec(s))) { let i = m.index + m[0].length, depth = 0; for (; i < s.length; i++) { const ch = s[i]; if (ch === '{') depth++; else if (ch === '}') depth--; else if (ch === '>' && depth === 0) break; } out.push({ tag: s.slice(m.index, i), line: s.slice(0, m.index).split('\n').length }); } return out; };

test('F-G16-10 كل عنصر قابل للضغط له دور وصول، وكل حقل نص له اسم منطوق', () => {
  const problems = [];
  for (const f of files(src)) {
    const s = readFileSync(f, 'utf8');
    for (const { tag, line } of openingTags(s, 'Pressable')) if (!tag.includes('accessibilityRole')) problems.push(`${f}:${line} Pressable without accessibilityRole`);
    for (const { tag, line } of openingTags(s, 'TextInput')) if (!tag.includes('accessibilityLabel')) problems.push(`${f}:${line} TextInput without accessibilityLabel`);
  }
  assert.deepEqual(problems, []);
});

test('F-G16-10 الشاشات بعناوين عربية والتخطيط من اليمين لليسار', () => {
  const screens = files(join(src, 'app')).filter((f) => !/_layout|\+html|notifications\.tsx|reels\.tsx/.test(f));
  const missing = screens.filter((f) => { const s = readFileSync(f, 'utf8'); return /<Shell\b/.test(s) && !/title=\{?["`][^"`]*[؀-ۿ]/.test(s) && !/title=\{(?:data|vendor)/.test(s); });
  assert.deepEqual(missing.map((f) => f.replace(src, 'src')), []);
  const shell = readFileSync(join(src, 'components', 'Shell.tsx'), 'utf8');
  assert.match(shell, /row-reverse/);
});
