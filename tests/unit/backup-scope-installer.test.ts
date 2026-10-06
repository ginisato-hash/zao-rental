import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';

// The Owner-run ZAO_R49_BACKUP_V1 installer (v2) pins the backup helper and its direct imports byte for byte. This test keeps those pins equal to the repository: a change to a pinned
// file (such as the corrected client-TLS probe) cannot merge without re-pinning the installer and its README, and re-pinning cannot be skipped to make the suite green.
// It is never run against the Owner's real settings: the behavioural tests use a synthetic HOME and a synthetic copy of the pinned files (macOS only, like the installer).
const INSTALLER='docs/execution/release-code-closure/backup-scope-v2/ZAO_Claude_Backup_Scope_Setup_v2.py';
const README='docs/execution/release-code-closure/backup-scope-v2/README.md';
const text=readFileSync(INSTALLER,'utf8');
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const SYMBOLS:Record<string,string>={HELPER:'scripts/production-backup-credential.ts',OBJECT_GET:'scripts/production-backup-object-get.ts'};
const block=(name:string)=>{const m=new RegExp(`${name} = \\{[^\\n]*\\n([\\s\\S]*?)\\n\\}\\n`).exec(text);assert.ok(m,name+' block');return m![1]!;};
const pinned=Object.fromEntries([...block('PINNED_FILES').matchAll(/^\s*(HELPER|OBJECT_GET|"[^"]+"):\s*"([a-f0-9]{64})",?$/gm)].map(x=>[SYMBOLS[x[1]!]??x[1]!.replace(/"/g,''),x[2]!])) as Record<string,string>;
const scripts=Object.fromEntries([...block('HELPER_COMMANDS').matchAll(/^\s*"([^"]+)":\s*"([^"]+)",?(?:\s*#.*)?$/gm)].map(x=>[x[1]!,x[2]!])) as Record<string,string>;

test('the installer pins exactly the backup helper chain of the repository (and the README says so), and its package scripts are the repository\'s',()=>{
 assert.deepEqual(Object.keys(pinned).sort(),['scripts/production-backup-credential.ts','scripts/production-backup-object-get.ts','scripts/production-backup.ts','scripts/production-credential-activation.ts']);
 for(const [file,digest] of Object.entries(pinned))assert.equal(sha(readFileSync(file)),digest,`${file} differs from the pin: re-pin the installer and its README (and have both reviewed again)`);
 const pkg=JSON.parse(readFileSync('package.json','utf8')) as {scripts:Record<string,string>};
 assert.deepEqual(Object.keys(scripts).sort(),['backup:object-get','backup:role-contain','backup:role-finalize','backup:role-provision','backup:set-age-recipient']);
 for(const [name,cmd] of Object.entries(scripts))assert.equal(pkg.scripts[name],cmd,name);
 const readme=readFileSync(README,'utf8');
 for(const [file,digest] of Object.entries(pinned))assert.ok(readme.includes('`'+digest+'`'),`README pin table is missing the current pin of ${file}`);
 // the corrected helper: its probe proves the client transport and never asks the backend pg_stat_ssl row (Neon's proxy-to-compute row is false on a verified connection)
 const helper=readFileSync('scripts/production-backup-credential.ts','utf8');
 assert.ok(!/FROM pg_stat_ssl/.test(helper),'the probe must not query the backend pg_stat_ssl row');
 assert.ok(helper.includes('clientTransportVerified')&&helper.includes('enableChannelBinding:true')&&/ssl:\{rejectUnauthorized:true\}/.test(helper));
 // text-level guards on what the installer writes: no raw reset POST rule
 assert.ok(!/Bash\([^)]*(reset_password|-X POST)/.test(text));
});

const SETTINGS=()=>({permissions:{allow:['Bash(echo existing)'],ask:['Bash(rm *)'],deny:['Bash(curl http://evil.example)']},
 autoMode:{environment:['ZAO_R49_AUTONOMY_V1 environment','another environment entry'],allow:['ZAO_R49_AUTONOMY_V1 allow','another allow entry'],soft_deny:['soft'],hard_deny:['hard']},hooks:{PreToolUse:[]},model:'x'});
const REL='Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2';
function syntheticHome(){
 const home=mkdtempSync(join(tmpdir(),'zao-backup-home-')),wt=join(home,REL);
 for(const file of [...Object.keys(pinned),'package.json']){mkdirSync(dirname(join(wt,file)),{recursive:true});copyFileSync(file,join(wt,file));}
 const git=(...a:string[])=>assert.equal(spawnSync('git',a,{cwd:wt,encoding:'utf8'}).status,0,a.join(' '));
 git('init','-q');git('remote','add','origin','https://github.com/ginisato-hash/zao-rental.git');
 mkdirSync(join(home,'.claude'),{recursive:true,mode:0o700});
 writeFileSync(join(home,'.claude','settings.json'),JSON.stringify(SETTINGS(),null,2)+'\n',{mode:0o600});
 const real=spawnSync('/usr/bin/env',['python3','-c','import os,sys;print(os.path.realpath(sys.argv[1]))',home],{encoding:'utf8'}).stdout.trim()||home;
 return {home:real,wt};
}
const run=(home:string,...args:string[])=>spawnSync('python3',[INSTALLER,...args],{encoding:'utf8',env:{HOME:home,PATH:'/usr/bin:/bin',LANG:'C'} as unknown as NodeJS.ProcessEnv});
const json=(out:string)=>JSON.parse(out.slice(0,out.lastIndexOf('}')+1)) as {state:string;repository_mutations?:number;receipt?:string;added_tool_rules?:number;new_environment_entries?:number;new_classifier_allow_entries?:number;readback?:{state:string}};

test('synthetic HOME: preview writes nothing; apply adds exactly the 23 rules and 5+6 entries, preserves every other key, is idempotent, refreshes an earlier run of the same policy and undoes byte-exactly',{skip:process.platform!=='darwin'},()=>{
 const {home}=syntheticHome();
 try{
  const path=join(home,'.claude','settings.json'),original=readFileSync(path);
  const preview=run(home);assert.equal(preview.status,0,preview.stderr);
  const pv=json(preview.stdout);assert.equal(pv.state,'PREVIEW_ONLY');assert.equal(pv.repository_mutations,0);assert.deepEqual(readFileSync(path),original);
  assert.deepEqual([pv.added_tool_rules,pv.new_environment_entries,pv.new_classifier_allow_entries],[23,5,6]);

  const applied=run(home,'--apply');assert.equal(applied.status,0,applied.stderr);
  const summary=json(applied.stdout);assert.equal(summary.state,'SETTINGS_SAVED');assert.equal(summary.readback?.state,'DESKTOP_SESSION_READBACK_REQUIRED','saving is not an effective-configuration proof');
  type Lists=Record<string,Record<string,string[]>>;
  const before=SETTINGS() as unknown as Lists,after=JSON.parse(readFileSync(path,'utf8')) as Lists&{hooks:unknown;model:string};
  assert.deepEqual(after.permissions!.ask,before.permissions!.ask);assert.deepEqual(after.permissions!.deny,before.permissions!.deny);
  assert.deepEqual(after.autoMode!.soft_deny,before.autoMode!.soft_deny);assert.deepEqual(after.autoMode!.hard_deny,before.autoMode!.hard_deny);
  assert.deepEqual(after.hooks,(before as unknown as {hooks:unknown}).hooks);assert.equal(after.model,'x');
  for(const [outer,inner,added] of [['permissions','allow',23],['autoMode','environment',5],['autoMode','allow',6]] as const){
   const b=before[outer]![inner]!,a=after[outer]![inner]!;assert.deepEqual(a.slice(0,b.length),b);assert.equal(a.length-b.length,added,`${outer}.${inner}`);
  }
  const rules=after.permissions!.allow!.slice(1);
  for(const r of rules)assert.ok(!/reset_password|-X |--token|;|&&|\|\||\$\(|`/.test(r),'rule shape (no raw reset POST, token or shell composition): '+r);
  assert.ok(rules.some(r=>r.endsWith('run backup:role-provision)')));
  // the entries that carry the helper pin text name the CURRENT pin prefix
  const entries=[...after.autoMode!.environment!,...after.autoMode!.allow!].filter(e=>e.startsWith('ZAO_R49_BACKUP_V1'));
  assert.ok(entries.some(e=>e.includes(pinned['scripts/production-backup-credential.ts']!.slice(0,12))),'an entry names the current helper pin');
  assert.ok(!entries.some(e=>e.includes('e71a9ca8e9e2')),'no entry names the superseded pin');

  const saved=readFileSync(path);
  const again=run(home,'--apply');assert.equal(again.status,0);assert.equal(json(again.stdout).state,'ALREADY_SAVED');assert.deepEqual(readFileSync(path),saved);

  // refresh: settings saved from the earlier bytes (entries naming the superseded pin) are replaced by this run, not duplicated; everything else stays
  const stale=JSON.parse(readFileSync(path,'utf8')) as Lists;
  const staleText=(e:string)=>e.startsWith('ZAO_R49_BACKUP_V1')?e.split(pinned['scripts/production-backup-credential.ts']!.slice(0,12)).join('e71a9ca8e9e2'):e;
  stale.autoMode!.environment=stale.autoMode!.environment!.map(staleText);stale.autoMode!.allow=stale.autoMode!.allow!.map(staleText);
  writeFileSync(path,JSON.stringify(stale,null,2)+'\n');const staleBytes=readFileSync(path);
  const refreshed=run(home,'--apply');assert.equal(refreshed.status,0,refreshed.stderr);assert.equal(json(refreshed.stdout).state,'SETTINGS_SAVED');
  const afterRefresh=JSON.parse(readFileSync(path,'utf8')) as Lists;
  assert.deepEqual(afterRefresh.autoMode!.environment,after.autoMode!.environment);assert.deepEqual(afterRefresh.autoMode!.allow,after.autoMode!.allow);assert.deepEqual(afterRefresh.permissions!.allow,after.permissions!.allow);

  const receipt=json(refreshed.stdout).receipt as string;
  const undone=run(home,'--undo',receipt);assert.equal(undone.status,0,undone.stderr);assert.equal(json(undone.stdout).state,'RESTORED');
  assert.deepEqual(readFileSync(path),staleBytes,'undo restores the exact bytes that preceded the last apply');
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('synthetic HOME: a changed pinned file or package script, a missing autonomy policy and another origin are refused, and nothing is written',{skip:process.platform!=='darwin'},()=>{
 const refused=(label:string,prepare:(h:{home:string;wt:string})=>void,settings?:unknown)=>{
  const h=syntheticHome();
  try{
   if(settings!==undefined)writeFileSync(join(h.home,'.claude','settings.json'),JSON.stringify(settings,null,2)+'\n');
   prepare(h);
   const path=join(h.home,'.claude','settings.json'),before=readFileSync(path);
   const r=run(h.home,'--apply');
   assert.equal(r.status,2,label+' '+r.stdout);assert.match(r.stderr,/SETUP_STOPPED/,label);
   assert.deepEqual(readFileSync(path),before,label+': settings untouched');
   assert.ok(!readdirSync(join(h.home,'.claude')).some(n=>n.startsWith('zao-backup-scope')),label+': no backup directory');
  }finally{rmSync(h.home,{recursive:true,force:true});}
 };
 for(const file of Object.keys(pinned))refused('changed '+file,({wt})=>writeFileSync(join(wt,file),readFileSync(file,'utf8')+'\n// x\n'));
 refused('the previously pinned helper bytes (a stale helper)',({wt})=>writeFileSync(join(wt,'scripts/production-backup-credential.ts'),readFileSync(join(wt,'scripts/production-backup-credential.ts'),'utf8').replace('clientTransportVerified','pgStatSslBackendRow')));
 refused('package script changed',({wt})=>{const p=JSON.parse(readFileSync(join(wt,'package.json'),'utf8')) as {scripts:Record<string,string>};p.scripts['backup:role-provision']+=' --force';writeFileSync(join(wt,'package.json'),JSON.stringify(p));});
 refused('autonomy policy not saved',()=>undefined,{permissions:{allow:[]},autoMode:{environment:['x'],allow:['y']}});
 refused('origin is another repository',({wt})=>{spawnSync('git',['remote','set-url','origin','https://github.com/someone-else/repo.git'],{cwd:wt});});
});
