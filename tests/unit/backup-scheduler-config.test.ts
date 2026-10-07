import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker,{TARGET_CRON,TARGET_REF,TARGET_REPO,TARGET_WORKFLOW} from '../../apps/backup-scheduler-worker/src/index';

// The Cron Trigger of the Production backup Worker is registered by its wrangler.toml and by nothing else. There is no TOML parser in this repository
// (and none is added), so the file is checked closed-world: after comments and blank lines are removed, EXACTLY these five lines may remain. Any other key
// or table (a second cron, route, binding, variable, workers_dev, env override, ...) makes the file differ and fails the test.
const CONFIG='apps/backup-scheduler-worker/wrangler.toml',SOURCE='apps/backup-scheduler-worker/src/index.ts';
const active=(text:string)=>text.split('\n').map(l=>l.trim()).filter(l=>l!==''&&!l.startsWith('#'));
const EXPECTED_ACTIVE=['name = "zao-rental-production-backup-scheduler"','main = "src/index.ts"','compatibility_date = "2026-09-21"','[triggers]','crons = ["17 * * * *"]'];

test('wrangler config registers exactly one cron "17 * * * *" and nothing else; the Worker name is unchanged',()=>{
 const lines=active(readFileSync(CONFIG,'utf8'));
 assert.deepEqual(lines,EXPECTED_ACTIVE);
 assert.equal(lines.filter(l=>l.startsWith('crons')).length,1);
 const cron=/^crons = \["([^"]+)"\]$/.exec(lines.find(l=>l.startsWith('crons'))!)![1];
 assert.equal(cron,'17 * * * *');
 assert.equal(cron,TARGET_CRON);
 assert.equal(/^name = "([^"]+)"$/.exec(lines[0]!)![1],'zao-rental-production-backup-scheduler');
 assert.ok(!lines.some(l=>/^\[\[?(?!triggers\])/.test(l)),'no other table');
});

test('dispatch target is fixed: ginisato-hash/zao-rental, production-backup.yml, ref main',()=>{
 assert.equal(TARGET_REPO,'ginisato-hash/zao-rental');
 assert.equal(TARGET_WORKFLOW,'production-backup.yml');
 assert.equal(TARGET_REF,'main');
});

test('the Worker exposes no public fetch handler (scheduled only)',()=>{
 assert.deepEqual(Object.keys(worker),['scheduled']);
 assert.equal((worker as unknown as {fetch?:unknown}).fetch,undefined);
 assert.ok(!/\bfetch\s*\(\s*(request|req)\b|async\s+fetch\s*\(/.test(readFileSync(SOURCE,'utf8').replace(/fetchImpl|typeof fetch|= fetch/g,'')),'no fetch(request) handler in the source');
});

test('no token value exists in the Worker source or config: only the secret NAME is referenced',()=>{
 for(const file of [CONFIG,SOURCE]){
  const text=readFileSync(file,'utf8');
  assert.ok(!/github_pat_[A-Za-z0-9_]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9_\-.]{20,}/.test(text),`${file}: no token-shaped literal`);
  assert.ok(!/^\s*\[(vars|env)/m.test(text)&&!/GITHUB_ACTIONS_DISPATCH_TOKEN\s*=/.test(text),`${file}: no variable/secret assignment`);
 }
 assert.ok(readFileSync(SOURCE,'utf8').includes('env.GITHUB_ACTIONS_DISPATCH_TOKEN'),'the token is read from the Worker secret binding only');
});

test('the closed-world check rejects every kind of drift (checked on in-memory variants, never on the file)',()=>{
 const good=readFileSync(CONFIG,'utf8');
 const variants:Record<string,string>={
  'second cron':good.replace('crons = ["17 * * * *"]','crons = ["17 * * * *", "0 * * * *"]'),
  'other cron':good.replace('17 * * * *','* * * * *'),
  'cron removed':good.replace('crons = ["17 * * * *"]','# crons = ["17 * * * *"]'),
  'trigger table removed':good.replace('\n[triggers]\n','\n# [triggers]\n'),
  'renamed worker':good.replace('zao-rental-production-backup-scheduler','other-worker'),
  'route added':good+'\nroutes = ["example.com/*"]\n',
  'workers_dev added':good+'\nworkers_dev = true\n',
  'plaintext var added':good+'\n[vars]\nX = "y"\n',
  'binding added':good+'\n[[kv_namespaces]]\nbinding = "K"\nid = "1"\n',
  'env override added':good+'\n[env.staging]\nname = "s"\n',
 };
 for(const [name,text] of Object.entries(variants))assert.notDeepEqual(active(text),EXPECTED_ACTIVE,name);
 assert.deepEqual(active(good),EXPECTED_ACTIVE);
});
