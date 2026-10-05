import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {VERCEL_TARGET,WORKER_ROLES,evidenceDirectory,provisionWorkerRoles} from '../../scripts/production-worker-credential';
import type {VercelEnvRow,WorkerCredentialPorts} from '../../scripts/production-worker-credential';
import {CRON_PATH,DORMANT_EVENT,collectDormantProof,deploymentIdFile,main,proofFile,vercelProofCliPort,verifyDormantProof,verifyRecordedDormantProof,writeProof} from '../../scripts/production-worker-dormant-proof';
import type {DeploymentFacts,DormantProofPort,ProjectFacts,RequestLog} from '../../scripts/production-worker-dormant-proof';

const SHA='a'.repeat(40),DEP='dpl_AbCdEfGh12345678',NOW=Date.parse('2026-10-04T17:30:30.000Z');
const FACTS={releaseSha:SHA,deploymentId:DEP};
const fail=(code:string)=>new RegExp('WORKER_DORMANT_PROOF_'+code+'$');
// One real-looking scheduler minute: GET 200, the dormant event, this deployment, this project, production.
const tick=(minutesAgo:number,over:Partial<RequestLog>={}):RequestLog=>({timestamp:NOW-minutesAgo*60_000-20_000,deploymentId:DEP,projectId:VERCEL_TARGET.project,environment:'production',
 requestMethod:'GET',requestPath:CRON_PATH,responseStatusCode:200,messages:[JSON.stringify({event:DORMANT_EVENT})],...over});
const cleanTicks=()=>[tick(4),tick(3),tick(2),tick(1),tick(0)];

function fakePort(over:{dep?:Partial<DeploymentFacts>;project?:Partial<ProjectFacts>;env?:VercelEnvRow[];logs?:RequestLog[];windows?:number[]}={}){
 const calls:string[]=[];
 const port:DormantProofPort={
  async deployment(id){calls.push('deployment '+id);return {id,projectId:VERCEL_TARGET.project,target:'production',readyState:'READY',createdAt:NOW-3_600_000,gitCommitSha:SHA,gitDirty:false,crons:[{path:CRON_PATH,schedule:'* * * * *'}],...over.dep};},
  async project(){calls.push('project');return {id:VERCEL_TARGET.project,productionDeploymentId:DEP,protectionType:'all',...over.project};},
  async envRows(){calls.push('env');return over.env??[{key:'CRON_SECRET',type:'sensitive',target:['production']},{key:'PLAIN_OTHER',type:'plain',target:['production']}];},
  async requestLogs(_id,since){calls.push('logs');over.windows?.push(since);return over.logs??cleanTicks();},
 };
 return {port,calls};
}
const fixed=()=>new Date(NOW);

test('a proof is collected only from live readbacks and carries no secret, token or URL',async()=>{
 const {port,calls}=fakePort();
 const proof=await collectDormantProof(port,FACTS,fixed);
 assert.equal(proof.result,'DORMANT_LOG_OBSERVED');assert.equal(proof.event,DORMANT_EVENT);assert.equal(proof.releaseSha,SHA);assert.equal(proof.deploymentId,DEP);
 assert.equal(proof.protection,'all');assert.equal(proof.cronSecret,'sensitive:production');
 assert.equal(proof.observations.count,5);assert.equal(proof.observations.distinctMinutes,5);
 assert.deepEqual(proof.absentAtProof,[...WORKER_ROLES.map(r=>r.sink),'PRODUCTION_WORKER_ACCEPTED_AFTER','PRODUCTION_WORKER_TICK_ACTIVATION']);
 assert.deepEqual(calls,['deployment '+DEP,'project','env','logs']);
 assert.ok(!/postgres|secret=|Bearer|https?:|token/i.test(JSON.stringify(proof)));
});

test('the scheduler may deliver a minute twice or skip one; a burst, a gap or too few minutes is not a scheduler',async()=>{
 const dup=[...cleanTicks(),tick(2,{timestamp:NOW-2*60_000-18_000}),tick(0,{timestamp:NOW-1_000})];
 await collectDormantProof(fakePort({logs:dup}).port,FACTS,fixed);
 await collectDormantProof(fakePort({logs:[tick(5),tick(3),tick(2),tick(1),tick(0)]}).port,FACTS,fixed);
 await assert.rejects(collectDormantProof(fakePort({logs:[tick(6),tick(3),tick(2),tick(1),tick(0)]}).port,FACTS,fixed),fail('CADENCE_NOT_SCHEDULER'));
 const burst=Array.from({length:30},(_,i)=>tick(0,{timestamp:NOW-30_000+i*500}));
 await assert.rejects(collectDormantProof(fakePort({logs:burst}).port,FACTS,fixed),fail('TOO_FEW_OBSERVATIONS'));
 await assert.rejects(collectDormantProof(fakePort({logs:[tick(1),tick(0)]}).port,FACTS,fixed),fail('TOO_FEW_OBSERVATIONS'));
 await assert.rejects(collectDormantProof(fakePort({logs:[]}).port,FACTS,fixed),fail('NO_REQUESTS_OBSERVED'));
 // requests to other routes are not observations of this route
 await assert.rejects(collectDormantProof(fakePort({logs:cleanTicks().map(l=>({...l,requestPath:'/api/session'}))}).port,FACTS,fixed),fail('NO_REQUESTS_OBSERVED'));
});

test('old observations are not proof',async()=>{
 const old=[tick(14),tick(13),tick(12),tick(11),tick(10)];
 await assert.rejects(collectDormantProof(fakePort({logs:old}).port,FACTS,fixed),fail('OBSERVATION_STALE'));
 const future=[tick(0,{timestamp:NOW+200_000}),tick(0,{timestamp:NOW+260_000}),tick(0,{timestamp:NOW+320_000})];
 await assert.rejects(collectDormantProof(fakePort({logs:future}).port,FACTS,fixed),fail('OBSERVATION_STALE'));
});

