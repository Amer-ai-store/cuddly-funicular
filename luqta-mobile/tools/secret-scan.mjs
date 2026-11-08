// Secret scan for tracked files (CI gate + local): fails if anything looks like a live
// credential. Example/placeholder values and test fixtures are allowed.
// Usage: node tools/secret-scan.mjs   (scans tracked files under the current directory)
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '.'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  .filter((f) => !/\.(png|jpe?g|webp|gif|glb|gltf|ttf|otf|apk|zip|ico|mp4|pdf)$/i.test(f) && !/\.generated\.ts$|package-lock\.json$/.test(f));
const RULES = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['OpenAI/Anthropic key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}\b/],
  ['GitHub token', /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}\b/],
  ['Slack token', /\bxox[abpr]-[A-Za-z0-9-]{20,}\b/],
  ['Stripe live key', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/],
  ['assigned secret', /\b(?:API_KEY|ACCESS_TOKEN|SECRET|PASSWORD|AUTH_TOKEN|PRIVATE_KEY)\s*[:=]\s*['"]?(?!\$|\{|process\.env|change-me|<|your|example|xxx|\*\*\*)[A-Za-z0-9+/_-]{24,}/],
];
const hits = [];
for (const f of files) {
  let text; try { if (statSync(f).size > 2_000_000) continue; text = readFileSync(f, 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  lines.forEach((line, i) => { for (const [name, re] of RULES) if (re.test(line) && !/\.test\.|fixtures\//.test(f)) hits.push(`${f}:${i + 1} ${name}`); });
}
console.log(`secret-scan: ${files.length} files, ${hits.length} finding(s)`);
for (const h of hits) console.log('  ' + h);
process.exit(hits.length ? 1 : 0);
