import { readFile, access, mkdir } from 'node:fs/promises';
import { resolve, isAbsolute, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const output = process.argv[2];
if (!output || !isAbsolute(output)) throw new Error('Pass an absolute deployment archive path.');
const manifest = await readFile(resolve(root, '.openai/hosting.json'), 'utf8');
if (manifest !== await readFile(resolve(root, 'dist/.openai/hosting.json'), 'utf8')) {
  throw new Error('Build metadata is outdated; run npm run build first.');
}
const journal = JSON.parse(await readFile(resolve(root, 'drizzle/meta/_journal.json'), 'utf8'));
for (const entry of journal.entries) {
  const name = `${entry.tag}.sql`;
  const source = await readFile(resolve(root, 'drizzle', name), 'utf8');
  if (source !== await readFile(resolve(root, 'dist/.openai/drizzle', name), 'utf8')) {
    throw new Error(`Built migration is outdated: ${name}`);
  }
}
await access(resolve(root, 'dist/server/index.js'));
await mkdir(dirname(output), {recursive: true});
// Keep the standard Worker build layout and its metadata together. Drizzle's
// generated directory is also included at its declared project-relative path.
// Never include the checkout, local database, credentials, or node_modules.
execFileSync('tar', ['-czf', output, '.openai/hosting.json', 'dist/server/index.js', 'dist/.openai', 'drizzle'], {cwd: root});
console.log(JSON.stringify({archive: output, migrations: journal.entries.length}));