test('the wrong event, a manual or unauthorised call, another method or another deployment is not proof',async()=>{
 const base=cleanTicks();
 const wrongEvent=[...base,tick(0,{timestamp:NOW-5_000,messages:[JSON.stringify({event:'normal_worker_tick',state:'COMPLETED'})]})];
 await assert.rejects(collectDormantProof(fakePort({logs:wrongEvent}).port,FACTS,fixed),fail('ACTIVATED_TICK_OBSERVED'));
 await assert.rejects(collectDormantProof(fakePort({logs:[...base,tick(0,{timestamp:NOW-5_000,messages:[]})]}).port,FACTS,fixed),fail('REQUEST_WITHOUT_DORMANT_EVENT'));
 await assert.rejects(collectDormantProof(fakePort({logs:[...base,tick(0,{timestamp:NOW-5_000,messages:['not json',JSON.stringify({event:'something_else'})]})]}).port,FACTS,fixed),fail('REQUEST_WITHOUT_DORMANT_EVENT'));
 await assert.rejects(collectDormantProof(fakePort({logs:[...base,tick(0,{timestamp:NOW-5_000,responseStatusCode:401,messages:[]})]}).port,FACTS,fixed),fail('UNEXPECTED_REQUEST'));
 await assert.rejects(collectDormantProof(fakePort({logs:[...base,tick(0,{timestamp:NOW-5_000,responseStatusCode:500})]}).port,FACTS,fixed),fail('UNEXPECTED_REQUEST'));
 await assert.rejects(collectDormantProof(fakePort({logs:[...base,tick(0,{timestamp:NOW-5_000,requestMethod:'POST'})]}).port,FACTS,fixed),fail('UNEXPECTED_REQUEST'));
 await assert.rejects(collectDormantProof(fakePort({logs:[...base,tick(0,{timestamp:NOW-5_000,deploymentId:'dpl_OtherDeployment1'})]}).port,FACTS,fixed),fail('UNEXPECTED_REQUEST'));
 await assert.rejects(collectDormantProof(fakePort({logs:[...base,tick(0,{timestamp:NaN})]}).port,FACTS,fixed),fail('UNEXPECTED_REQUEST'));
 // project and environment are enforced wherever the row carries them (and only then)
 await assert.rejects(collectDormantProof(fakePort({logs:[...base,tick(0,{timestamp:NOW-5_000,projectId:'prj_other'})]}).port,FACTS,fixed),fail('UNEXPECTED_REQUEST'));
 await assert.rejects(collectDormantProof(fakePort({logs:[...base,tick(0,{timestamp:NOW-5_000,environment:'preview'})]}).port,FACTS,fixed),fail('UNEXPECTED_REQUEST'));
 await collectDormantProof(fakePort({logs:base.map(l=>({...l,projectId:null,environment:null}))}).port,FACTS,fixed);
 // an activated tick that is truncated, reformatted or not JSON at all still counts as activation, even beside a good dormant line
 for(const hidden of ['{"event":"normal_worker_tick","state":"COMP','normal_worker_tick state=COMPLETED',JSON.stringify({event:'normal_worker_tick'})])
  await assert.rejects(collectDormantProof(fakePort({logs:[...base,tick(0,{timestamp:NOW-5_000,messages:[JSON.stringify({event:DORMANT_EVENT}),hidden]})]}).port,FACTS,fixed),fail('ACTIVATED_TICK_OBSERVED'));
});

test('a stale, wrong or not-current deployment is not proof',async()=>{
 await assert.rejects(collectDormantProof(fakePort({project:{productionDeploymentId:'dpl_NewerDeployment9'}}).port,FACTS,fixed),fail('NOT_CURRENT_DEPLOYMENT'));
 await assert.rejects(collectDormantProof(fakePort({project:{productionDeploymentId:null}}).port,FACTS,fixed),fail('NOT_CURRENT_DEPLOYMENT'));
 await assert.rejects(collectDormantProof(fakePort({dep:{id:'dpl_SomethingElse12'}}).port,FACTS,fixed),fail('DEPLOYMENT_MISMATCH'));
 await assert.rejects(collectDormantProof(fakePort({dep:{projectId:'prj_other'}}).port,FACTS,fixed),fail('DEPLOYMENT_MISMATCH'));
 await assert.rejects(collectDormantProof(fakePort({dep:{target:'preview'}}).port,FACTS,fixed),fail('DEPLOYMENT_NOT_READY_PRODUCTION'));
 await assert.rejects(collectDormantProof(fakePort({dep:{readyState:'ERROR'}}).port,FACTS,fixed),fail('DEPLOYMENT_NOT_READY_PRODUCTION'));
 await assert.rejects(collectDormantProof(fakePort({dep:{crons:[]}}).port,FACTS,fixed),fail('CRON_NOT_DEFINED'));
 await assert.rejects(collectDormantProof(fakePort({dep:{crons:[{path:CRON_PATH,schedule:'0 * * * *'}]}}).port,FACTS,fixed),fail('CRON_NOT_DEFINED'));
 await assert.rejects(collectDormantProof(fakePort({dep:{crons:[{path:'/api/other',schedule:'* * * * *'}]}}).port,FACTS,fixed),fail('CRON_NOT_DEFINED'));
 await assert.rejects(collectDormantProof(fakePort({dep:{createdAt:NaN}}).port,FACTS,fixed),fail('DEPLOYMENT_FACTS_INCOMPLETE'));
 await assert.rejects(collectDormantProof(fakePort().port,{releaseSha:SHA,deploymentId:'not-a-deployment'},fixed),fail('FACTS_INVALID'));
 await assert.rejects(collectDormantProof(fakePort().port,{releaseSha:'abc',deploymentId:DEP},fixed),fail('FACTS_INVALID'));
});

