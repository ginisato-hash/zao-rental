import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fingerprintHost} from '../../scripts/production-backup';
import {BACKUP_CREDENTIAL_TARGET as T} from '../../scripts/production-backup-credential';
import type {SqlSession} from '../../scripts/production-backup-credential';
import * as w from '../../scripts/production-worker-credential';
import type {VercelEnvRow,WorkerCredentialPorts} from '../../scripts/production-worker-credential';

const HOST='ep-synthetic-0000.us-east-2.aws.neon.tech';
const OPS=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const POSTURE={attributes:'super=f,createdb=f,createrole=f,repl=f,bypassrls=f,inherit=f,connlimit=-1',memberships:[] as string[],grantees:[T.manager],owned:0,canConnect:true};
const initialState=()=>({rolcanlogin:false,rolvaliduntil:null as string|null,passwordIsNull:true as boolean,posture:{...POSTURE}});

function world(over:{failResetFor?:string;probeFails?:string;noDark?:boolean;noCron?:boolean;extraVercel?:VercelEnvRow[];states?:Record<string,Partial<ReturnType<typeof initialState>>>;containSqlFails?:number}={}){
 const log:string[]=[],sunk:Record<string,string>={},statements:string[]=[],passwords:Record<string,string>={};
 const claimed=new Set<string>();let posts=0,probes=0;let containFails=over.containSqlFails??0;
 const rows:VercelEnvRow[]=[...(over.noCron?[]:[{key:'CRON_SECRET',type:'sensitive',target:['production']}]),...(over.extraVercel??[])];
 const states:Record<string,ReturnType<typeof initialState>>={};
 for(const r of w.WORKER_ROLES)states[r.role]={...initialState(),...(over.states?.[r.role]??{})};
 const roleOf=(sql:string)=>/ALTER ROLE "([a-z_]+)"/.exec(sql)![1]!;
 const alter=(sql:string)=>{
  const role=roleOf(sql),st=states[role]!;
  if(/NOLOGIN PASSWORD NULL VALID UNTIL 'infinity'/.test(sql)){if(containFails>0){containFails--;throw new Error('boom');}st.rolcanlogin=false;st.passwordIsNull=true;st.rolvaliduntil='infinity';}
  else if(/NOLOGIN PASSWORD '[A-Za-z0-9_-]{43}' VALID UNTIL 'infinity'/.test(sql)){st.rolcanlogin=false;st.passwordIsNull=false;st.rolvaliduntil='infinity';}
  else if(/LOGIN VALID UNTIL '(.+)'$/.test(sql)){st.rolcanlogin=true;st.rolvaliduntil=/LOGIN VALID UNTIL '(.+)'$/.exec(sql)![1]!;}
  else if(/VALID UNTIL 'infinity'$/.test(sql))st.rolvaliduntil='infinity';
  else throw new Error('unexpected ALTER '+sql);
 };
 const owner=():SqlSession=>({
  async query(sql:string,params?:unknown[]){
   statements.push(sql);
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||sql.startsWith('SET LOCAL ROLE'))return {rows:[]} as never;
   if(sql.startsWith('ALTER ROLE')){alter(sql);return {rows:[]} as never;}
   if(sql.includes('clock_timestamp()'))return {rows:[{now:'2026-10-04 16:00:00.5+00'}]} as never;
   if(sql.includes('FROM pg_authid')){const st=states[String(params![0])]!;return {rows:[{passwordIsNull:st.passwordIsNull}]} as never;}
   if(sql.includes('FROM pg_roles r WHERE r.rolname=$1')){const st=states[String(params![0])]!;return {rows:[{rolcanlogin:st.rolcanlogin,rolvaliduntil:st.rolvaliduntil,...st.posture}]} as never;}
   throw new Error('unexpected owner SQL '+sql);
  },
  async end(){log.push('owner.end');},
 });
 const neon={
  async get(path:string):Promise<unknown>{
   log.push('neon.get '+path);
   if(path===`/projects/${T.project}`)return {project:{id:T.project}};
   if(path===`/projects/${T.project}/branches/${T.branch}`)return {branch:{id:T.branch}};
   if(path.endsWith('/databases/'+T.database))return {database:{name:T.database,owner_name:T.owner}};
   if(path.endsWith('/roles'))return {roles:[{name:T.manager},{name:T.owner},...w.WORKER_ROLES.map(r=>({name:r.role}))]};
   if(path.endsWith('/endpoints'))return {endpoints:[{type:'read_write',branch_id:T.branch,host:HOST}]};
   if(path.includes('/operations/')){const id=path.split('/').pop()!;return {operation:{id,status:'finished'}};}
   throw new Error('unexpected GET '+path);
  },
  async post(path:string):Promise<unknown>{
   posts++;log.push('neon.post '+path);
   const role=w.WORKER_ROLES.find(r=>path===w.workerResetPath(r.role));if(!role)throw new Error('unexpected POST '+path);
   if(over.failResetFor===role.role)throw new Error('socket hang up');
   const password='NeonPassword'+role.key+'0123456789abcdef';passwords[role.role]=password;
   return {role:{name:role.role,password},operations:[{id:OPS[w.WORKER_ROLES.indexOf(role)]!}]};
  },
 };
 const vercel={
  async envRows(){return rows.map(r=>({...r}));},
  async setSensitive(n:string,v:string){log.push('vercel.set '+n);sunk[n]=v;rows.push({key:n,type:'sensitive',target:['production']});},
  async remove(n:string){log.push('vercel.rm '+n);delete sunk[n];const i=rows.findIndex(r=>r.key===n);if(i>=0)rows.splice(i,1);},
 };
 const ports:WorkerCredentialPorts={neon,vercel,
  async connectOwner(){log.push('connectOwner');return owner();},
  async probe(role,password){probes++;log.push('probe '+role.key);if(over.probeFails===role.role)throw new Error('WORKER_CREDENTIAL_PROBE_FAILED');assert.equal(password,passwords[role.role]);return {tlsVerified:true,roleChecks:'PASS',signature:'EXECUTE',leaseValid:true};},
  guard:{exists:k=>claimed.has(k),claim:k=>{if(claimed.has(k))throw new Error('WORKER_CREDENTIAL_RESET_ALREADY_ATTEMPTED');claimed.add(k);log.push('guard.claim '+k);}},
  async sleep(){},now:()=>new Date(1_000_000+log.length),containmentSchedule:[0,0,0],expectedHostFingerprint:fingerprintHost(HOST),
  async darkProofVerified(){log.push('dark.verify');if(over.noDark)throw new Error('WORKER_DORMANT_PROOF_PROOF_MISSING');}};
 return {ports,log,sunk,rows,states,statements,passwords,get posts(){return posts;},get probes(){return probes;}};
}
const everything=(x:ReturnType<typeof world>)=>JSON.stringify(x.log);
const temporaries=(x:ReturnType<typeof world>)=>x.statements.flatMap(s=>/PASSWORD '([A-Za-z0-9_-]{43})'/.exec(s)?.[1]??[]);

