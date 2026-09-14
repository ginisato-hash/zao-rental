import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {productionPreflight,type PreflightFacts} from '../packages/contracts/src/production-preflight';
import {canonical} from '../packages/contracts/src/hold';
const repo='ginisato-hash/zao-rental',offline=process.argv.includes('--offline');
if(process.argv.slice(2).some(v=>v!=='--offline'))throw new Error('PREFLIGHT_ARGUMENT_REJECTED');
const git=(...a:string[])=>execFileSync('git',a,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
// Read-only GitHub calls. Do not print raw errors/responses, URLs with secrets or env.
const gh=(...a:string[]):unknown=>JSON.parse(execFileSync('gh',['api',...a],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000,maxBuffer:4*1024*1024}));
const head=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');
const owner=JSON.parse(readFileSync('config/production/p4-owner-decisions.json','utf8')),guest=JSON.parse(readFileSync('config/production/guest.p4-approved-policy.json','utf8'));
const approved={version:'owner-balanced-p4',contextSeconds:3600,absoluteSeconds:86400,recoverySeconds:43200,replaySeconds:600,retentionSeconds:86400,windowSeconds:60,peerRequests:180,globalRequests:1200};
const facts:PreflightFacts={head,tree,main:null,checkedAt:new Date().toISOString(),worktreeClean:git('status','--porcelain').length===0,guestPolicyApproved:guest.state==='OWNER_APPROVED_VALUES_INGRESS_UNVERIFIED'&&guest.purpose==='GUEST_DRAFT_CHECKOUT_ONLY'&&canonical(guest.policy)===canonical(approved),independentCouponDisabled:owner.independentCouponEnabled===false&&owner.advanceEligibility==='PAYMENT_COMPLETED_BY_PREVIOUS_DAY_15_00_JST',offline};
if(!offline){
 try{
  const main=gh('repos/'+repo+'/git/ref/heads/main') as {object:{sha:string}};facts.main=main.object.sha;
  const r=gh('repos/'+repo+'/rulesets/23161641') as {enforcement:string;target:string;bypass_actors:unknown[];conditions:{ref_name:{include:string[];exclude:string[]}};rules:{type:string;parameters?:Record<string,unknown>}[]};
  const rules=Object.fromEntries(r.rules.map(v=>[v.type,v.parameters??{}])),p=rules.pull_request,s=rules.required_status_checks;
  facts.mainProtection={source:'GITHUB_READ_ONLY',active:r.enforcement==='active'&&r.target==='branch',defaultBranch:canonical(r.conditions.ref_name)==='{"exclude":[],"include":["~DEFAULT_BRANCH"]}',prRequired:Boolean(p),foundationRequired:canonical(s?.required_status_checks)===canonical([{context:'foundation',integration_id:15368}]),strict:s?.strict_required_status_checks_policy===true,conversations:p?.required_review_thread_resolution===true,squashOnly:canonical(p?.allowed_merge_methods)===canonical(['squash']),forcePushBlocked:Object.hasOwn(rules,'non_fast_forward'),noBypass:Array.isArray(r.bypass_actors)&&r.bypass_actors.length===0};
 }catch{/* NOT_RUN, no credential prompt/fallback */}
 try{
  const list=gh('repos/'+repo+'/actions/runs?head_sha='+head+'&per_page=100') as {workflow_runs:{id:number;run_attempt:number;head_sha:string;head_repository:{full_name:string};workflow_id:number;event:string;status:string;conclusion:string}[]};
  const r=list.workflow_runs.filter(r=>r.workflow_id===355028197&&r.event==='pull_request').sort((a,b)=>b.id-a.id)[0];
  if(r){const artifacts=gh('repos/'+repo+'/actions/runs/'+r.id+'/artifacts') as {artifacts:{name:string;expired:boolean}[]};const a=artifacts.artifacts.find(a=>/^foundation-[a-f0-9]{40}$/.test(a.name)&&!a.expired);if(!a)throw new Error();const checkout=a.name.slice('foundation-'.length),c=gh('repos/'+repo+'/git/commits/'+checkout) as {tree:{sha:string};parents:{sha:string}[]};
   const w=gh('repos/'+repo+'/actions/workflows/355028197') as {path:string},jobs=gh('repos/'+repo+'/actions/runs/'+r.id+'/attempts/'+r.run_attempt+'/jobs') as {jobs:{name:string;conclusion:string}[]};
   const parents=c.parents.map(p=>p.sha);facts.foundation={source:'GITHUB_READ_ONLY',repository:r.head_repository.full_name,workflow:w.path,event:r.event,head:r.head_sha,base:parents[0]??'',checkout,tree:c.tree.sha,runId:r.id,attempt:r.run_attempt,conclusion:r.status==='completed'?r.conclusion:'in_progress',jobsSucceeded:parents.length===2&&parents[1]===head&&jobs.jobs.some(j=>j.name==='foundation')&&jobs.jobs.every(j=>j.conclusion==='success')};
  }
 }catch{/* Missing or partial CI evidence is not a PASS. */}
}
const result=productionPreflight(facts);
console.error('ZAO Rental production preflight: '+(result.ready?'READY':'NOT READY')+' (read-only; no activation)');for(const g of result.gates)console.error(g.id+': '+g.state+' — '+g.reason);
console.log(JSON.stringify(result,null,2));process.exit(result.ready?0:2);
