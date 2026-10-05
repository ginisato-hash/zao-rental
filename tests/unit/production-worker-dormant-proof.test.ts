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
// One real-looking scheduler minute: GET 200, the dormant event, this deployment.
const tick=(minutesAgo:number,over:Partial<RequestLog>={}):RequestLog=>({timestamp:NOW-minutesAgo*60_000-20_000,deploymentId:DEP,requestMethod:'GET',requestPath:CRON_PATH,responseStatusCode:200,
 messages:[JSON.stringify({event:DORMANT_EVENT})],...over});
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
 for(const protectionType of [null,'preview','prod_deployment_urls_and_all_previews'])
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

test('the production port is read-only: fixed argv, bounded output, never a write verb or a token',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'zao-dormant-cli-'));
 try{
  const bin=join(dir,'vercel'),argv=join(dir,'argv');
  const out=(name:string,value:unknown)=>{writeFileSync(join(dir,name),typeof value==='string'?value:JSON.stringify(value)+'\n');return `'${join(dir,name)}'`;};
  const dep=out('dep.json',{id:DEP,projectId:VERCEL_TARGET.project,target:'production',readyState:'READY',createdAt:1000,meta:{gitCommitSha:SHA},crons:[{path:CRON_PATH,schedule:'* * * * *'}]});
  const proj=out('proj.json',{id:VERCEL_TARGET.project,targets:{production:{id:DEP}},ssoProtection:{deploymentType:'all'}});
  const env=out('env.json',{envs:[{key:'CRON_SECRET',type:'sensitive',target:['production'],value:'LEAKME'}]});
  const logFile=out('logs.txt','Fetching logs...\n'+JSON.stringify({timestamp:5,deploymentId:DEP,requestMethod:'GET',requestPath:CRON_PATH,responseStatusCode:200,message:'',logs:[{message:JSON.stringify({event:DORMANT_EVENT})}]})+'\n');
  writeFileSync(bin,`#!/bin/sh\nprintf '%s\\n' "--" "$@" >> '${argv}'\ncase "$2" in\n/v13/deployments/*) cat ${dep};;\n/v9/projects/*) cat ${proj};;\n/v10/projects/*/env) cat ${env};;\n*) cat ${logFile};;\nesac\n`);
  chmodSync(bin,0o755);
  const port=vercelProofCliPort(bin,{PATH:process.env.PATH??''} as unknown as NodeJS.ProcessEnv);
  const d=await port.deployment(DEP);assert.deepEqual([d.id,d.target,d.readyState,d.gitCommitSha,d.gitDirty,d.crons],[DEP,'production','READY',SHA,false,[{path:CRON_PATH,schedule:'* * * * *'}]]);
  const p=await port.project();assert.deepEqual(p,{id:VERCEL_TARGET.project,productionDeploymentId:DEP,protectionType:'all'});
  const rows=await port.envRows();assert.deepEqual(rows,[{key:'CRON_SECRET',type:'sensitive',target:['production']}]);assert.ok(!JSON.stringify(rows).includes('LEAKME'));
  const logs=await port.requestLogs(DEP,15);assert.equal(logs.length,1);assert.deepEqual(logs[0]!.messages,[JSON.stringify({event:DORMANT_EVENT})]);
  const calls=readFileSync(argv,'utf8').split('--\n').filter(Boolean).map(c=>c.trimEnd().split('\n'));
  assert.equal(calls.length,4);
  for(const c of calls){
   if(c[0]==='api'){
    // only GET reads of fixed paths; no method, field, input or token flag
    assert.match(c[1]!,/^\/(v13\/deployments\/dpl_[A-Za-z0-9]+|v9\/projects\/prj_[A-Za-z0-9]+|v10\/projects\/prj_[A-Za-z0-9]+\/env)$/);
    assert.deepEqual(c.slice(2),['--raw','--scope',VERCEL_TARGET.scope]);
   }else{
    assert.deepEqual(c,['logs','--json','--project',VERCEL_TARGET.project,'--scope',VERCEL_TARGET.scope,'--deployment',DEP,'--since','15m','--limit','1000']);
   }
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
