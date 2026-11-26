import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {buildDigestFromTree} from './lib/build-manifest.cjs';
/** Read-only release attestation (Issue #47 P0-B). Two modes, never mixed:
 *   stage  (before promote): candidate deployment READY/production/pinned project, env values bound to the accepted main, build digest equal to the clean checkout,
 *                            and the formal alias STILL on another deployment (a stage that already owns the alias is not a stage).
 *   post   (after promote):  the same, and the formal alias MUST be the candidate.
 *  The project/team are independently PINNED below (public identifiers); the local .vercel link and the deployment must equal the pin, never each other.
 *  Values are compared in memory only; the report carries fixed reason codes, ids and times. Missing evidence is FAIL. It edits and publishes nothing. */
export const PINNED_PROJECT_ID='prj_ehUMOzM77em9DVnHJBJffncD5hg7';
export const PINNED_TEAM_ID='team_PVka5z4T6OMKBmUcqrK09yJz';
export const PINNED_APPROVER='ginisato-hash';
export const PRODUCTION_ORIGIN='https://salomon-rental.yuge-zao.com';
export type Mode='stage'|'post';
export type ReleaseFacts={
 mode:Mode;expectedSha:string;head:string;originMain:string;dirtyEntries:number;
 localProjectId:string|null;localTeamId:string|null;pinnedProjectId:string;pinnedTeamId:string;
 releaseIdValue:string|null;releaseIdUpdatedAt:number|null;
 approvalValue:string|null;approvalUpdatedAt:number|null;approvalOrigin:string;pinnedApprover:string;
 deployment:{id:string;projectId:string|null;target:string|null;readyState:string|null;createdAt:number|null}|null;
 runtimeReleaseSha:string|null;runtimeBuildDigest:string|null;localBuildDigest:string|null;aliasDeploymentId:string|null;
};
export type Attestation={mode:Mode;status:'PASS'|'FAIL';reasons:string[];releaseSha:string;deploymentId:string|null};
const SHA=/^[a-f0-9]{40}$/,DIGEST=/^[a-f0-9]{64}$/;
export function evaluateRelease(f:ReleaseFacts):Attestation{
 const r:string[]=[];const need=(ok:boolean,code:string)=>{if(!ok)r.push(code);};
 need(SHA.test(f.expectedSha),'EXPECTED_SHA_INVALID');
 need(f.head===f.expectedSha&&f.originMain===f.expectedSha,'SOURCE_NOT_ACCEPTED_MAIN');
 need(f.dirtyEntries===0,'WORKTREE_DIRTY');
 need(f.localProjectId===f.pinnedProjectId&&f.localTeamId===f.pinnedTeamId,'PROJECT_LINK_MISMATCH');
 need(f.releaseIdValue!==null&&f.releaseIdValue===f.expectedSha,'RELEASE_ID_MISMATCH');
 let approvalOk=false;
 if(f.approvalValue!==null){try{const a=JSON.parse(f.approvalValue) as {state?:unknown;origin?:unknown;releaseId?:unknown;approvedBy?:unknown;approvedAt?:unknown};
  approvalOk=a.state==='PUBLICATION_APPROVED'&&a.origin===f.approvalOrigin&&a.releaseId===f.expectedSha&&a.approvedBy===f.pinnedApprover&&typeof a.approvedAt==='string'&&Number.isFinite(Date.parse(a.approvedAt));}catch{approvalOk=false;}}
 need(approvalOk,'APPROVAL_MISMATCH');
 const d=f.deployment;
 need(d!==null,'DEPLOYMENT_EVIDENCE_MISSING');
 if(d){
  need(d.projectId===f.pinnedProjectId,'DEPLOYMENT_WRONG_PROJECT');need(d.target==='production','DEPLOYMENT_NOT_PRODUCTION');need(d.readyState==='READY','DEPLOYMENT_NOT_READY');
  need(d.createdAt!==null,'DEPLOYMENT_TIME_MISSING');
  need(d.createdAt!==null&&f.releaseIdUpdatedAt!==null&&f.releaseIdUpdatedAt<=d.createdAt,'RELEASE_ID_NOT_BEFORE_DEPLOYMENT');
  need(d.createdAt!==null&&f.approvalUpdatedAt!==null&&f.approvalUpdatedAt<=d.createdAt,'APPROVAL_NOT_BEFORE_DEPLOYMENT');
  if(f.mode==='post')need(f.aliasDeploymentId===d.id,'ALIAS_NOT_THIS_DEPLOYMENT');
  else need(f.aliasDeploymentId!==null&&f.aliasDeploymentId!==d.id,'STAGE_ALIAS_ALREADY_MOVED_OR_UNKNOWN');
 }
 need(f.runtimeReleaseSha!==null&&f.runtimeReleaseSha===f.expectedSha,'RUNTIME_SHA_MISMATCH');
 need(f.runtimeBuildDigest!==null&&DIGEST.test(f.runtimeBuildDigest)&&f.runtimeBuildDigest===f.localBuildDigest,'BUILD_DIGEST_MISMATCH');
 return {mode:f.mode,status:r.length?'FAIL':'PASS',reasons:r,releaseSha:f.expectedSha,deploymentId:d?.id??null};
}
export type Exec={run:(cmd:string,args:string[],cwd:string)=>string;readText:(path:string)=>string;digest:(root:string)=>string};
export const realExec:Exec={run:(cmd,args,cwd)=>execFileSync(cmd,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore'],maxBuffer:8_000_000}),readText:p=>readFileSync(p,'utf8'),digest:buildDigestFromTree};
export function collect(cwd:string,deploymentId:string,mode:Mode,x:Exec=realExec):ReleaseFacts{
 const api=<T>(path:string):T|null=>{try{return JSON.parse(x.run('npx',['vercel','api',path,'--raw'],cwd)) as T;}catch{return null;}};
 const link=JSON.parse(x.readText(cwd+'/.vercel/project.json')) as {projectId?:string;orgId?:string};
 const head=x.run('git',['rev-parse','HEAD'],cwd).trim();
 // fresh canonical main from the remote, not a possibly stale local ref
 const remote=x.run('git',['ls-remote','origin','refs/heads/main'],cwd).trim().split(/\s+/);const originMain=remote.length===2&&remote[1]==='refs/heads/main'?remote[0]!:'';
 const dirty=x.run('git',['status','--porcelain','--untracked-files=all'],cwd).split('\n').filter(Boolean).length;
 // every API path uses the PINNED project id, so a wrong local link cannot redirect the comparison
 const pid=PINNED_PROJECT_ID;
 const list=api<{envs?:{id:string;key:string;target?:string[];updatedAt?:number}[]}>(`/v9/projects/${pid}/env?target=production`);
 const one=(key:string)=>{const e=list?.envs?.find(v=>v.key===key&&v.target?.includes('production'));if(!e)return {value:null,updatedAt:null};
  const d=api<{value?:string}>(`/v1/projects/${pid}/env/${e.id}`);return {value:typeof d?.value==='string'?d.value:null,updatedAt:typeof e.updatedAt==='number'?e.updatedAt:null};};
 const rel=one('PRODUCTION_RELEASE_ID'),apr=one('PRODUCTION_PUBLICATION_APPROVAL');
 const dep=api<{id?:string;projectId?:string;target?:string|null;readyState?:string;createdAt?:number}>(`/v13/deployments/${deploymentId}`);
 let rs:string|null=null,rd:string|null=null;try{const j=JSON.parse(x.run('npx',['vercel','curl','/api/release','--deployment',deploymentId,'--','-s'],cwd)) as {releaseSha?:string;buildDigest?:string};rs=j.releaseSha??null;rd=j.buildDigest??null;}catch{rs=null;rd=null;}
 const a=api<{deploymentId?:string}>(`/v4/aliases/${new URL(PRODUCTION_ORIGIN).hostname}`);
 return {mode,expectedSha:originMain,head,originMain,dirtyEntries:dirty,localProjectId:link.projectId??null,localTeamId:link.orgId??null,pinnedProjectId:PINNED_PROJECT_ID,pinnedTeamId:PINNED_TEAM_ID,
  releaseIdValue:rel.value,releaseIdUpdatedAt:rel.updatedAt,approvalValue:apr.value,approvalUpdatedAt:apr.updatedAt,approvalOrigin:PRODUCTION_ORIGIN,pinnedApprover:PINNED_APPROVER,
  deployment:dep&&dep.id?{id:dep.id,projectId:dep.projectId??null,target:dep.target??null,readyState:dep.readyState??null,createdAt:dep.createdAt??null}:null,
  runtimeReleaseSha:rs,runtimeBuildDigest:rd,localBuildDigest:x.digest(cwd),aliasDeploymentId:a?.deploymentId??null};
}
export function main(argv:string[],cwd=process.cwd(),x:Exec=realExec){
 const [mode,id]=argv;
 if(argv.length!==2||(mode!=='stage'&&mode!=='post')||!/^dpl_[A-Za-z0-9]{20,40}$/.test(id!))throw new Error('RELEASE_ATTEST_ARGUMENTS_REJECTED');
 const result=evaluateRelease(collect(cwd,id!,mode,x));
 console.log(JSON.stringify({...result,checkedAt:new Date().toISOString()}));
 if(result.status!=='PASS')process.exitCode=1;
 return result;
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){try{main(process.argv.slice(2));}catch(e){console.error(JSON.stringify({status:'STOP',code:/^RELEASE_ATTEST_[A-Z_]+$/.test(String((e as Error).message))?(e as Error).message:'RELEASE_ATTEST_FAILED'}));process.exitCode=1;}}