test('CRON_SECRET is the first and only binding: random, sensitive, production-only; nothing of the worker plan exists',async()=>{
 const x=world({noCron:true});
 const ev=await w.bindCronSecret(x.ports);
 assert.equal(ev.state,'CRON_SECRET_BOUND');assert.deepEqual(Object.keys(x.sunk),['CRON_SECRET']);assert.ok(x.sunk.CRON_SECRET!.length>=32);assert.match(x.sunk.CRON_SECRET!,/^[A-Za-z0-9_-]+$/);
 assert.ok(!JSON.stringify(ev).includes(x.sunk.CRON_SECRET!)&&!everything(x).includes(x.sunk.CRON_SECRET!));
 await assert.rejects(w.bindCronSecret(x.ports),/WORKER_CREDENTIAL_CRON_SECRET_ALREADY_BOUND/);
 for(const name of ['PRODUCTION_WORKER_DB_PASSWORD_WORKER','PRODUCTION_WORKER_ACCEPTED_AFTER','PRODUCTION_WORKER_TICK_ACTIVATION']){
  const y=world({noCron:true,extraVercel:[{key:name,type:'plain',target:['production']}]});
  await assert.rejects(w.bindCronSecret(y.ports),/WORKER_CREDENTIAL_ACTIVATION_NAMES_PRESENT/);assert.deepEqual(Object.keys(y.sunk),[]);
 }
});

