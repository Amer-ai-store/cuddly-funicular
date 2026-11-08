// Finds the Arabic text of the staff screens (store admin, merchant, driver, command center) so the tests can require an
// English version of each. Unlike the customer check, which looks at translator calls, this reads every string literal
// and every piece of JSX text, and reports Arabic that the translator cannot reach (template literals).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const STAFF_ONLY = /(^|\/)(admin(\.tsx|\/)|driver\.tsx|command-center\.tsx|vendor\.tsx|components\/admin\/)/;
const LETTER = /[ء-ي]/;
// The same trimming the Details component applies before it translates a piece of text.
export const core = (text) => text.replace(/^[\s·]+|[\s·]+$/g, '');

function unquote(raw, quote) {
  const body = quote === "'" ? raw.replace(/\\'/g, "'").replace(/(^|[^\\])"/g, '$1\\"') : raw;
  return JSON.parse(`"${body}"`);
}

// Splits a source file into string literals, template literals and the remaining code (comments dropped).
export function scan(source) {
  const literals = [], templates = [];
  let code = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (ch === '/' && next === '/') { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end - 1; continue; }
    if (ch === '/' && next === '*') { const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 1; continue; }
    if (ch === '"' || ch === "'") {
      let j = i + 1, raw = '';
      while (j < source.length && source[j] !== ch && source[j] !== '\n') { if (source[j] === '\\') { raw += source[j] + source[j + 1]; j += 2; } else raw += source[j++]; }
      literals.push(unquote(raw, ch)); code += ch + ch; i = j; continue;
    }
    if (ch === '`') {
      let j = i + 1, depth = 0, raw = '';
      while (j < source.length && (source[j] !== '`' || depth > 0)) {
        if (source[j] === '\\') { raw += source[j] + source[j + 1]; j += 2; continue; }
        if (source[j] === '$' && source[j + 1] === '{') depth++;
        else if (source[j] === '}' && depth > 0) depth--;
        raw += source[j++];
      }
      templates.push(raw); code += '``'; i = j; continue;
    }
    code += ch;
  }
  return { literals, templates, code };
}

function files(root) {
  const found = [];
  const walk = (dir) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(name)) found.push(p); } };
  walk(join(root, 'src/app')); walk(join(root, 'src/components'));
  return found.filter((file) => STAFF_ONLY.test(relative(root, file)));
}

// Every Arabic string of the staff screens (key → file), and the Arabic the translator cannot reach.
export function staffStrings(root) {
  const strings = new Map(), problems = [];
  for (const file of files(root)) {
    const rel = relative(root, file);
    const { literals, templates, code } = scan(readFileSync(file, 'utf8'));
    for (const text of literals) if (LETTER.test(text) && !strings.has(text)) strings.set(text, rel);
    for (const text of templates) if (LETTER.test(text)) problems.push(`${rel}: Arabic in a template literal, use t("… {name}", { name }): \`${text.slice(0, 60)}\``);
    for (const piece of code.split(/[<>{}]/)) if (LETTER.test(piece) && !strings.has(core(piece))) strings.set(core(piece), rel);
  }
  return { strings, problems };
}
