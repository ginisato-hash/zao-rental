import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BACKUP_CREDENTIAL_TARGET as T} from '../../scripts/production-backup-credential';
import {MAIN_PROJECT,WEBHOOK_PROJECT,type EnvMeta} from '../../scripts/production-cutover-bindings';
import {credentialSinks,issueCredentials,receiverUri,sinkWritten,vercelWritePort,neonReadPort,CREDENTIALS_STATE_FILE,MAX_ATTEMPTS,type CredentialPorts,type SqlSession,type VercelWritePort} from '../../scripts/production-cutover-credentials';
import {switchBackupCredential} from '../../scripts/production-cutover-window-hooks';

const TARGET='neondb_v65';
const SYNTH='ep-synthetic-0001.us-east-2.aws.neon.tech';

const neonFor=(host:string,over:Record<string,unknown>={})=>({get:async(path:string)=>{
 const base=`/projects/${T.project}`,branch=`${base}/branches/${T.branch}`;
 if(path===base)return {project:{id:T.project}};
 if(path===branch)return {branch:{id:T.branch}};
 if(path===`${branch}/databases/${TARGET}`)return {database:{name:TARGET,owner_name:T.owner}};
 if(path===`${branch}/roles`){return {roles:[T.owner,TARGET+'_role_admin',...credentialSinks(TARGET).map(s=>s.role)].map(name=>({name}))};}
 if(path===`${branch}/endpoints`)return {endpoints:[{type:'read_write',branch_id:T.branch,host}]};
 throw new Error('unexpected '+path);
},...over});