test('provision runs the three roles serially, one POST each, sinks only after the probe, activation strictly last per role, no secret in any event',async()=>{
 const x=world();
 const ev=await w.provisionWorkerRoles(x.ports);
 assert.equal(ev.state,'WORKER_ROLES_ACTIVE');assert.equal(x.posts,3);assert.equal(ev.resetPostCount,3);assert.equal(ev.leaseMinutes,20);
 assert.deepEqual(ev.roles,['neondb_pay_dispatch','neondb_pay_truth','neondb_pay_projection']);
 assert.deepEqual(Object.keys(x.sunk).sort(),w.WORKER_ROLES.map(r=>r.sink).sort());
 for(const r of w.WORKER_ROLES){assert.equal(x.sunk[r.sink],x.passwords[r.role]);const st=x.states[r.role]!;assert.deepEqual([st.rolcanlogin,st.rolvaliduntil],[true,'infinity']);}
 // serial order: for each role claim -> post -> probe -> sink
 const marks=x.log.filter(l=>/^(guard\.claim|neon\.post|probe|vercel\.set)/.test(l)).map(l=>l.split(' ')[0]!+(l.startsWith('neon.post')?'':' '+l.split(' ').pop()!.replace(/^.*\//,'')));
 assert.equal(marks.filter(m=>m.startsWith('neon.post')).length,3);
 const firstProbe=x.log.findIndex(l=>l.startsWith('probe dispatcher')),firstSet=x.log.findIndex(l=>l==='vercel.set PRODUCTION_WORKER_DB_PASSWORD_DISPATCHER'),secondPost=x.log.findIndex(l=>l.includes('/neondb_pay_truth/reset_password'));
 assert.ok(firstProbe>=0&&firstProbe<firstSet&&firstSet<secondPost,'role 1 is complete before role 2 starts');
 // 20-minute database-clock lease, manager SET before each ALTER
 assert.ok(x.statements.includes(`ALTER ROLE "neondb_pay_dispatch" LOGIN VALID UNTIL '2026-10-04T16:20:00.5Z'`));
 for(const [i,s] of x.statements.entries())if(s.startsWith('ALTER ROLE')){assert.equal(x.statements[i-1],'SET LOCAL ROLE "neondb_role_admin"');assert.equal(x.statements[i-2],'BEGIN');}
 for(const secret of [...Object.values(x.passwords),...temporaries(x),'OwnerSecret0123']){assert.ok(!everything(x).includes(secret));assert.ok(!JSON.stringify(ev).includes(secret));}
 assert.equal(temporaries(x).length,3);
});

test('preconditions refuse before any session, ALTER or POST: dark proof, CRON_SECRET, pre-bound names, an earlier reset attempt',async()=>{
 const cases:Array<[string,Parameters<typeof world>[0],string]>=[
  ['no dark proof',{noDark:true},'WORKER_CREDENTIAL_DARK_PROOF_REQUIRED'],
  ['no CRON_SECRET',{noCron:true},'WORKER_CREDENTIAL_CRON_SECRET_REQUIRED'],
  ['sink already bound',{extraVercel:[{key:'PRODUCTION_WORKER_DB_PASSWORD_WORKER',type:'sensitive',target:['production']}]},'WORKER_CREDENTIAL_PRECONDITION_NOT_CLEAN'],
  ['activation token already bound',{extraVercel:[{key:'PRODUCTION_WORKER_TICK_ACTIVATION',type:'plain',target:['production']}]},'WORKER_CREDENTIAL_PRECONDITION_NOT_CLEAN'],
 ];
 for(const [name,over,code] of cases){
  const x=world(over);
  await assert.rejects(w.provisionWorkerRoles(x.ports),(e:Error&{contained?:unknown})=>{assert.equal(e.message,code,name);assert.equal(e.contained,undefined,name);return true;});
  assert.equal(x.posts,0,name);assert.ok(!x.log.includes('connectOwner'),name);assert.equal(x.statements.filter(s=>s.startsWith('ALTER')).length,0,name);
  if(name==='no dark proof')assert.deepEqual(x.log,['dark.verify'],'the gate is the only thing that ran: no Neon read, Vercel call or guard claim before it');
 }
 const y=world();y.ports.guard.claim('worker');
 await assert.rejects(w.provisionWorkerRoles(y.ports),/WORKER_CREDENTIAL_RESET_ALREADY_ATTEMPTED/);assert.equal(y.posts,0);
});

test('baseline and posture drift of any role refuse before its ALTER; earlier clean roles are not touched either',async()=>{
 for(const [name,states] of [
  ['already LOGIN',{neondb_pay_truth:{rolcanlogin:true}}],
  ['stale lease',{neondb_pay_dispatch:{rolvaliduntil:'2026-10-03 00:00:00+00'}}],
  ['inherit on',{neondb_pay_projection:{posture:{...POSTURE,attributes:POSTURE.attributes.replace('inherit=f','inherit=t')}}}],
  ['membership',{neondb_pay_truth:{posture:{...POSTURE,memberships:['pg_read_all_data']}}}],
 ] as Array<[string,Record<string,Partial<ReturnType<typeof initialState>>>]>){
  const x=world({states});
  await assert.rejects(w.provisionWorkerRoles(x.ports),Error,name);
  // the only role that may have been processed is one that precedes the drifted one in the fixed order
  assert.ok(x.posts<=2,name);
 }
});

test('an unknown reset outcome contains only the failing role, keeps finished roles and never resends',async()=>{
 const x=world({failResetFor:'neondb_pay_truth'});
 await assert.rejects(w.provisionWorkerRoles(x.ports),(e:Error&{contained?:{state:string;rolesContained:string[]}})=>{
  assert.equal(e.message,'WORKER_CREDENTIAL_RESET_OUTCOME_UNKNOWN');assert.equal(e.contained?.state,'CONTAINED');assert.deepEqual(e.contained?.rolesContained,['neondb_pay_truth']);return true;});
 assert.equal(x.posts,2,'dispatcher once, truth once, projector never');
 assert.deepEqual([x.states.neondb_pay_dispatch!.rolcanlogin,x.states.neondb_pay_truth!.rolcanlogin,x.states.neondb_pay_projection!.rolcanlogin],[true,false,false]);
 assert.ok(!('PRODUCTION_WORKER_DB_PASSWORD_WORKER' in x.sunk));assert.ok('PRODUCTION_WORKER_DB_PASSWORD_DISPATCHER' in x.sunk);
 await assert.rejects(w.provisionWorkerRoles(x.ports),/WORKER_CREDENTIAL_RESET_ALREADY_ATTEMPTED/);assert.equal(x.posts,2);
});

test('a failed probe contains the role and never writes its sink; containment is bounded and reports failure honestly',async()=>{
 const x=world({probeFails:'neondb_pay_dispatch'});
 await assert.rejects(w.provisionWorkerRoles(x.ports),/WORKER_CREDENTIAL_PROBE_FAILED/);
 assert.deepEqual(Object.keys(x.sunk),[]);assert.equal(x.states.neondb_pay_dispatch!.rolcanlogin,false);assert.equal(x.states.neondb_pay_dispatch!.passwordIsNull,true);
 const y=world();await w.provisionWorkerRoles(y.ports);
 const ok=await w.containWorkerRoles(y.ports);
 assert.equal(ok.state,'CONTAINED');assert.deepEqual(Object.keys(y.sunk),[]);for(const r of w.WORKER_ROLES)assert.deepEqual([y.states[r.role]!.rolcanlogin,y.states[r.role]!.passwordIsNull],[false,true]);
 const stuck=world({containSqlFails:99});
 assert.equal((await w.containWorkerRoles(stuck.ports)).state,'CONTAINMENT_FAILED');
});

test('the Vercel adapter sends a value over stdin only, accepts only the four sink names, and drops every value field from metadata',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'zao-vercel-'));
 try{
  const argv=join(dir,'argv.txt'),stdin=join(dir,'stdin.txt');
  const bin=join(dir,'vercel');
  writeFileSync(bin,`#!/bin/sh\nprintf '%s\\n' "$@" > '${argv}'\ncat > '${stdin}'\nif [ "$1" = "api" ]; then echo '{"envs":[{"key":"CRON_SECRET","type":"sensitive","target":["production"],"value":"LEAKME"},{"key":"X","type":"plain","target":"preview","value":"LEAKME2"}]}'; fi\n`);chmodSync(bin,0o755);
  const port=w.vercelCliPort(bin,{PATH:process.env.PATH??''} as unknown as NodeJS.ProcessEnv);
  await port.setSensitive('PRODUCTION_WORKER_DB_PASSWORD_WORKER','Sekret0123456789abcdef');
  assert.equal(readFileSync(stdin,'utf8'),'Sekret0123456789abcdef');
  const args=readFileSync(argv,'utf8').trim().split('\n');
  assert.deepEqual(args,['env','add','PRODUCTION_WORKER_DB_PASSWORD_WORKER','production','--sensitive','--yes','--project','prj_ehUMOzM77em9DVnHJBJffncD5hg7','--scope','zao-food-map']);
  assert.ok(!args.includes('--value'));
  for(const bad of ['PRODUCTION_DB_PASSWORD_AUTH','PRODUCTION_WORKER_TICK_ACTIVATION','PRODUCTION_WORKER_ACCEPTED_AFTER','OTHER'])await assert.rejects(port.setSensitive(bad,'x'),/WORKER_CREDENTIAL_VERCEL_NAME_REFUSED/);
  await assert.rejects(port.remove('PRODUCTION_DB_PASSWORD_AUTH'),/WORKER_CREDENTIAL_VERCEL_NAME_REFUSED/);
  const rows=await port.envRows();
  assert.deepEqual(rows,[{key:'CRON_SECRET',type:'sensitive',target:['production']},{key:'X',type:'plain',target:['preview']}]);
  assert.ok(!JSON.stringify(rows).includes('LEAKME'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('guards are exclusive per role, SQL builders are exact and the CLI takes no arguments',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'zao-worker-guard-'));
 try{
  const g=w.workerFileGuard(join(dir,'ev'));assert.equal(g.exists('worker'),false);g.claim('worker');
  assert.equal(w.workerFileGuard(join(dir,'ev')).exists('worker'),true);assert.equal(g.exists('dispatcher'),false);
  assert.throws(()=>g.claim('worker'),/WORKER_CREDENTIAL_RESET_ALREADY_ATTEMPTED/);
 }finally{rmSync(dir,{recursive:true,force:true});}
 assert.deepEqual(w.workerContainSql('neondb_pay_truth'),['SET LOCAL ROLE "neondb_role_admin"','ALTER ROLE "neondb_pay_truth" NOLOGIN PASSWORD NULL VALID UNTIL \'infinity\'']);
 assert.deepEqual(w.workerFinalizeSql('neondb_pay_truth'),['SET LOCAL ROLE "neondb_role_admin"','ALTER ROLE "neondb_pay_truth" VALID UNTIL \'infinity\'']);
 assert.throws(()=>w.workerTemporaryPasswordSql('neondb_pay_truth',"x'; DROP ROLE neondb_owner; --"),/WORKER_CREDENTIAL_TEMPORARY_PASSWORD_INVALID/);
 assert.throws(()=>w.workerLoginSql('neondb_pay_truth',"2026-10-04T17:30:00Z'; --"),/WORKER_CREDENTIAL_LEASE_INVALID/);
 assert.equal(w.workerResetPath('neondb_pay_truth'),'/projects/curly-union-23141081/branches/br-long-king-azkou4fy/roles/neondb_pay_truth/reset_password');
 assert.deepEqual(w.WORKER_ROLES.map(r=>r.sink),['PRODUCTION_WORKER_DB_PASSWORD_DISPATCHER','PRODUCTION_WORKER_DB_PASSWORD_WORKER','PRODUCTION_WORKER_DB_PASSWORD_PROJECTOR']);
 await assert.rejects(w.main(['provision','--force']),/WORKER_CREDENTIAL_ARGUMENTS_REFUSED/);
 assert.deepEqual(w.workerPostureDrift({rolcanlogin:false,rolvaliduntil:null,passwordIsNull:true,...POSTURE}),[]);
});

test('the dark proof gate runs first and alone; any failure of it, whatever its text, is the coded refusal with nothing contained and nothing leaked',async()=>{
 const ok=world();await w.provisionWorkerRoles(ok.ports);
 assert.equal(ok.log[0],'dark.verify');assert.equal(ok.log.filter(l=>l==='dark.verify').length,1,'checked once, before the first Neon read, Vercel read, guard claim or session');
 const failures:Array<[string,()=>Promise<void>|void]>=[
  ['coded verifier error',()=>{throw new Error('WORKER_DORMANT_PROOF_STALE');}],
  ['error text with a connection string',()=>{const u=new URL('postgresql://placeholder/db');u.username='user';u.password='SecretPassw0rd';throw new Error(u.toString());}],
  ['rejected promise of a non-error',()=>Promise.reject('plain string')],
  ['synchronous throw',()=>{throw new TypeError('x');}],
 ];
 for(const [name,gate] of failures){
  const x=world();x.ports.darkProofVerified=gate as never;
  await assert.rejects(w.provisionWorkerRoles(x.ports),(e:Error&{contained?:unknown;steps?:unknown})=>{
   assert.equal(e.message,'WORKER_CREDENTIAL_DARK_PROOF_REQUIRED',name);assert.equal(e.contained,undefined,name);assert.deepEqual(e.steps,[],name);
   assert.ok(!JSON.stringify([e.message,e.contained,e.steps]).includes('SecretPassw0rd'),name);return true;});
  assert.deepEqual(x.log,[],name+': no Neon read, Vercel call, guard claim, session or containment');
  assert.equal(x.statements.length,0,name);assert.equal(x.posts,0,name);assert.deepEqual(Object.keys(x.sunk),[],name);assert.deepEqual(x.rows.map(r=>r.key),['CRON_SECRET'],name);
  for(const r of w.WORKER_ROLES)assert.equal(x.ports.guard.exists(r.key),false,name);
 }
 // the refusal says why by a fixed reason code only; text of any other error (here a connection string) never becomes the reason
 for(const [thrown,reason] of [[new Error('WORKER_DORMANT_PROOF_STALE'),'WORKER_DORMANT_PROOF_STALE'],[new Error('some other text'),null]] as Array<[Error,string|null]>){
  const r=world();r.ports.darkProofVerified=(async()=>{throw thrown;}) as never;
  await assert.rejects(w.provisionWorkerRoles(r.ports),(e:Error&{reason?:unknown})=>{assert.equal(e.message,'WORKER_CREDENTIAL_DARK_PROOF_REQUIRED');assert.equal(e.reason,reason);return true;});
 }
 // a gate that is not even a function is the same refusal
 const y=world();(y.ports as unknown as {darkProofVerified?:unknown}).darkProofVerified=undefined;
 await assert.rejects(w.provisionWorkerRoles(y.ports),(e:Error&{contained?:unknown})=>{assert.equal(e.message,'WORKER_CREDENTIAL_DARK_PROOF_REQUIRED');assert.equal(e.contained,undefined);return true;});
 assert.deepEqual(y.log,[]);
});

test('production wiring: the gate is the recorded-proof verifier and the accepted main commit comes from assertAcceptedMainRelease',()=>{
 const read=(f:string)=>readFileSync(join(process.cwd(),'scripts',f),'utf8');
 const dormant=read('production-worker-dormant-proof.ts'),cred=read('production-worker-credential.ts');
 assert.match(dormant,/import \{assertAcceptedMainRelease\} from '\.\/lib\/production-owner-session';/);
 assert.match(dormant,/export async function verifyRecordedDormantProof\(root:string=process\.cwd\(\),port:DormantProofPort=vercelProofCliPort\(\),releaseSha:string=assertAcceptedMainRelease\(\)/);
 assert.match(dormant,/release:\(\)=>string=\(\)=>assertAcceptedMainRelease\(\)\)/);
 assert.match(dormant,/const releaseSha=release\(\);/);
 assert.match(cred,/darkProofVerified:async\(\)=>\{\s*await \(await import\('\.\/production-worker-dormant-proof'\)\)\.verifyRecordedDormantProof\(root\);\s*\}/);
 // inside provisionWorkerRoles the gate is the first statement of the try block, before the guard check and every port call
 const body=cred.slice(cred.indexOf('export async function provisionWorkerRoles'),cred.indexOf('const SAFE_CODE'));
 assert.match(body,/try\{\s*try\{await p\.darkProofVerified\(\);\}catch\(e\)\{throw Object\.assign\(fail\('WORKER_CREDENTIAL_DARK_PROOF_REQUIRED'\),\{reason:safeReason\(e\)\}\);\}\s*for\(const r of WORKER_ROLES\)if\(p\.guard\.exists\(r\.key\)\)/);
 assert.ok(body.indexOf('p.darkProofVerified()')<body.search(/p\.(neon|vercel|guard|connectOwner|probe)/),'no port other than the gate is touched before it');
});

test('the Vercel env reader refuses anything but the complete list: another page, hidden production variables, no list, a row without a key',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'zao-vercel-env-'));
 try{
  const body=join(dir,'body.json'),bin=join(dir,'vercel');
  writeFileSync(bin,`#!/bin/sh\ncat '${body}'\n`);chmodSync(bin,0o755);
  const port=w.vercelCliPort(bin,{PATH:process.env.PATH??''} as unknown as NodeJS.ProcessEnv);
  const cron={key:'CRON_SECRET',type:'sensitive',target:['production'],value:'LEAKME'};
  const read=async(value:unknown)=>{writeFileSync(body,typeof value==='string'?value:JSON.stringify(value));return port.envRows();};
  const expected=[{key:'CRON_SECRET',type:'sensitive',target:['production']}];
  // the documented complete shapes
  assert.deepEqual(await read({envs:[cron],pagination:{count:1,next:null,prev:null}}),expected);
  assert.deepEqual(await read({envs:[cron],hiddenProductionEnvCount:0}),expected);
  assert.deepEqual(await read({envs:[cron]}),expected);
  assert.deepEqual(await read({envs:[]}),[]);
  // incomplete: refused instead of being read as "nothing else bound"
  for(const incomplete of [{envs:[cron],pagination:{count:1,next:1759600000000,prev:null}},{envs:[cron],hiddenProductionEnvCount:1},{envs:[cron],hiddenProductionEnvCount:'0'}])
   await assert.rejects(read(incomplete),/WORKER_CREDENTIAL_VERCEL_RESPONSE_INCOMPLETE/);
  for(const unreadable of ['not json','null','[]','"x"',{},{error:{code:'forbidden'}},cron,{envs:'x'},{envs:[cron,{type:'plain',target:['production']}]},{envs:[cron,null]},{envs:[cron,{key:'',type:'plain',target:[]}]}])
   await assert.rejects(read(unreadable),/WORKER_CREDENTIAL_VERCEL_RESPONSE_UNPARSEABLE/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
