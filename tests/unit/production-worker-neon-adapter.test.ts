import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {BACKUP_CREDENTIAL_TARGET as T,backupResetPath,neonCliPort} from '../../scripts/production-backup-credential';
import * as w from '../../scripts/production-worker-credential';
import {neonStandIn} from './support/neon-stand-in';

const SECRET='NeonResetPassword-0123456789abcdefghijklmnop';
const OP='11111111-1111-4111-8111-111111111111';
const P=`/projects/${T.project}`,B=`${P}/branches/${T.branch}`;
const resetBody=(role:string)=>({role:{name:role,password:SECRET},operations:[{id:OP}]});
const withDir=async(fn:(dir:string)=>Promise<void>)=>{const dir=mkdtempSync(join(tmpdir(),'zao-worker-neon-'));try{await fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}};
const refused=/^Error: WORKER_CREDENTIAL_NEON_PATH_REFUSED$/;
/** Runs `body` in a separate node process against the real factory and the stand-in executable, and returns exactly what that process printed: the process boundary is the evidence that
 *  nothing (no password, no executable output) reaches stdout or stderr. The child prints only DONE or `ERR:<message>`. */
function inChild(dir:string,bin:string,body:string){
 const mod=pathToFileURL(join(process.cwd(),'scripts','production-worker-credential.ts')).href;
 const code=`import * as w from ${JSON.stringify(mod)};const ports=w.productionWorkerPorts(${JSON.stringify(dir)},{neon:${JSON.stringify(bin)},vercel:process.execPath});`
  +`(async()=>{${body}})().then(()=>process.stdout.write('DONE'),e=>process.stdout.write('ERR:'+e.message));`;
 return spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{encoding:'utf8',timeout:60_000,cwd:process.cwd(),env:{PATH:process.env.PATH??'',HOME:process.env.HOME??''} as unknown as NodeJS.ProcessEnv});
}

test('the production factory selects the worker adapter: each of the three worker reset paths reaches the executable exactly once, nothing is printed',async()=>withDir(async dir=>{
 const post=Object.fromEntries(w.WORKER_ROLES.map(r=>[w.workerResetPath(r.role),resetBody(r.role)]));
 const stand=neonStandIn(dir,{post});
 // in process: the factory's port returns the response to the lifecycle only
 const ports=w.productionWorkerPorts(dir,{neon:stand.bin,vercel:process.execPath});
 for(const r of w.WORKER_ROLES){
  const before=stand.calls().length;
  const body=await ports.neon.post(w.workerResetPath(r.role)) as {role:{name:string;password:string}};
  assert.equal(body.role.name,r.role);assert.equal(body.role.password,SECRET);
  assert.equal(stand.calls().length,before+1);assert.deepEqual(stand.calls().at(-1),['api',w.workerResetPath(r.role),'-X','POST']);
 }
 assert.deepEqual(stand.calls().map(a=>a[1]),w.WORKER_ROLES.map(r=>w.workerResetPath(r.role)));
 assert.deepEqual(w.workerResetPaths(),[`${B}/roles/neondb_pay_dispatch/reset_password`,`${B}/roles/neondb_pay_truth/reset_password`,`${B}/roles/neondb_pay_projection/reset_password`]);
 // across a process boundary: a separate process that calls the factory's port for all three roles prints nothing but its own marker
 const child=neonStandIn(mkdtempSync(join(dir,'c-')),{post});
 const r=inChild(dir,child.bin,w.WORKER_ROLES.map(x=>`await ports.neon.post(${JSON.stringify(w.workerResetPath(x.role))});`).join(''));
 assert.equal(r.stdout,'DONE');assert.equal(r.stderr,'');assert.equal(r.status,0);
 assert.ok(!(r.stdout+r.stderr).includes(SECRET));
 assert.equal(child.calls().length,3,'one invocation per role');
}));

