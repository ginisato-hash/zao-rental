import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
/** Read-only release attestation (Issue #47 P0-B). It compares ONLY two environment values of the Production environment with the accepted main
 *  commit and ties them to one deployment. Values are compared in memory and never printed or stored; the report carries fixed reason codes, ids and times.
 *  Missing evidence is a FAIL, never a PASS. It publishes, deploys, promotes and edits nothing. */
export type ReleaseFacts={
 expectedSha:string;head:string;originMain:string;dirtyEntries:number;
 localProjectId:string|null;expectedProjectId:string;
 releaseIdValue:string|null;releaseIdUpdatedAt:number|null;
 approvalValue:string|null;approvalUpdatedAt:number|null;approvalOrigin:string;
 deployment:{id:string;projectId:string|null;target:string|null;readyState:string|null;createdAt:number|null}|null;
 runtimeReleaseSha:string|null;aliasDeploymentId:string|null;
};
export type Attestation={status:'PASS'|'FAIL';reasons:string[];releaseSha:string;deploymentId:string|null};
const SHA=/^[a-f0-9]{40}$/;
export function evaluateRelease(f:ReleaseFacts):Attestation{
 const r:string[]=[];const need=(ok:boolean,code:string)=>{if(!ok)r.push(code);};
 need(SHA.test(f.expectedSha),'EXPECTED_SHA_INVALID');
 need(f.head===f.expectedSha&&f.originMain===f.expectedSha,'SOURCE_NOT_ACCEPTED_MAIN');
 need(f.dirtyEntries===0,'WORKTREE_DIRTY');
 need(f.localProjectId!==null&&f.localProjectId===f.expectedProjectId,'PROJECT_LINK_MISMATCH');
 need(f.releaseIdValue!==null&&f.releaseIdValue===f.expectedSha,'RELEASE_ID_MISMATCH');
 let approvalOk=false;
 if(f.approvalValue!==null){try{const a=JSON.parse(f.approvalValue) as {state?:unknown;origin?:unknown;releaseId?:unknown;approvedBy?:unknown;approvedAt?:unknown};
  approvalOk=a.state==='PUBLICATION_APPROVED'&&a.origin===f.approvalOrigin&&a.releaseId===f.expectedSha&&typeof a.approvedBy==='string'&&a.approvedBy.trim().length>0&&typeof a.approvedAt==='string'&&Number.isFinite(Date.parse(a.approvedAt));}catch{approvalOk=false;}}
 need(approvalOk,'APPROVAL_MISMATCH');
 const d=f.deployment;
 need(d!==null,'DEPLOYMENT_EVIDENCE_MISSING');
 if(d){
  need(d.projectId===f.expectedProjectId,'DEPLOYMENT_WRONG_PROJECT');need(d.target==='production','DEPLOYMENT_NOT_PRODUCTION');need(d.readyState==='READY','DEPLOYMENT_NOT_READY');
  need(d.createdAt!==null,'DEPLOYMENT_TIME_MISSING');
  // Both values must have been written BEFORE this deployment was created: a later or missing write means the stage did not snapshot them.
  need(d.createdAt!==null&&f.releaseIdUpdatedAt!==null&&f.releaseIdUpdatedAt<=d.createdAt,'RELEASE_ID_NOT_BEFORE_DEPLOYMENT');
  need(d.createdAt!==null&&f.approvalUpdatedAt!==null&&f.approvalUpdatedAt<=d.createdAt,'APPROVAL_NOT_BEFORE_DEPLOYMENT');
  need(f.aliasDeploymentId===d.id,'ALIAS_NOT_THIS_DEPLOYMENT');
 }
 need(f.runtimeReleaseSha!==null&&f.runtimeReleaseSha===f.expectedSha,'RUNTIME_SHA_MISMATCH');
 return {status:r.length?'FAIL':'PASS',reasons:r,releaseSha:f.expectedSha,deploymentId:d?.id??null};
}
const run=(cmd:string,args:string[],cwd:string)=>execFileSync(cmd,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore'],maxBuffer:8_000_000});
const api=<T>(cwd:string,path:string):T|null=>{try{return JSON.parse(run('npx',['vercel','api',path,'--raw'],cwd)) as T;}catch{return null;}};
export const PRODUCTION_ORIGIN='https://salomon-rental.yuge-zao.com';
export function collect(cwd:string,deploymentId:string):ReleaseFacts{
 const link=JSON.parse(readFileSync(cwd+'/.vercel/project.json','utf8')) as {projectId?:string};
 const head=run('git',['rev-parse','HEAD'],cwd).trim();const originMain=run('git',['rev-parse','origin/main'],cwd).trim();
 const dirty=run('git',['status','--porcelain'],cwd).split('\n').filter(Boolean).length;
 const pid=link.projectId??'';
 const list=api<{envs?:{id:string;key:string;target?:string[]}[]}>(cwd,`/v9/projects/${pid}/env?target=production`);
 const one=(key:string)=>{const e=list?.envs?.find(x=>x.key===key&&x.target?.includes('production'));if(!e)return {value:null,updatedAt:null};
  const d=api<{value?:string;updatedAt?:number}>(cwd,`/v1/projects/${pid}/env/${e.id}`);const m=api<{envs?:{id:string;updatedAt?:number}[]}>(cwd,`/v9/projects/${pid}/env?target=production`)?.envs?.find(x=>x.id===e.id);
  return {value:typeof d?.value==='string'?d.value:null,updatedAt:typeof m?.updatedAt==='number'?m.updatedAt:null};};
 const rel=one('PRODUCTION_RELEASE_ID'),apr=one('PRODUCTION_PUBLICATION_APPROVAL');
 const dep=api<{id?:string;projectId?:string;target?:string|null;readyState?:string;createdAt?:number}>(cwd,`/v13/deployments/${deploymentId}`);
 let runtime:string|null=null;try{runtime=(JSON.parse(run('npx',['vercel','curl','/api/release','--deployment',deploymentId,'--','-s'],cwd)) as {releaseSha?:string}).releaseSha??null;}catch{runtime=null;}
 let alias:string|null=null;try{const a=api<{deploymentId?:string}>(cwd,`/v4/aliases/${new URL(PRODUCTION_ORIGIN).hostname}`);alias=a?.deploymentId??null;}catch{alias=null;}
 return {expectedSha:originMain,head,originMain,dirtyEntries:dirty,localProjectId:link.projectId??null,expectedProjectId:pid,releaseIdValue:rel.value,releaseIdUpdatedAt:rel.updatedAt,approvalValue:apr.value,approvalUpdatedAt:apr.updatedAt,approvalOrigin:PRODUCTION_ORIGIN,
  deployment:dep&&dep.id?{id:dep.id,projectId:dep.projectId??null,target:dep.target??null,readyState:dep.readyState??null,createdAt:dep.createdAt??null}:null,runtimeReleaseSha:runtime,aliasDeploymentId:alias};
}
export function main(argv:string[],cwd=process.cwd()){
 if(argv.length!==1||!/^dpl_[A-Za-z0-9]{20,40}$/.test(argv[0]!))throw new Error('RELEASE_ATTEST_ARGUMENTS_REJECTED');
 const result=evaluateRelease(collect(cwd,argv[0]!));
 console.log(JSON.stringify({...result,checkedAt:new Date().toISOString()}));
 if(result.status!=='PASS')process.exitCode=1;
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){try{main(process.argv.slice(2));}catch(e){console.error(JSON.stringify({status:'STOP',code:/^RELEASE_ATTEST_[A-Z_]+$/.test(String((e as Error).message))?(e as Error).message:'RELEASE_ATTEST_FAILED'}));process.exitCode=1;}}