class FakeVercel implements VercelWritePort{
 rows:Record<string,EnvMeta[]>;calls:Array<{project:string;key:string;len:number}>=[];values:string[]=[];failNext=0;noMetadataUpdate=false;clock=1_000_000;
 constructor(){const sinks=credentialSinks(TARGET);this.rows={[MAIN_PROJECT]:[],[WEBHOOK_PROJECT]:[]};
  for(const s of sinks)this.rows[s.project]!.push({key:s.key,type:'sensitive',target:'production',updatedAt:1});}
 async upsertSensitive(project:string,key:string,value:string){
  if(this.failNext>0){this.failNext--;throw new Error('PRODUCTION_CUTOVER_CREDENTIALS_VERCEL_CALL_FAILED');}
  this.calls.push({project,key,len:value.length});this.values.push(value);
  if(!this.noMetadataUpdate){const r=this.rows[project]!.find(x=>x.key===key)!;r.updatedAt=Date.now();}
 }
 async metadata(project:string){return this.rows[project]!.map(r=>({...r}));}
}
function session(log:string[],roles:Map<string,boolean>):SqlSession{
 return {end:async()=>{log.push('END');},query:async(sql:string,params?:unknown[])=>{
  log.push(sql.replace(/PASSWORD '[^']+'/,"PASSWORD '<redacted>'"));
  if(/FROM pg_roles WHERE rolname=\$1/.test(sql)){const n=params![0] as string;return {rows:roles.has(n)?[{rolcanlogin:roles.get(n)!}]:[]} as never;}
  if(/rolname=ANY/.test(sql)){return {rows:[...roles.entries()].map(([rolname,rolcanlogin])=>({rolname,rolcanlogin}))} as never;}
  return {rows:[]} as never;
 }};
}
const root=()=>mkdtempSync(join(tmpdir(),'zao-cred-'));
function ports(vercel:VercelWritePort,r:string,log:string[],roles:Map<string,boolean>,host:string):CredentialPorts{
 return {neon:neonFor(host),vercel,root:r,now:()=>new Date(),release:()=>'accepted-main',openOwner:async()=>session(log,roles),...(host===SYNTH?{admitHost:()=>undefined}:{})};
}
const allRoles=(login=false)=>new Map(credentialSinks(TARGET).map(s=>[s.role,login] as [string,boolean]));

test('sinks: exactly the 16 Vercel NEW_SECRET rows (12 DB + 3 worker + receiver); never a backup, owner or manager role',()=>{
 const s=credentialSinks(TARGET);
 assert.equal(s.length,16);
 assert.equal(s.filter(x=>x.project===MAIN_PROJECT).length,15);
 assert.equal(s.filter(x=>x.project===WEBHOOK_PROJECT).length,1);
 assert.ok(s.every(x=>x.role.startsWith(TARGET+'_')&&!/backup|owner|role_admin/.test(x.role)));
 assert.ok(!s.some(x=>/BACKUP/.test(x.key)));
 assert.throws(()=>credentialSinks('neondb'),{message:'CUTOVER_BINDINGS_TARGET_REFUSED'});
});

test('receiver URI: direct host, target database, verify-full, encoded password',()=>{
 const u=new URL(receiverUri('neondb_v65_pay_receipt','a/b+c=','ep-x.example.neon.tech','neondb_v65'));
 assert.equal(u.protocol,'postgresql:');assert.equal(u.hostname,'ep-x.example.neon.tech');assert.equal(u.pathname,'/neondb_v65');
 assert.equal(u.searchParams.get('sslmode'),'verify-full');assert.equal(decodeURIComponent(u.password),'a/b+c=');assert.equal(u.username,'neondb_v65_pay_receipt');
});

test('sink readback: exactly one sensitive production row updated since the write; anything else fails',()=>{
 const row=(o:Partial<EnvMeta>={}):EnvMeta=>({key:'K',type:'sensitive',target:'production',updatedAt:100,...o});
 assert.equal(sinkWritten([row()],'K',100),true);
 assert.equal(sinkWritten([row({updatedAt:99})],'K',100),false);
 assert.equal(sinkWritten([row({type:'encrypted'})],'K',100),false);
 assert.equal(sinkWritten([row({target:'production,preview'})],'K',100),false);
 assert.equal(sinkWritten([row(),row()],'K',100),false);
 assert.equal(sinkWritten([],'K',100),false);
 assert.equal(sinkWritten([row({updatedAt:null})],'K',100),false);
});

test('target admission refuses a synthetic endpoint host (pinned fingerprint) and issues nothing',async()=>{
 const r=root(),log:string[]=[],v=new FakeVercel();
 try{
  await assert.rejects(()=>issueCredentials({...ports(v,r,log,allRoles(),'ep-other.example.neon.tech')},TARGET));
  assert.equal(v.calls.length,0);assert.equal(log.length,0);
 }finally{rmSync(r,{recursive:true,force:true});}
});
test('refuses a target outside the allowlist before any call',async()=>{
 const r=root(),log:string[]=[],v=new FakeVercel();
 try{
  await assert.rejects(()=>issueCredentials(ports(v,r,log,allRoles(),'x'),'neondb'),{message:'PRODUCTION_CUTOVER_CREDENTIALS_TARGET_REFUSED'});
  await assert.rejects(()=>issueCredentials(ports(v,r,log,allRoles(),'x'),'zr_aaaaaaaaaaaa'),{message:'PRODUCTION_CUTOVER_CREDENTIALS_TARGET_REFUSED'});
  assert.equal(v.calls.length,0);
 }finally{rmSync(r,{recursive:true,force:true});}
});

const REAL_HOST='ep-synthetic-0001.us-east-2.aws.neon.tech';
const flow=test;
flow('issue: every sink gets a distinct 43-char secret over the manager path, roles stay NOLOGIN, only counts leave, state is durable and 0600',async()=>{
 const r=root(),log:string[]=[],v=new FakeVercel();
 try{
  const res=await issueCredentials(ports(v,r,log,allRoles(),REAL_HOST!),TARGET);
  assert.equal(res.issued.length,16);assert.equal(res.skipped.length,0);assert.equal(res.backupSinksTouched,0);assert.equal(res.valuesOutput,0);
  assert.equal(new Set(v.values).size,16);
  assert.ok(v.calls.filter(c=>c.project===WEBHOOK_PROJECT).length===1);
  assert.ok(log.filter(l=>/^ALTER ROLE/.test(l)).every(l=>/NOLOGIN PASSWORD '<redacted>' VALID UNTIL 'infinity'/.test(l)&&!/ LOGIN /.test(l.replace('NOLOGIN',''))));
  assert.ok(log.filter(l=>/^SET LOCAL ROLE/.test(l)).every(l=>l===`SET LOCAL ROLE "${TARGET}_role_admin"`));
  const out=JSON.stringify(res)+log.join('\n');
  for(const value of v.values)assert.ok(!out.includes(value));
  const st=join(r,'.local/evidence/production-cutover',CREDENTIALS_STATE_FILE);
  assert.ok(existsSync(st));assert.equal(statSync(st).mode&0o777,0o600);
  const state=JSON.parse(readFileSync(st,'utf8'));
  for(const value of v.values)assert.ok(!JSON.stringify(state).includes(value));
  assert.equal(Object.values(state.items as Record<string,{status:string}>).filter(i=>i.status==='SINK_WRITTEN').length,16);
 }finally{rmSync(r,{recursive:true,force:true});}
});
flow('rerun is idempotent: finished sinks are skipped, nothing is reissued',async()=>{
 const r=root(),v=new FakeVercel();
 try{
  await issueCredentials(ports(v,r,[],allRoles(),REAL_HOST!),TARGET);
  const n=v.calls.length;
  const again=await issueCredentials(ports(v,r,[],allRoles(),REAL_HOST!),TARGET);
  assert.equal(again.issued.length,0);assert.equal(again.skipped.length,16);assert.equal(v.calls.length,n);
 }finally{rmSync(r,{recursive:true,force:true});}
});
flow('a failed write is resumable: the unconfirmed sink is reissued once, finished ones are not, attempts are capped',async()=>{
 const r=root(),v=new FakeVercel();
 try{
  v.failNext=1;
  await assert.rejects(()=>issueCredentials(ports(v,r,[],allRoles(),REAL_HOST!),TARGET),{message:'PRODUCTION_CUTOVER_CREDENTIALS_VERCEL_CALL_FAILED'});
  const first=JSON.parse(readFileSync(join(r,'.local/evidence/production-cutover',CREDENTIALS_STATE_FILE),'utf8'));
  assert.equal(Object.values(first.items as Record<string,{status:string}>)[0]!.status,'PASSWORD_SET');
  const res=await issueCredentials(ports(v,r,[],allRoles(),REAL_HOST!),TARGET);
  assert.equal(res.issued.length,16);
  // attempts exhausted
  const st=join(r,'.local/evidence/production-cutover',CREDENTIALS_STATE_FILE);
  const s=JSON.parse(readFileSync(st,'utf8'));for(const k of Object.keys(s.items))s.items[k]={status:'PASSWORD_SET',attempts:MAX_ATTEMPTS};
  (await import('node:fs')).writeFileSync(st,JSON.stringify(s));
  await assert.rejects(()=>issueCredentials(ports(v,r,[],allRoles(),REAL_HOST!),TARGET),{message:'PRODUCTION_CUTOVER_CREDENTIALS_ATTEMPTS_EXHAUSTED'});
 }finally{rmSync(r,{recursive:true,force:true});}
});
flow('an unconfirmed readback fails closed; a role that is already LOGIN is refused; a missing sink variable is refused',async()=>{
 const r=root();
 try{
  const v=new FakeVercel();v.noMetadataUpdate=true;
  await assert.rejects(()=>issueCredentials(ports(v,r,[],allRoles(),REAL_HOST!),TARGET),{message:'PRODUCTION_CUTOVER_CREDENTIALS_SINK_READBACK_FAILED'});
  const r2=root();
  try{await assert.rejects(()=>issueCredentials(ports(new FakeVercel(),r2,[],allRoles(true),REAL_HOST!),TARGET),{message:'PRODUCTION_CUTOVER_CREDENTIALS_ROLE_ALREADY_LOGIN'});}finally{rmSync(r2,{recursive:true,force:true});}
  const r3=root(),v3=new FakeVercel();v3.rows[MAIN_PROJECT]!.shift();
  try{await assert.rejects(()=>issueCredentials(ports(v3,r3,[],allRoles(),REAL_HOST!),TARGET),{message:'PRODUCTION_CUTOVER_CREDENTIALS_SINK_SHAPE'});}finally{rmSync(r3,{recursive:true,force:true});}
 }finally{rmSync(r,{recursive:true,force:true});}
});

test('real write port: only the bound sinks are writable; the secret travels on stdin, never in argv',async()=>{
 const sinks=credentialSinks(TARGET);
 const dir=mkdtempSync(join(tmpdir(),'zao-vbin-'));
 try{
  const bin=join(dir,'fake-vercel.sh');
  (await import('node:fs')).writeFileSync(bin,'#!/bin/sh\necho "$@" > "$0.argv"\ncat > "$0.stdin"\n',{mode:0o700});
  const port=vercelWritePort(sinks,bin,{} as NodeJS.ProcessEnv);
  await assert.rejects(()=>port.upsertSensitive(MAIN_PROJECT,'PRODUCTION_BACKUP_PGPASSWORD','x'),{message:'PRODUCTION_CUTOVER_CREDENTIALS_SINK_REFUSED'});
  await assert.rejects(()=>port.upsertSensitive(WEBHOOK_PROJECT,'PRODUCTION_DB_PASSWORD_AUTH','x'),{message:'PRODUCTION_CUTOVER_CREDENTIALS_SINK_REFUSED'});
  const secret='S3cr3t-value-0123456789-abcdefghijklmnopqrstu';
  await port.upsertSensitive(MAIN_PROJECT,'PRODUCTION_DB_PASSWORD_AUTH',secret);
  const argv=readFileSync(bin+'.argv','utf8'),stdin=readFileSync(bin+'.stdin','utf8');
  assert.ok(!argv.includes(secret));assert.match(argv,/--input -/);assert.match(argv,/upsert=true/);
  const body=JSON.parse(stdin);assert.deepEqual(body,{key:'PRODUCTION_DB_PASSWORD_AUTH',value:secret,type:'sensitive',target:['production']});
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('neon read port refuses any path outside the target database, project and branch',async()=>{
 const port=neonReadPort(TARGET,'/nonexistent/neon');
 for(const p of['/projects/other','/projects/'+T.project+'/branches/br-other',`/projects/${T.project}/branches/${T.branch}/databases/neondb`,`/projects/${T.project}/connection_uri`,`/projects/${T.project}/branches/${T.branch}/roles/x/reset_password`])
  await assert.rejects(()=>port.get(p),{message:'PRODUCTION_CUTOVER_CREDENTIALS_NEON_PATH_REFUSED'});
});

test('window hook: provisions the selected database backup role only; fixed arguments; allowlist; failed state refused',async()=>{
 const seen:string[][]=[];
 const ok=await switchBackupCredential(TARGET,async(f,a)=>{seen.push([f,...a]);return 'noise\n'+JSON.stringify({state:'PROVISIONED'})+'\n';});
 assert.deepEqual(seen,[['npm','run','--silent','backup:role-provision','--',`--database=${TARGET}`]]);
 assert.equal(ok.status,'PROVISIONED');assert.equal(ok.sinksRewritten,3);
 await assert.rejects(()=>switchBackupCredential('neondb',async()=>''),{message:'PRODUCTION_CUTOVER_HOOK_TARGET_REFUSED'});
 await assert.rejects(()=>switchBackupCredential(TARGET,async()=>JSON.stringify({state:'FAILED'})),{message:'PRODUCTION_CUTOVER_HOOK_BACKUP_FAILED'});
 await assert.rejects(()=>switchBackupCredential(TARGET,async()=>'not json'),{message:'PRODUCTION_CUTOVER_HOOK_BACKUP_FAILED'});
 await assert.rejects(()=>switchBackupCredential(TARGET,async()=>{throw new Error('PRODUCTION_CUTOVER_HOOK_CHILD_FAILED');}),{message:'PRODUCTION_CUTOVER_HOOK_CHILD_FAILED'});
});