test('a deployment of another source (or a dirty tree) is not the accepted release',async()=>{
 await assert.rejects(collectDormantProof(fakePort({dep:{gitCommitSha:'b'.repeat(40)}}).port,FACTS,fixed),fail('WRONG_SOURCE'));
 await assert.rejects(collectDormantProof(fakePort({dep:{gitCommitSha:null}}).port,FACTS,fixed),fail('WRONG_SOURCE'));
 await assert.rejects(collectDormantProof(fakePort({dep:{gitDirty:true}}).port,FACTS,fixed),fail('WRONG_SOURCE'));
});

test('CRON_SECRET must be bound first and alone: no worker password sink, no cutoff, no activation',async()=>{
 const cron:VercelEnvRow={key:'CRON_SECRET',type:'sensitive',target:['production']};
 for(const extra of [...WORKER_ROLES.map(r=>r.sink),'PRODUCTION_WORKER_ACCEPTED_AFTER','PRODUCTION_WORKER_TICK_ACTIVATION'])
  await assert.rejects(collectDormantProof(fakePort({env:[cron,{key:extra,type:'sensitive',target:['production']}]}).port,FACTS,fixed),fail('ACTIVATION_NAME_ALREADY_BOUND'));
 for(const bad of [[],[{...cron,type:'plain'}],[{...cron,type:'encrypted'}],[{...cron,target:['preview']}],[{...cron,target:['production','preview']}],[cron,cron]])
  await assert.rejects(collectDormantProof(fakePort({env:bad}).port,FACTS,fixed),fail('CRON_SECRET_NOT_FIRST_AND_SENSITIVE'));
});

test('protection must still read All Deployments; it is never relaxed to obtain a proof',async()=>{
 for(const protectionType of [null,'preview','prod_deployment_urls_and_all_previews','all_except_custom_domains'])
  await assert.rejects(collectDormantProof(fakePort({project:{protectionType}}).port,FACTS,fixed),fail('PROTECTION_NOT_ALL'));
 // the cron could not pass protection => no requests => no proof (and nothing here would ever change the setting)
 await assert.rejects(collectDormantProof(fakePort({logs:[]}).port,FACTS,fixed),fail('NO_REQUESTS_OBSERVED'));
});

test('verification accepts the collected record and re-derives it from the live log',async()=>{
 const proof=await collectDormantProof(fakePort().port,FACTS,fixed);
 const windows:number[]=[];
 const later=()=>new Date(NOW+60_000);
 // one more scheduler minute arrived after the record was made: still the same record
 const more=[...cleanTicks(),tick(-1)];
 assert.deepEqual(await verifyDormantProof(JSON.parse(JSON.stringify(proof)),fakePort({logs:more,windows}).port,FACTS,later),proof);
 assert.ok(windows.length===1&&windows[0]!>=5&&windows[0]!<=60);
 // stale record
 await assert.rejects(verifyDormantProof(proof,fakePort().port,FACTS,()=>new Date(NOW+31*60_000)),fail('STALE'));
 // live state moved: newer deployment, activation name now bound, protection changed, logs gone / not fresh
 await assert.rejects(verifyDormantProof(proof,fakePort({project:{productionDeploymentId:'dpl_NewerDeployment9'}}).port,FACTS,fixed),fail('NOT_CURRENT_DEPLOYMENT'));
 await assert.rejects(verifyDormantProof(proof,fakePort({env:[{key:'CRON_SECRET',type:'sensitive',target:['production']},{key:'PRODUCTION_WORKER_TICK_ACTIVATION',type:'sensitive',target:['production']}]}).port,FACTS,fixed),fail('ACTIVATION_NAME_ALREADY_BOUND'));
 await assert.rejects(verifyDormantProof(proof,fakePort({project:{protectionType:null}}).port,FACTS,fixed),fail('PROTECTION_NOT_ALL'));
 await assert.rejects(verifyDormantProof(proof,fakePort({logs:[]}).port,FACTS,fixed),fail('NO_REQUESTS_OBSERVED'));
 await assert.rejects(verifyDormantProof(proof,fakePort().port,FACTS,()=>new Date(NOW+10*60_000)),fail('OBSERVATION_STALE'));
 // for another accepted release or another deployment
 await assert.rejects(verifyDormantProof(proof,fakePort().port,{releaseSha:'c'.repeat(40),deploymentId:DEP},fixed),fail('WRONG_SOURCE'));
 await assert.rejects(verifyDormantProof(proof,fakePort().port,{releaseSha:SHA,deploymentId:'dpl_OtherDeployment1'},fixed),fail('DEPLOYMENT_MISMATCH'));
 // activation observed after the record was made
 await assert.rejects(verifyDormantProof(proof,fakePort({logs:[...cleanTicks(),tick(0,{timestamp:NOW+1_000,messages:[JSON.stringify({event:'normal_worker_tick'})]})]}).port,FACTS,later),fail('ACTIVATED_TICK_OBSERVED'));
});

