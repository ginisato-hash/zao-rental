import {execFileSync} from 'node:child_process';
import {lstatSync,realpathSync,readFileSync} from 'node:fs';
import {isAbsolute,relative} from 'node:path';
import {flowObject} from '../packages/contracts/src/rental-flow';
import {commercialProductionPlan,commercialRuntimeInput,commercialSquareRoutes} from '../packages/core/src/guest/production-commercial-composition';
import {composeProductionRuntime} from '../packages/core/src/guest/production-runtime';
import {issueExactProductionIdentity} from '../packages/auth/src/production-identity';
import {SquareProductionPaymentTruth} from '../packages/core/src/payment/square-payment-truth';
import {normalWorkerPlan} from '../packages/core/src/payment/normal-production-worker';

/** Explicit operator invocation; no cron, .env fallback or automatic credential mutation. */
async function main(){
 const [command,flag,path,...extra]=process.argv.slice(2);
 if(!['preflight','run-once'].includes(command??'')||flag!=='--input'||!path||!isAbsolute(path)||extra.length)throw Error('NORMAL_WORKER_ARGUMENTS_REJECTED');
 const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000}).trim();
 const stat=lstatSync(path),resolved=realpathSync(path),rel=relative(git('rev-parse','--show-toplevel'),resolved);
 if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o600||stat.size>65536||!rel.startsWith('../')||process.getuid&&stat.uid!==process.getuid())throw Error('NORMAL_WORKER_SECURE_INPUT_REQUIRED');
 const raw=flowObject(JSON.parse(readFileSync(resolved,'utf8')),['environment','databaseUrls','plan']);
 const environment=raw.environment as Record<string,string>,plan=normalWorkerPlan(raw.plan),commercial=commercialProductionPlan(environment);
 if(!commercial)throw Error('NORMAL_WORKER_NOT_ACTIVATED');
 if(git('remote','get-url','origin')!=='https://github.com/ginisato-hash/zao-rental.git'||git('status','--porcelain')!==''||commercial.configuration.deployment.releaseId!==git('rev-parse','HEAD')||git('ls-remote','origin','refs/heads/main').split(/\s+/)[0]!==git('rev-parse','HEAD'))throw Error('NORMAL_WORKER_RELEASE_REJECTED');
 const identity=issueExactProductionIdentity(commercial.configuration),fetch:typeof globalThis.fetch=(url,init)=>globalThis.fetch(url,init),routes=commercialSquareRoutes(commercial.square,fetch),runtime=await composeProductionRuntime(commercialRuntimeInput(commercial,identity,fetch));
 try{
  const result=await runtime.runWorker({plan,databaseUrls:flowObject(raw.databaseUrls,['dispatcher','worker','projector']) as Record<'dispatcher'|'worker'|'projector',string>,preflight:command==='preflight',lookup:{async lookupPayment(request){
   const route=Object.values(routes).find(r=>r.locationId===request.expected.locationId);
   if(!route)return {kind:'FAILED',code:'EVIDENCE_MISMATCH_BLOCKED'};
   return new SquareProductionPaymentTruth(route.transport).lookupPayment(request);
  }}});
  console.log(JSON.stringify({status:'DONE',releaseId:commercial.configuration.deployment.releaseId,result}));
 }finally{await runtime.close();}
}
main().catch(()=>{console.error(JSON.stringify({status:'STOP',code:'NORMAL_WORKER_OPERATION_FAILED_NO_RETRY'}));process.exitCode=1;});