test('only the three worker reset paths are POSTed: the backup/owner/manager roles, other projects, branches and roles, other verbs and malformed paths never reach the executable',async()=>withDir(async dir=>{
 const stand=neonStandIn(dir,{get:{},post:{}});
 const ports=w.productionWorkerPorts(dir,{neon:stand.bin,vercel:process.execPath});
 const reset=(role:string,project:string=T.project,branch:string=T.branch)=>`/projects/${project}/branches/${branch}/roles/${role}/reset_password`;
 const worker=w.WORKER_ROLES[0]!.role;
 const bad=[
  backupResetPath(),reset(T.role),reset(T.owner),reset(T.manager),reset('neondb_operations'),reset('neondb_pay_other'),reset('neondb_pay_dispatch_'),reset('NEONDB_PAY_DISPATCH'),
  reset(worker,'other-project'),reset(worker,T.project,'br-other-branch'),reset(worker,`${T.project}x`),
  reset(worker)+'/',reset(worker)+'?x=1',reset(worker)+'#',' '+reset(worker),reset(worker)+'\n',reset(worker).replace('/reset_password','/reveal_password'),reset(worker).replace('reset_password','reset_password/extra'),
  reset(worker).replace('/roles/','//roles/'),`${B}/roles/${worker}/../${T.owner}/reset_password`,`${B}/roles/${worker}`,`${B}/roles`,`${B}/roles/${worker}/reset_password/..`,
  P,B,`${P}/connection_uri`,`${P}/operations/${OP}`,`${P}/branches/${T.branch}/databases/${T.database}`,'/projects','/','','api',
 ];
 for(const path of bad)await assert.rejects(ports.neon.post(path),refused,JSON.stringify(path));
 assert.deepEqual(stand.calls(),[],'no process was started for any refused path');
 // the backup helper's adapter is untouched and backup-only: it still refuses the worker paths
 const backup=neonCliPort(stand.bin);
 for(const r of w.WORKER_ROLES)await assert.rejects(backup.post(w.workerResetPath(r.role)),/^Error: BACKUP_CREDENTIAL_NEON_PATH_REFUSED$/);
 await assert.rejects(backup.get(`${B}/roles/${worker}/reset_password`),/^Error: BACKUP_CREDENTIAL_NEON_PATH_REFUSED$/);
 assert.deepEqual(stand.calls(),[]);
}));

test('the worker adapter reads only the exact target (project, branch, database, roles, endpoints, owner connection URI, operation readback); nothing else, and never with a body',async()=>withDir(async dir=>{
 const good:Record<string,unknown>={[P]:{project:{id:T.project}},[B]:{branch:{id:T.branch}},[`${B}/databases/${T.database}`]:{database:{name:T.database}},[`${B}/roles`]:{roles:[]},[`${B}/endpoints`]:{endpoints:[]},
  [`${P}/connection_uri`]:{uri:'redacted'},[`${P}/operations/${OP}`]:{operation:{id:OP,status:'finished'}}};
 const stand=neonStandIn(dir,{get:good});
 const ports=w.productionWorkerPorts(dir,{neon:stand.bin,vercel:process.execPath});
 for(const path of Object.keys(good))assert.deepEqual(await ports.neon.get(path),good[path],path);
 await ports.neon.get(`${P}/connection_uri`,{branch_id:T.branch,database_name:T.database,role_name:T.owner,pooled:'false'});
 const last=stand.calls().at(-1)!;
 assert.deepEqual(last,['api',`${P}/connection_uri`,'-Q',`branch_id=${T.branch}`,'-Q',`database_name=${T.database}`,'-Q',`role_name=${T.owner}`,'-Q','pooled=false']);
 for(const a of stand.calls())assert.ok(!a.includes('-X')&&!a.includes('POST'),'a read never carries a write verb');
 const before=stand.calls().length;
 for(const path of [`${B}/roles/${T.owner}`,`${B}/roles/${w.WORKER_ROLES[0]!.role}/reset_password`,`${B}/roles/${w.WORKER_ROLES[0]!.role}/reveal_password`,`/projects/other`,`${P}/branches/br-other`,`${P}/operations/not-an-id`,`${P}/operations/${OP}/x`,`${P}/databases`,`${P}`+'/',`${P}?x=1`,'/projects',''])
  await assert.rejects(ports.neon.get(path),refused,JSON.stringify(path));
 assert.equal(stand.calls().length,before);
}));

