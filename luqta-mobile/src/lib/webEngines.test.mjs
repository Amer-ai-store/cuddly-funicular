// The WebGL engines ship inside the app as strings (src/components/character/webEngines.generated.ts, written by
// tools/build-web-engines.mjs). This keeps that packed copy identical to web-engines/*.js, so a fix to an engine
// can never stay out of the app because nobody re-ran the packer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const packed = read('src/components/character/webEngines.generated.ts');
const literal = (name) => JSON.parse(packed.match(new RegExp(`^export const ${name} = (".*");$`, 'm'))[1]);
const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

test('L079 L088 the packed 3D engines are byte-for-byte the sources in web-engines/', () => {
  const sources = { THREE_JS: 'web-engines/vendor/three.r149.min.js', AVATAR_JS: 'web-engines/avatar.js', VIEWER_JS: 'web-engines/viewer.js' };
  for (const [name, path] of Object.entries(sources)) {
    assert.equal(literal(name), read(path), `${name} is stale: run node tools/build-web-engines.mjs`);
  }
  const version = `three-r149:${sha(read(sources.THREE_JS))}|avatar:${sha(read(sources.AVATAR_JS))}|viewer:${sha(read(sources.VIEWER_JS))}`;
  assert.equal(literal('ENGINE_VERSION'), version);
});

test('the avatar engine only runs its own actions, never inherited properties such as __proto__', () => {
  const avatar = literal('AVATAR_JS');
  assert.match(avatar, /Object\.prototype\.hasOwnProperty\.call\(ACTIONS, a\)/);
  assert.doesNotMatch(avatar, /if \(!ACTIONS\[a\]\)/);
});
