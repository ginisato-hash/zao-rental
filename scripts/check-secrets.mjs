import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const rules = [ /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/, /(?:sk-proj-|sk-ant-)[A-Za-z0-9_-]{20,}/, /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/ ];
const failures = [];
for (const file of new Set(files)) {
  if (!lstatSync(file).isFile()) { failures.push(file); continue; }
  if (file.startsWith('.env') && file !== '.env.example') { failures.push(file); continue; }
  if (rules.some(rule => rule.test(readFileSync(file, 'utf8')))) failures.push(file);
}
if (failures.length) { console.error('Possible secret paths (values withheld):', failures); process.exit(1); }
console.log(`PASS ${new Set(files).size} tracked/candidate files checked for private keys, provider tokens and credential-bearing DB URLs. Pattern scan is not comprehensive.`);
