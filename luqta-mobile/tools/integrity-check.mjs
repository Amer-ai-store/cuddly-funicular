// Static integrity audit (no fake wiring):
//  1. every in-app navigation target (router.push/replace/navigate, href:, Link href) resolves to a screen file
//  2. every API path the app calls (api.get/post/put/patch/delete, useRemote) is handled by a server route
// Usage: node tools/integrity-check.mjs  → exits 1 on any dead link or unknown endpoint.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const appFiles = walk(join(root, 'src')).filter((f) => /\.(tsx?|mjs)$/.test(f) && !/\.test\./.test(f));
const screens = walk(join(root, 'src/app')).filter((f) => f.endsWith('.tsx') && !/_layout|\+html|\.web\.tsx$/.test(f))
  .map((f) => '/' + relative(join(root, 'src/app'), f).replace(/\.tsx$/, '').replace(/(^|\/)index$/, ''))
  .map((r) => new RegExp('^' + r.replace(/\/$/, '').replace(/\[[^\]]+\]/g, '[^/]+') + '/?$'));
const isScreen = (p) => screens.some((re) => re.test(p.replace(/\/$/, '') || '/')) || p === '/';

// --- navigation targets
const nav = [];
for (const f of appFiles) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/(?:router\.(?:push|replace|navigate)\(\s*|href[=:]\s*\{?\s*|pathname:\s*)(["'`])(\/[^"'`]*)\1/g)) {
    let p = m[2].split('?')[0].split('#')[0];
    p = p.replace(/\$\{[^}]+\}/g, 'X');
    nav.push({ file: relative(root, f), target: p });
  }
}
const deadLinks = nav.filter((n) => !isScreen(n.target));

// --- API endpoints
const server = walk(join(root, 'server')).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs')).map((f) => readFileSync(f, 'utf8')).join('\n');
const exact = new Set([...server.matchAll(/path === '(\/api\/[^']+)'/g)].map((m) => m[1]));
const regexes = [...server.matchAll(/\/\^\\\/api\\\/(.+?)\$\//g)].map((m) => { try { return new RegExp('^\\/api\\/' + m[1] + '$'); } catch { return null; } }).filter(Boolean);
const startsWith = [...server.matchAll(/path\.startsWith\('(\/api\/[^']+)'\)/g)].map((m) => m[1]);
// feature modules (server/modules/*.mjs) register routes with api.route('METHOD', '/path/:param', handler)
for (const m of server.matchAll(/api\.route\('[A-Z]+',\s*'([^']+)'/g)) regexes.push(new RegExp('^\\/api' + m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:\w+/g, '[^/]+') + '$'));
// mount tables like ['GET', '/path/:id'] in server/modules/smart.mjs
for (const m of server.matchAll(/\['(?:GET|POST|PUT|PATCH|DELETE)',\s*'(\/[^']+)'\]/g)) regexes.push(new RegExp('^\\/api' + m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:\w+/g, '[^/]+') + '$'));
// admin router: /api/admin/<p[2]>... handled by segment switch
const adminSegments = new Set([...server.matchAll(/p\[2\] === '([\w-]+)'/g)].map((m) => m[1]));
const calls = [];
for (const f of appFiles) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/(?:api\.(?:get|post|put|patch|delete)\s*(?:<[^>]*>)?\(|useRemote\s*(?:<[^>]*>)?\(|useLoad\s*(?:<[^>]*>)?\()\s*(["'`])(\/[^"'`]*)\1/g)) {
    const p = '/api' + m[2].split('?')[0].replace(/\$\{[^}]+\}/g, 'x1');
    calls.push({ file: relative(root, f), path: p });
  }
}
const handled = (p) => exact.has(p) || regexes.some((re) => re.test(p)) || (p.startsWith('/api/admin/') && adminSegments.has(p.split('/')[3])) || startsWith.some((s) => p.startsWith(s) && s.length > 10);
const unknown = calls.filter((c) => !handled(c.path));
console.log(`navigation targets: ${nav.length}, dead: ${deadLinks.length}`);
for (const d of deadLinks) console.log(`  DEAD LINK ${d.target}  (${d.file})`);
console.log(`api calls: ${calls.length} (${new Set(calls.map((c) => c.path)).size} distinct), unknown: ${unknown.length}`);
for (const u of unknown) console.log(`  UNKNOWN ENDPOINT ${u.path}  (${u.file})`);
process.exit(deadLinks.length || unknown.length ? 1 : 0);