test('minimal or fabricated JSON is not a proof, even when every live readback happens to be good',async()=>{
 const live=fakePort().port;
 for(const raw of [null,'DORMANT_LOG_OBSERVED',[],{},{result:'DORMANT_LOG_OBSERVED',event:DORMANT_EVENT,deploymentId:DEP},
  {result:'DORMANT_LOG_OBSERVED',event:DORMANT_EVENT,deploymentId:DEP,releaseSha:SHA,observedAt:new Date(NOW).toISOString()}])
  await assert.rejects(verifyDormantProof(raw,live,FACTS,fixed),fail('SHAPE_INVALID'));
 const real=await collectDormantProof(fakePort().port,FACTS,fixed);
 // each field edited / removed / added is refused
 for(const edit of [(r:Record<string,unknown>)=>{r.extra=1;},(r:Record<string,unknown>)=>{delete r.protection;},(r:Record<string,unknown>)=>{r.version='production-worker-dormant-proof/0';},
  (r:Record<string,unknown>)=>{r.event='normal_worker_tick';},(r:Record<string,unknown>)=>{r.protection='none';},(r:Record<string,unknown>)=>{r.cronSecret='plain';},
  (r:Record<string,unknown>)=>{r.absentAtProof=[];},(r:Record<string,unknown>)=>{r.observedAt='2026-10-04 17:30:30';},
  (r:Record<string,unknown>)=>{(r.observations as Record<string,unknown>).count=2;},(r:Record<string,unknown>)=>{(r.observations as Record<string,unknown>).distinctMinutes=1;}]){
  const copy=JSON.parse(JSON.stringify(real)) as Record<string,unknown>;edit(copy);
  await assert.rejects(verifyDormantProof(copy,live,FACTS,fixed),/WORKER_DORMANT_PROOF_(SHAPE_INVALID|DEPLOYMENT_MISMATCH|WRONG_SOURCE)$/);
 }
 // a complete, well-formed record whose numbers do not match the real log is refused (nothing in a file is trusted)
 for(const edit of [(o:Record<string,unknown>)=>{o.count=9;},(o:Record<string,unknown>)=>{o.firstAt=new Date(NOW-9*60_000).toISOString();},(o:Record<string,unknown>)=>{o.count=4;}]){
  const copy=JSON.parse(JSON.stringify(real)) as {observations:Record<string,unknown>};edit(copy.observations);
  await assert.rejects(verifyDormantProof(copy,live,FACTS,fixed),fail('RECORD_NOT_IN_LOG'));
 }
 const forged=JSON.parse(JSON.stringify(real)) as {deploymentCreatedAt:string};forged.deploymentCreatedAt=new Date(NOW-2*3_600_000).toISOString();
 await assert.rejects(verifyDormantProof(forged,live,FACTS,fixed),fail('RECORD_NOT_IN_LOG'));
 // a hand-written record for logs that do not exist
 await assert.rejects(verifyDormantProof(real,fakePort({logs:[]}).port,FACTS,fixed),fail('NO_REQUESTS_OBSERVED'));
});

