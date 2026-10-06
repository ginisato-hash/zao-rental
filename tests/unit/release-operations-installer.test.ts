import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';

// Review material for the Owner-run ZAO_RELEASE_OPERATIONS_V1 settings addition. The installer is never run against the Owner's real settings here: the behavioural test uses a synthetic HOME
// (macOS only, like the installer itself) and a synthetic copy of the pinned files.
const INSTALLER='docs/execution/release-code-closure/release-operations-v1/ZAO_Claude_Release_Operations_Setup_v1.py';
const text=readFileSync(INSTALLER,'utf8');
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const dictOf=(name:string)=>{
 const m=new RegExp(`${name} = \\{[^\\n]*\\n([\\s\\S]*?)\\n\\}\\n`).exec(text);
 assert.ok(m,name+' block');
 return Object.fromEntries([...m![1]!.matchAll(/^\s*"([^"]+)":\s*"([^"]+)",?(?:\s*#.*)?$/gm)].map(x=>[x[1]!,x[2]!])) as Record<string,string>;
};
const pinned={...dictOf('PINNED_FILES'),...dictOf('BACKUP_PINNED_FILES')};
const scripts=dictOf('LIFECYCLE_COMMANDS');

test('the installer pins exactly the files it reviews, and its package scripts are the repository\'s',()=>{
 assert.ok(Object.keys(pinned).length>=15);
 for(const [file,digest] of Object.entries(pinned))assert.equal(sha(readFileSync(file)),digest,`${file} differs from the pin: re-pin the installer (and have it reviewed again)`);
 const pkg=JSON.parse(readFileSync('package.json','utf8')) as {scripts:Record<string,string>};
 for(const [name,cmd] of Object.entries(scripts))assert.equal(pkg.scripts[name],cmd,name);
 // the reviewed lifecycle commands of this policy
 assert.deepEqual(Object.keys(scripts).sort(),['monitor:worker-freshness','production:install-normal-worker-grants','production:install-normal-worker-migration','production:restore-evidence-finalize','production:worker-bind-cron-secret','production:worker-dormant-proof','production:worker-roles-contain','production:worker-roles-provision']);
 // the backup installer's pins are the ones PR #50 merged (not re-pinned here)
 // (the repository copy is pinned to the corrected helper; the settings already applied from the earlier installer bytes stay effective and are not re-applied)
 assert.equal(pinned['scripts/production-backup-credential.ts'],'ce064babfd6b1dae15e3d7370858b1d82ba65e4d9e66c02df29986604be08da7');
 // text-level guards: no raw POST / PATCH / protection / password verbs anywhere in what the file writes
 for(const forbidden of ['reset_password','-X POST','-X PATCH','ssoProtection','--sensitive ','env pull','vercel login','--token'])assert.ok(!text.includes(forbidden)||forbidden==='--sensitive ' ,forbidden);
});

const SETTINGS=()=>({permissions:{allow:['Bash(echo existing)'],ask:['Bash(rm *)'],deny:['Bash(curl http://evil.example)']},
 autoMode:{environment:['ZAO_R49_AUTONOMY_V1 environment','another environment entry'],allow:['ZAO_R49_AUTONOMY_V1 allow','another allow entry'],soft_deny:['soft'],hard_deny:['hard']},hooks:{PreToolUse:[]},model:'x'});
const REL='Documents/Codex/2026-10-03/files-pasted-by-the-user-zao/work/f2';

function syntheticHome(settings:unknown=SETTINGS()){
 const home=mkdtempSync(join(tmpdir(),'zao-relops-home-')),wt=join(home,REL);
 for(const file of [...Object.keys(pinned),'package.json']){mkdirSync(dirname(join(wt,file)),{recursive:true});copyFileSync(file,join(wt,file));}
 const git=(...a:string[])=>assert.equal(spawnSync('git',a,{cwd:wt,encoding:'utf8'}).status,0,a.join(' '));
 git('init','-q');git('remote','add','origin','https://github.com/ginisato-hash/zao-rental.git');
 mkdirSync(join(home,'.claude'),{recursive:true,mode:0o700});
 if(settings!==undefined)writeFileSync(join(home,'.claude','settings.json'),JSON.stringify(settings,null,2)+'\n',{mode:0o600});
 // resolve /var -> /private/var the way the installer does
 return {home:spawnSync('/usr/bin/env',['python3','-c','import os,sys;print(os.path.realpath(sys.argv[1]))',home],{encoding:'utf8'}).stdout.trim()||home,wt};
}
const run=(home:string,...args:string[])=>spawnSync('python3',[INSTALLER,...args],{encoding:'utf8',env:{HOME:home,PATH:'/usr/bin:/bin',LANG:'C'} as unknown as NodeJS.ProcessEnv});
const json=(out:string)=>JSON.parse(out.slice(0,out.lastIndexOf('}')+1)) as {state:string;repository_mutations?:number;receipt?:string;readback?:{state:string}};

test('synthetic HOME: preview writes nothing, apply is additive and idempotent, preserves every other key and undoes byte-exactly',{skip:process.platform!=='darwin'},()=>{
 const {home}=syntheticHome();
 try{
  const path=join(home,'.claude','settings.json');
  const original=readFileSync(path);
  const preview=run(home);
  assert.equal(preview.status,0,preview.stderr);
  assert.equal(json(preview.stdout).state,'PREVIEW_ONLY');assert.deepEqual(readFileSync(path),original,'preview writes nothing');
  assert.equal(json(preview.stdout).repository_mutations,0);

  const manifest=json(run(home,'--print-manifest').stdout) as unknown as {'permissions.allow':string[];'autoMode.environment':string[];'autoMode.allow':string[]};
  const rules=manifest['permissions.allow'];
  assert.ok(rules.length>=30);
  for(const r of rules){
   assert.match(r,/^(Bash|Edit)\(.+\)$/,r);
   assert.ok(!/ api |reset_password|-X |ssoProtection|--sensitive|env pull|login|--token|;|&&|\|\||\$\(|`/.test(r),'no raw API, write verb, protection, token or shell composition: '+r);
  }
  // wildcards are only the single canonical value / id / glob the manifest documents
  const wild=rules.filter(r=>r.includes('*')&&!r.startsWith('Edit(')).map(r=>r.replace(/^Bash\(\S*\/vercel /,'Bash(vercel ')).sort();
  const target='--project prj_ehUMOzM77em9DVnHJBJffncD5hg7 --scope zao-food-map';
  assert.deepEqual(wild,[
   `Bash(vercel env add PRODUCTION_PUBLICATION_APPROVAL production --value * --no-sensitive --yes ${target})`,
   `Bash(vercel env add PRODUCTION_RELEASE_ID production --value * --no-sensitive --yes ${target})`,
   `Bash(vercel env add PRODUCTION_WORKER_ACCEPTED_AFTER production --value * --no-sensitive --yes ${target})`,
   'Bash(vercel inspect dpl_* --scope zao-food-map)',
  ],'wildcard rules');
  for(const bad of ['https://salomon-rental.yuge-zao.com.evil','/v9/projects'])assert.ok(!rules.some(r=>r.includes(bad)),bad);
  // the parent domain is never addressed: every mention of yuge-zao.com is the one host
  for(const r of rules)for(const m of r.matchAll(/yuge-zao\.com/g))assert.equal(r.slice(Math.max(0,m.index!-'salomon-rental.'.length),m.index),'salomon-rental.',r);
  assert.ok(manifest['autoMode.environment'].every(e=>e.startsWith('ZAO_RELEASE_OPERATIONS_V1'))&&manifest['autoMode.allow'].every(e=>e.startsWith('ZAO_RELEASE_OPERATIONS_V1')));

  const applied=run(home,'--apply');
  assert.equal(applied.status,0,applied.stderr);
  const summary=json(applied.stdout);
  assert.equal(summary.state,'SETTINGS_SAVED');
  assert.equal(summary.readback?.state,'DESKTOP_SESSION_READBACK_REQUIRED','saving is not an effective-configuration proof');
  const after=JSON.parse(readFileSync(path,'utf8')) as ReturnType<typeof SETTINGS>;
  type Lists=Record<string,Record<string,string[]>>;
  const before=SETTINGS();
  // preservation: ask/deny/soft/hard deny, hooks, model and every earlier entry are untouched; only additions
  assert.deepEqual(after.permissions.ask,before.permissions.ask);assert.deepEqual(after.permissions.deny,before.permissions.deny);
  assert.deepEqual(after.autoMode.soft_deny,before.autoMode.soft_deny);assert.deepEqual(after.autoMode.hard_deny,before.autoMode.hard_deny);
  assert.deepEqual(after.hooks,before.hooks);assert.equal(after.model,'x');
  for(const [outer,inner] of [['permissions','allow'],['autoMode','environment'],['autoMode','allow']] as const){
   const b=(before as unknown as Lists)[outer]![inner]!,a=(after as unknown as Lists)[outer]![inner]!;
   assert.deepEqual(a.slice(0,b.length),b);assert.ok(a.length>b.length);
  }
  assert.deepEqual(after.permissions.allow.slice(1),rules);
  // idempotent
  const savedBytes=readFileSync(path);
  const again=run(home,'--apply');assert.equal(again.status,0);assert.equal(json(again.stdout).state,'ALREADY_SAVED');assert.deepEqual(readFileSync(path),savedBytes);
  // undo restores the original bytes only while settings are unchanged since
  const receipt=summary.receipt as string;
  const edited=JSON.parse(readFileSync(path,'utf8')) as Record<string,unknown>;edited.model='y';writeFileSync(path,JSON.stringify(edited,null,2)+'\n');
  const refused=run(home,'--undo',receipt);assert.equal(refused.status,2);assert.match(refused.stderr,/SETUP_STOPPED/);
  writeFileSync(path,savedBytes);
  const undone=run(home,'--undo',receipt);assert.equal(undone.status,0,undone.stderr);assert.equal(json(undone.stdout).state,'RESTORED');assert.deepEqual(readFileSync(path),original);
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('synthetic HOME: the installer refuses a changed pinned file or package script, a missing autonomy policy and a missing settings file, and writes nothing',{skip:process.platform!=='darwin'},()=>{
 const refused=(label:string,prepare:(h:{home:string;wt:string})=>void,settings:unknown=SETTINGS())=>{
  const h=syntheticHome(settings);
  try{
   prepare(h);
   const path=join(h.home,'.claude','settings.json');
   let before:Buffer|null=null;try{before=readFileSync(path);}catch{/* absent */}
   const r=run(h.home,'--apply');
   assert.equal(r.status,2,label+' '+r.stdout);assert.match(r.stderr,/SETUP_STOPPED/,label);
   let after:Buffer|null=null;try{after=readFileSync(path);}catch{/* absent */}
   assert.deepEqual(after,before,label+': settings untouched');
   assert.ok(!readdirSync(join(h.home,'.claude')).some(n=>n.startsWith('zao-release-ops')),label+': no backup directory');
  }finally{rmSync(h.home,{recursive:true,force:true});}
 };
 refused('lifecycle file changed',({wt})=>writeFileSync(join(wt,'scripts/production-worker-credential.ts'),readFileSync('scripts/production-worker-credential.ts','utf8')+'\n// x\n'));
 refused('migration SQL changed',({wt})=>writeFileSync(join(wt,'packages/db/migrations/0055_normal_production_worker.sql'),readFileSync('packages/db/migrations/0055_normal_production_worker.sql','utf8')+'\n-- x\n'));
 refused('backup helper changed',({wt})=>writeFileSync(join(wt,'scripts/production-backup-credential.ts'),readFileSync('scripts/production-backup-credential.ts','utf8')+'\n// x\n'));
 refused('package script changed',({wt})=>{const p=JSON.parse(readFileSync(join(wt,'package.json'),'utf8')) as {scripts:Record<string,string>};p.scripts['production:worker-roles-provision']+=' --force';writeFileSync(join(wt,'package.json'),JSON.stringify(p));});
 refused('autonomy policy not saved',()=>undefined,{permissions:{allow:[]},autoMode:{environment:['x'],allow:['y']}});
 refused('permissions object missing',()=>undefined,{autoMode:{environment:['ZAO_R49_AUTONOMY_V1 e'],allow:['ZAO_R49_AUTONOMY_V1 a']}});
 refused('settings file missing',({home})=>rmSync(join(home,'.claude','settings.json')),undefined);
 refused('origin is another repository',({wt})=>{spawnSync('git',['remote','set-url','origin','https://github.com/someone-else/repo.git'],{cwd:wt});});
});
