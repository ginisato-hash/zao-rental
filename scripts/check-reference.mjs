import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(readFileSync('docs/execution/evidence/source-manifest.json', 'utf8'));
let count = 0;
for (const [path, hash] of Object.entries(manifest.files)) {
  if (['AGENTS.md', 'CLAUDE.md', 'README.md'].includes(path)) continue;
  if (createHash('sha256').update(readFileSync(path)).digest('hex') !== hash) throw new Error(`Reference changed: ${path}`);
  count++;
}
console.log(`PASS ${count} bootstrap specification/config/test files byte-identical; entrypoints intentionally integrated.`);