test('a failing or malformed executable result is a fixed code: no stderr, stdout or password text in the error or in what the process prints',async()=>withDir(async dir=>{
 const path=w.workerResetPath(w.WORKER_ROLES[0]!.role);
 const failing=neonStandIn(dir,{post:{[path]:{__exit:1}}});
 const ports=w.productionWorkerPorts(dir,{neon:failing.bin,vercel:process.execPath});
 await assert.rejects(ports.neon.post(path),(e:Error)=>{assert.equal(e.message,'WORKER_CREDENTIAL_NEON_CALL_FAILED');assert.ok(!/SECRET|MARKER/.test(e.message+String(e.stack)));return true;});
 const r=inChild(dir,failing.bin,`await ports.neon.post(${JSON.stringify(path)});`);
 assert.equal(r.stdout,'ERR:WORKER_CREDENTIAL_NEON_CALL_FAILED');assert.equal(r.stderr,'');assert.ok(!/SECRET|MARKER/.test(r.stdout+r.stderr));
 // a missing fixture (exit 2) and an unparseable body are also fixed codes
 await assert.rejects(ports.neon.get(`${P}`),/^Error: WORKER_CREDENTIAL_NEON_CALL_FAILED$/);
 const raw=neonStandIn(mkdtempSync(join(dir,'u-')),{get:{[P]:{__raw:'Neon says: '+SECRET}}});
 await assert.rejects(w.neonWorkerCliPort(raw.bin).get(P),(e:Error)=>{assert.equal(e.message,'WORKER_CREDENTIAL_NEON_RESPONSE_UNPARSEABLE');assert.ok(!e.message.includes(SECRET));return true;});
}));

test('the production factory refuses to start when a CLI is missing and uses the pinned defaults otherwise',()=>{
 assert.throws(()=>w.productionWorkerPorts(process.cwd(),{neon:'/nonexistent/neon'}),/WORKER_CREDENTIAL_CLI_MISSING/);
 assert.throws(()=>w.productionWorkerPorts(process.cwd(),{neon:process.execPath,vercel:'/nonexistent/vercel'}),/WORKER_CREDENTIAL_CLI_MISSING/);
});

test('a path that is not a plain string never reaches the executable, and a query is accepted only for the owner connection URI with its four fixed keys',async()=>withDir(async dir=>{
 const stand=neonStandIn(dir,{get:{[P]:{project:{id:T.project}},[`${P}/connection_uri`]:{uri:'redacted'}},post:{}});
 const ports=w.productionWorkerPorts(dir,{neon:stand.bin,vercel:process.execPath});
 let n=0;
 const shifty={toString(){return n++===0?P:'/projects/other/anything';}} as unknown as string;
 const nonStrings=[shifty,[P] as unknown as string,{} as unknown as string,undefined as unknown as string,null as unknown as string,1 as unknown as string,new String(P) as unknown as string];
 for(const bad of nonStrings){
  await assert.rejects(ports.neon.get(bad),refused);
  await assert.rejects(ports.neon.post(bad),refused);
 }
 // a query on any other path, an unknown key or a non-string value is refused before a process starts
 await assert.rejects(ports.neon.get(P,{pooled:'false'}),refused);
 await assert.rejects(ports.neon.get(`${P}/connection_uri`,{branch_id:T.branch,extra:'x'}),refused);
 await assert.rejects(ports.neon.get(`${P}/connection_uri`,{pooled:false as unknown as string}),refused);
 assert.deepEqual(stand.calls(),[]);
 // the owner query of connectOwner is still accepted
 await ports.neon.get(`${P}/connection_uri`,{branch_id:T.branch,database_name:T.database,role_name:T.owner,pooled:'false'});
 assert.equal(stand.calls().length,1);
}));