test('the recorded proof is read from the evidence directory, written 0600 atomically and superseded only by a fresh collection',async()=>{
 const root=mkdtempSync(join(tmpdir(),'zao-dormant-proof-'));
 try{
  const dir=evidenceDirectory(root);
  await assert.rejects(main([],root,fakePort().port),fail('DEPLOYMENT_ID_MISSING'));
  mkdirSync(dir,{recursive:true,mode:0o700});
  await assert.rejects(verifyRecordedDormantProof(root,fakePort().port,SHA,fixed),fail('PROOF_MISSING'));
  writeFileSync(deploymentIdFile(dir),DEP+'\n');
  await assert.rejects(verifyRecordedDormantProof(root,fakePort().port,SHA,fixed),fail('PROOF_MISSING'));
  const proof=await collectDormantProof(fakePort().port,FACTS,fixed);
  writeProof(dir,proof);
  assert.equal(statSync(proofFile(dir)).mode&0o777,0o600);
  assert.deepEqual(JSON.parse(readFileSync(proofFile(dir),'utf8')),proof);
  assert.deepEqual(await verifyRecordedDormantProof(root,fakePort().port,SHA,fixed),proof);
  // an edited file is refused
  writeFileSync(proofFile(dir),JSON.stringify({...proof,deploymentId:'dpl_OtherDeployment1'}));
  await assert.rejects(verifyRecordedDormantProof(root,fakePort().port,SHA,fixed),fail('DEPLOYMENT_MISMATCH'));
  writeFileSync(proofFile(dir),'not json');
  await assert.rejects(verifyRecordedDormantProof(root,fakePort().port,SHA,fixed),fail('PROOF_MISSING'));
  // a deployment id file that is not a deployment id
  writeProof(dir,proof);writeFileSync(deploymentIdFile(dir),'dpl_x\n');
  await assert.rejects(verifyRecordedDormantProof(root,fakePort().port,SHA,fixed),fail('FACTS_INVALID'));
  await assert.rejects(main(['--force'],root,fakePort().port),fail('ARGUMENTS_REFUSED'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('provisionWorkerRoles refuses before any mutation unless the strict verifier resolves; a shape-only file on disk never satisfies it',async()=>{
 const root=mkdtempSync(join(tmpdir(),'zao-dormant-gate-'));
 try{
  const dir=evidenceDirectory(root);mkdirSync(dir,{recursive:true,mode:0o700});
  writeFileSync(join(dir,'dormant-proof.json'),JSON.stringify({result:'DORMANT_LOG_OBSERVED',event:DORMANT_EVENT,deploymentId:DEP}));
  writeFileSync(deploymentIdFile(dir),DEP+'\n');
  const touched:string[]=[];
  const never=(name:string)=>(async()=>{touched.push(name);throw new Error('must not be reached');});
  const ports={darkProofVerified:()=>verifyRecordedDormantProof(root,fakePort().port,SHA,fixed).then(()=>undefined),
   neon:{get:never('neon.get'),post:never('neon.post')},vercel:{envRows:never('vercel.envRows'),setSensitive:never('vercel.set'),remove:never('vercel.rm')},
   connectOwner:never('connectOwner'),probe:never('probe'),guard:{exists:()=>false,claim:()=>{touched.push('guard.claim');}},sleep:async()=>{},now:fixed} as unknown as WorkerCredentialPorts;
  await assert.rejects(provisionWorkerRoles(ports),/WORKER_CREDENTIAL_DARK_PROOF_REQUIRED/);
  assert.deepEqual(touched,[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});

// ---------------------------------------------------------------- the production adapter, driven through a fake `vercel` binary printing the documented / observed shapes
// REST: GET /v13/deployments/{id} (owner view), GET /v9/projects/{id}, GET /v10/projects/{id}/env; CLI: `vercel logs --json` rows (JSON Lines). Nothing here talks to Vercel.
type Json=Record<string,unknown>;
const depBody=():Json=>({id:DEP,projectId:VERCEL_TARGET.project,target:'production',readyState:'READY',status:'READY',createdAt:NOW-3_600_000,meta:{gitCommitSha:SHA},crons:[{path:CRON_PATH,schedule:'* * * * *'}]});
const projBody=():Json=>({id:VERCEL_TARGET.project,targets:{production:{id:DEP}},ssoProtection:{deploymentType:'all'}});
const envBody=():Json=>({envs:[{key:'CRON_SECRET',type:'sensitive',target:['production']},{key:'PLAIN_OTHER',type:'plain',target:['production'],value:'LEAKME'}],pagination:{count:2,next:null,prev:null}});
const row=(minutesAgo:number,over:Json={},seq=0)=>JSON.stringify({id:`log_synthetic_${minutesAgo}_${seq}`,timestamp:NOW-minutesAgo*60_000-20_000+seq,deploymentId:DEP,projectId:VERCEL_TARGET.project,level:'info',message:'',source:'serverless',
 domain:'zao.example.invalid',requestMethod:'GET',requestPath:CRON_PATH,responseStatusCode:200,environment:'production',branch:'main',cache:'MISS',logs:[{message:JSON.stringify({event:DORMANT_EVENT})}],...over});
const rows=(over:Json={})=>[4,3,2,1,0].map(m=>row(m,over)).join('\n')+'\n';
const edit=(base:Json,fn:(copy:Json)=>void)=>{const copy=JSON.parse(JSON.stringify(base)) as Json;fn(copy);return copy;};
type CliOver={dep?:unknown;proj?:unknown;env?:unknown;logs?:string;exit?:Partial<Record<'dep'|'proj'|'env'|'logs',number>>};
function cli(over:CliOver={}){
 const dir=mkdtempSync(join(tmpdir(),'zao-dormant-cli-'));
 const put=(name:string,value:unknown)=>{writeFileSync(join(dir,name),typeof value==='string'?value:JSON.stringify(value)+'\n');return `'${join(dir,name)}'`;};
 const f={dep:put('dep.json',over.dep??depBody()),proj:put('proj.json',over.proj??projBody()),env:put('env.json',over.env??envBody()),logs:put('logs.txt',over.logs??rows())};
 const code=(k:'dep'|'proj'|'env'|'logs')=>over.exit?.[k]??0;
 const bin=join(dir,'vercel'),argv=join(dir,'argv');
 writeFileSync(bin,`#!/bin/sh\nprintf '%s\\n' "--" "$@" >> '${argv}'\ncase "$2" in\n/v13/deployments/*) cat ${f.dep}; exit ${code('dep')};;\n/v9/projects/*) cat ${f.proj}; exit ${code('proj')};;\n/v10/projects/*/env) cat ${f.env}; exit ${code('env')};;\n*) cat ${f.logs}; exit ${code('logs')};;\nesac\n`);
 chmodSync(bin,0o755);
 return {dir,argv,port:vercelProofCliPort(bin,{PATH:process.env.PATH??''} as unknown as NodeJS.ProcessEnv),done:()=>rmSync(dir,{recursive:true,force:true})};
}
async function viaCli(over:CliOver){const c=cli(over);try{return await collectDormantProof(c.port,FACTS,fixed);}finally{c.done();}}
async function refusedViaCli(over:CliOver,code:string,name:string){const c=cli(over);try{await assert.rejects(collectDormantProof(c.port,FACTS,fixed),fail(code),name);}finally{c.done();}}

test('the production port is read-only: fixed argv, bounded output, never a write verb or a token',async()=>{
 const c=cli({logs:'Fetching logs...\n'+rows()});
 try{
  const d=await c.port.deployment(DEP);assert.deepEqual([d.id,d.projectId,d.target,d.readyState,d.createdAt,d.gitCommitSha,d.gitDirty,d.crons],[DEP,VERCEL_TARGET.project,'production','READY',NOW-3_600_000,SHA,false,[{path:CRON_PATH,schedule:'* * * * *'}]]);
  const p=await c.port.project();assert.deepEqual(p,{id:VERCEL_TARGET.project,productionDeploymentId:DEP,protectionType:'all'});
  const envs=await c.port.envRows();assert.deepEqual(envs,[{key:'CRON_SECRET',type:'sensitive',target:['production']},{key:'PLAIN_OTHER',type:'plain',target:['production']}]);assert.ok(!JSON.stringify(envs).includes('LEAKME'));
  const logs=await c.port.requestLogs(DEP,15);assert.equal(logs.length,5);assert.deepEqual(logs[0]!.messages,[JSON.stringify({event:DORMANT_EVENT})]);
  assert.deepEqual([logs[0]!.projectId,logs[0]!.environment,logs[0]!.requestMethod,logs[0]!.requestPath,logs[0]!.responseStatusCode],[VERCEL_TARGET.project,'production','GET',CRON_PATH,200]);
  const calls=readFileSync(c.argv,'utf8').split('--\n').filter(Boolean).map(x=>x.trimEnd().split('\n'));
  assert.equal(calls.length,4);
  for(const call of calls){
   if(call[0]==='api'){
    // only GET reads of fixed paths; no method, field, input or token flag
    assert.match(call[1]!,/^\/(v13\/deployments\/dpl_[A-Za-z0-9]+|v9\/projects\/prj_[A-Za-z0-9]+|v10\/projects\/prj_[A-Za-z0-9]+\/env)$/);
    assert.deepEqual(call.slice(2),['--raw','--scope',VERCEL_TARGET.scope]);
   }else{
    assert.deepEqual(call,['logs','--json','--project',VERCEL_TARGET.project,'--scope',VERCEL_TARGET.scope,'--deployment',DEP,'--since','15m','--limit','1000']);
   }
  }
 }finally{c.done();}
});

test('the documented and observed Vercel shapes, read through the real adapter, yield a proof (and a pagination block with next=null or no hidden envs is complete)',async()=>{
 const proof=await viaCli({});
 assert.equal(proof.observations.count,5);assert.equal(proof.releaseSha,SHA);assert.equal(proof.deploymentId,DEP);
 await viaCli({env:edit(envBody(),e=>{delete e.pagination;e.hiddenProductionEnvCount=0;})});
 // rows without the optional project / environment fields are accepted; rows of other paths do not matter
 await viaCli({logs:[...[4,3,2,1,0].map(m=>row(m,{projectId:undefined,environment:undefined})),row(0,{requestPath:'/api/session',responseStatusCode:401,logs:[]},7)].join('\n')+'\n'});
});

test('unparseable, non-JSON or failing Vercel output is never a proof',async()=>{
 const garbage=['not json at all','<html>502 Bad Gateway</html>','[]','null','"string"','{"envs":'];
 for(const g of garbage){
  await refusedViaCli({dep:g},'VERCEL_RESPONSE_UNPARSEABLE','deployment '+g);
  await refusedViaCli({proj:g},'VERCEL_RESPONSE_UNPARSEABLE','project '+g);
  await refusedViaCli({env:g},'VERCEL_RESPONSE_UNPARSEABLE','env '+g);
 }
 // an error body printed with exit status 0 carries none of the required fields
 await refusedViaCli({dep:{error:{code:'forbidden',message:'Not authorized'}}},'DEPLOYMENT_MISMATCH','deployment error body');
 await refusedViaCli({proj:{error:{code:'forbidden',message:'Not authorized'}}},'NOT_CURRENT_DEPLOYMENT','project error body');
 await refusedViaCli({env:{error:{code:'forbidden',message:'Not authorized'}}},'VERCEL_RESPONSE_UNPARSEABLE','env error body');
 // non-zero exit of any call, even when stdout looks fine
 for(const k of ['dep','proj','env','logs'] as const)await refusedViaCli({exit:{[k]:1}},'VERCEL_CALL_FAILED','exit '+k);
 await assert.rejects(collectDormantProof(vercelProofCliPort('/nonexistent/vercel',{PATH:process.env.PATH??''} as unknown as NodeJS.ProcessEnv),FACTS,fixed),fail('VERCEL_CALL_FAILED'));
 // the log: non-JSON output, a corrupt row among good ones, a row that cannot be attributed, an unknown log item shape
 await refusedViaCli({logs:'Error: something went wrong\n'},'VERCEL_RESPONSE_UNPARSEABLE','logs text');
 await refusedViaCli({logs:rows()+'{"timestamp":123,"deploymentId":\n'},'VERCEL_RESPONSE_UNPARSEABLE','logs corrupt row');
 await refusedViaCli({logs:rows()+'{"timestamp":123,"deploymentId":"dpl_x","projectId":"prj_x"\n'},'VERCEL_RESPONSE_UNPARSEABLE','logs truncated last row');
 await refusedViaCli({logs:rows()+JSON.stringify({timestamp:NOW,deploymentId:DEP,requestMethod:'GET',responseStatusCode:200,message:''})+'\n'},'LOG_ROW_INVALID','row without requestPath');
 await refusedViaCli({logs:rows()+row(0,{logs:'x'},9)+'\n'},'LOG_ROW_INVALID','logs not an array');
 for(const item of [5,[],{text:'x'},{message:['x']},null])await refusedViaCli({logs:rows()+row(0,{logs:[item]},9)+'\n'},'LOG_ROW_INVALID','log item '+JSON.stringify(item));
 await refusedViaCli({logs:''},'NO_REQUESTS_OBSERVED','empty log');
});

test('a reduced, partial or foreign deployment, project or env readback fails closed',async()=>{
 // deployment: missing or wrong crons / project / readyState / target / createdAt / source
 await refusedViaCli({dep:edit(depBody(),d=>{delete d.crons;})},'CRON_NOT_DEFINED','crons missing');
 await refusedViaCli({dep:edit(depBody(),d=>{d.crons=null;})},'CRON_NOT_DEFINED','crons null');
 await refusedViaCli({dep:edit(depBody(),d=>{d.crons=[{path:CRON_PATH}];})},'CRON_NOT_DEFINED','cron without schedule');
 await refusedViaCli({dep:edit(depBody(),d=>{d.projectId='prj_otherProject';})},'DEPLOYMENT_MISMATCH','deployment of another project');
 await refusedViaCli({dep:edit(depBody(),d=>{delete d.projectId;delete d.crons;delete d.createdAt;delete d.meta;})},'DEPLOYMENT_MISMATCH','reduced deployment view');
 await refusedViaCli({dep:edit(depBody(),d=>{d.id='dpl_SomethingElse12';})},'DEPLOYMENT_MISMATCH','another deployment id');
 await refusedViaCli({dep:edit(depBody(),d=>{delete d.readyState;})},'DEPLOYMENT_NOT_READY_PRODUCTION','readyState missing (status READY does not stand in)');
 await refusedViaCli({dep:edit(depBody(),d=>{d.readyState='BUILDING';})},'DEPLOYMENT_NOT_READY_PRODUCTION','readyState BUILDING');
 for(const target of [undefined,null,'staging','preview','Production'])await refusedViaCli({dep:edit(depBody(),d=>{if(target===undefined)delete d.target;else d.target=target;})},'DEPLOYMENT_NOT_READY_PRODUCTION','target '+String(target));
 for(const createdAt of [undefined,null,'1540257589405'])await refusedViaCli({dep:edit(depBody(),d=>{if(createdAt===undefined)delete d.createdAt;else d.createdAt=createdAt;})},'DEPLOYMENT_FACTS_INCOMPLETE','createdAt '+String(createdAt));
 await refusedViaCli({dep:edit(depBody(),d=>{delete d.meta;})},'WRONG_SOURCE','meta missing');
 await refusedViaCli({dep:edit(depBody(),d=>{d.meta={};})},'WRONG_SOURCE','no gitCommitSha');
 await refusedViaCli({dep:edit(depBody(),d=>{d.meta={gitCommitSha:'b'.repeat(40)};})},'WRONG_SOURCE','another commit');
 await refusedViaCli({dep:edit(depBody(),d=>{d.meta={gitCommitSha:SHA,gitDirty:'1'};})},'WRONG_SOURCE','dirty checkout');
 // project: wrong id, no current production deployment, protection field missing or weaker
 await refusedViaCli({proj:edit(projBody(),p=>{p.id='prj_otherProject';})},'NOT_CURRENT_DEPLOYMENT','project id');
 await refusedViaCli({proj:edit(projBody(),p=>{delete p.id;})},'NOT_CURRENT_DEPLOYMENT','project id missing');
 await refusedViaCli({proj:edit(projBody(),p=>{delete p.targets;})},'NOT_CURRENT_DEPLOYMENT','targets missing');
 await refusedViaCli({proj:edit(projBody(),p=>{p.targets={production:null};})},'NOT_CURRENT_DEPLOYMENT','production target null');
 await refusedViaCli({proj:edit(projBody(),p=>{p.targets={production:{id:'dpl_NewerDeployment9'}};})},'NOT_CURRENT_DEPLOYMENT','newer production deployment');
 await refusedViaCli({proj:edit(projBody(),p=>{delete p.ssoProtection;})},'PROTECTION_NOT_ALL','ssoProtection missing');
 await refusedViaCli({proj:edit(projBody(),p=>{p.ssoProtection=null;})},'PROTECTION_NOT_ALL','ssoProtection null (protection disabled)');
 await refusedViaCli({proj:edit(projBody(),p=>{p.ssoProtection={};})},'PROTECTION_NOT_ALL','deploymentType missing');
 for(const deploymentType of ['preview','prod_deployment_urls_and_all_previews','all_except_custom_domains',7])
  await refusedViaCli({proj:edit(projBody(),p=>{p.ssoProtection={deploymentType};})},'PROTECTION_NOT_ALL','deploymentType '+String(deploymentType));
 // env: duplicate / absent CRON_SECRET, an activation name, and a list that is not the whole list
 const cron={key:'CRON_SECRET',type:'sensitive',target:['production']};
 await refusedViaCli({env:{envs:[cron,cron]}},'CRON_SECRET_NOT_FIRST_AND_SENSITIVE','duplicate CRON_SECRET');
 await refusedViaCli({env:{envs:[cron,{...cron,target:['preview']}]}},'CRON_SECRET_NOT_FIRST_AND_SENSITIVE','CRON_SECRET also bound for preview');
 await refusedViaCli({env:{envs:[]}},'CRON_SECRET_NOT_FIRST_AND_SENSITIVE','no CRON_SECRET');
 await refusedViaCli({env:{envs:[{...cron,type:'encrypted'}]}},'CRON_SECRET_NOT_FIRST_AND_SENSITIVE','CRON_SECRET not sensitive');
 await refusedViaCli({env:{envs:[{...cron,target:['production','development']}]}},'CRON_SECRET_NOT_FIRST_AND_SENSITIVE','CRON_SECRET also bound for development');
 await viaCli({env:{envs:[{...cron,target:'production'}]}}); // the documented single-string target reads as exactly production
 await refusedViaCli({env:{envs:[cron,{key:'PRODUCTION_WORKER_TICK_ACTIVATION',type:'sensitive',target:['production']}]}},'ACTIVATION_NAME_ALREADY_BOUND','activation token bound');
 await refusedViaCli({env:{envs:[cron,{key:WORKER_ROLES[1]!.sink,type:'sensitive',target:['production']}]}},'ACTIVATION_NAME_ALREADY_BOUND','worker sink bound');
 await refusedViaCli({env:{envs:[cron],pagination:{count:1,next:1759600000000,prev:null}}},'ENV_READBACK_INCOMPLETE','another env page exists');
 await refusedViaCli({env:{envs:[cron],hiddenProductionEnvCount:3}},'ENV_READBACK_INCOMPLETE','production variables hidden from the caller');
 await refusedViaCli({env:{envs:[cron],hiddenProductionEnvCount:'0'}},'ENV_READBACK_INCOMPLETE','hidden count of another type');
 await refusedViaCli({env:{key:'CRON_SECRET',type:'sensitive',target:['production'],value:'x'}},'VERCEL_RESPONSE_UNPARSEABLE','a single bare variable instead of a list');
 await refusedViaCli({env:{envs:'x'}},'VERCEL_RESPONSE_UNPARSEABLE','envs not an array');
 await refusedViaCli({env:{envs:[cron,{type:'plain',target:['production']}]}},'VERCEL_RESPONSE_UNPARSEABLE','a row without a key could hide an activation name');
 await refusedViaCli({env:{envs:[cron,null]}},'VERCEL_RESPONSE_UNPARSEABLE','a null row');
});

test('the request log is read whole or not at all: limit reached, rows of another project or environment, missing row fields',async()=>{
 // exactly the limit means the log may have been cut: refused; one below is complete
 const spread=(n:number)=>Array.from({length:n},(_,i)=>row(4-(i%5),{},i)).join('\n')+'\n';
 await refusedViaCli({logs:spread(1000)},'LOG_TRUNCATED','1000 rows');
 await refusedViaCli({logs:spread(1200)},'LOG_TRUNCATED','1200 rows');
 assert.equal((await viaCli({logs:spread(999)})).observations.count,999);
 // rows of other paths count towards the limit too (the whole deployment log was cut)
 await refusedViaCli({logs:rows()+Array.from({length:995},(_,i)=>row(0,{requestPath:'/api/session'},i)).join('\n')+'\n'},'LOG_TRUNCATED','other paths fill the limit');
 await refusedViaCli({logs:rows()+row(0,{projectId:'prj_otherProject'},9)+'\n'},'UNEXPECTED_REQUEST','row of another project');
 await refusedViaCli({logs:rows()+row(0,{environment:'preview'},9)+'\n'},'UNEXPECTED_REQUEST','row of preview');
 for(const field of ['deploymentId','requestMethod','responseStatusCode','timestamp'])
  await refusedViaCli({logs:rows()+JSON.stringify(edit(JSON.parse(row(0,{},9)) as Json,r=>{delete r[field];}))+'\n'},'UNEXPECTED_REQUEST','row without '+field);
 await refusedViaCli({logs:rows()+row(0,{logs:[]},9)+'\n'},'REQUEST_WITHOUT_DORMANT_EVENT','row without any log line');
});

test('a record whose first observation is older than the log window reaches is not in the log (the window is bounded)',async()=>{
 const proof=await collectDormantProof(fakePort().port,FACTS,fixed);
 const windows:number[]=[];
 // a port that applies --since the way the CLI does: rows older than the window are simply not returned
 const windowed=(logs:RequestLog[],now:number):DormantProofPort=>({...fakePort({logs:[]}).port,async requestLogs(_id,since){windows.push(since);return logs.filter(l=>l.timestamp>=now-since*60_000);}});
 const first=Date.parse(proof.observations.firstAt);
 // the real record: the window reaches back to the first observation (plus slack), so it verifies
 assert.deepEqual(await verifyDormantProof(JSON.parse(JSON.stringify(proof)),windowed(cleanTicks(),NOW),FACTS,fixed),proof);
 assert.equal(windows[0],Math.ceil((NOW-first)/60_000)+2);
 // a well-formed record that claims an earlier first observation (and one more request) than the window can return
 const older=JSON.parse(JSON.stringify(proof)) as {observations:{firstAt:string;count:number}};
 older.observations.firstAt=new Date(NOW-9*60_000).toISOString();older.observations.count=6;
 await assert.rejects(verifyDormantProof(older,windowed(cleanTicks(),NOW),FACTS,fixed),fail('RECORD_NOT_IN_LOG'));
 // beyond the 60 minute cap the window stops growing: a record claiming a first observation 59.5 minutes back (just after the deployment was created) asks for 62 minutes of log
 windows.length=0;
 const ancient=JSON.parse(JSON.stringify(proof)) as {observations:{firstAt:string;count:number}};
 ancient.observations.firstAt=new Date(NOW-59*60_000-30_000).toISOString();ancient.observations.count=6;
 await assert.rejects(verifyDormantProof(ancient,windowed(cleanTicks(),NOW),FACTS,fixed),fail('RECORD_NOT_IN_LOG'));
 assert.equal(windows[0],60);
 // the log no longer reaches the record's last observation (rows gone from the window): refused
 await assert.rejects(verifyDormantProof(proof,windowed(cleanTicks().slice(0,3),NOW),FACTS,fixed),fail('RECORD_NOT_IN_LOG'));
});

test('a deployment that has been ticking for longer than the collection window still verifies; ticks before the record are not part of it',async()=>{
 const windowed=(logs:RequestLog[],now:number):DormantProofPort=>({...fakePort({logs:[]}).port,async requestLogs(_id,since){return logs.filter(l=>l.timestamp>=now-since*60_000);}});
 // 40 minutes of scheduler ticks, one per minute, and one stray unauthorised call (401) that is older than the record's first observation
 const ticks=Array.from({length:41},(_,i)=>tick(40-i));
 const stray=tick(0,{timestamp:NOW-16*60_000-30_000,responseStatusCode:401,messages:[]});
 const logs=[...ticks,stray];
 const proof=await collectDormantProof(windowed(logs,NOW),FACTS,fixed);
 assert.ok(proof.observations.count>=14&&proof.observations.count<=16,'the collection window is 15 minutes');
 // the record verifies at once and a few minutes later (new ticks keep arriving after it)
 const later=(min:number)=>[...logs,...Array.from({length:min},(_,i)=>tick(-(i+1)))];
 assert.deepEqual(await verifyDormantProof(JSON.parse(JSON.stringify(proof)),windowed(logs,NOW),FACTS,fixed),proof);
 for(const min of [1,2])assert.deepEqual(await verifyDormantProof(JSON.parse(JSON.stringify(proof)),windowed(later(min),NOW+min*60_000),FACTS,()=>new Date(NOW+min*60_000)),proof);
 // a stray unauthorised call AFTER the record's first observation still blocks it
 const after=[...ticks,tick(0,{timestamp:NOW-5*60_000-30_000,responseStatusCode:401,messages:[]})];
 await assert.rejects(collectDormantProof(windowed(after,NOW),FACTS,fixed),fail('UNEXPECTED_REQUEST'));
});

test('the collector command writes the proof from the real adapter path and the gate then accepts it; it refuses without the deployment id file',async()=>{
 const root=mkdtempSync(join(tmpdir(),'zao-dormant-main-'));
 try{
  const base=Date.now();
  const rows=Array.from({length:5},(_,i)=>tick(0,{timestamp:base-(4-i)*60_000-20_000}));
  const dir=evidenceDirectory(root);mkdirSync(dir,{recursive:true,mode:0o700});
  const live=fakePort({logs:rows,dep:{createdAt:base-3_600_000}}).port;
  await assert.rejects(main([],root,live,()=>SHA),fail('DEPLOYMENT_ID_MISSING'));
  writeFileSync(deploymentIdFile(dir),DEP+'\n');
  await main([],root,live,()=>SHA);
  const written=JSON.parse(readFileSync(proofFile(dir),'utf8')) as {deploymentId:string;releaseSha:string;observations:{count:number}};
  assert.deepEqual([written.deploymentId,written.releaseSha,written.observations.count],[DEP,SHA,5]);
  assert.equal((await verifyRecordedDormantProof(root,live,SHA)).deploymentId,DEP);
  // the accepted-main sha comes from the injected release check: a different accepted main is a different source
  await assert.rejects(verifyRecordedDormantProof(root,live,'b'.repeat(40)),fail('WRONG_SOURCE'));
  // a failing collection leaves the earlier record untouched
  const before=readFileSync(proofFile(dir),'utf8');
  await assert.rejects(main([],root,fakePort({logs:[]}).port,()=>SHA),fail('NO_REQUESTS_OBSERVED'));
  assert.equal(readFileSync(proofFile(dir),'utf8'),before);
 }finally{rmSync(root,{recursive:true,force:true});}
});
