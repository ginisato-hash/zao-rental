import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export const REPOSITORY = 'ginisato-hash/zao-rental';
export const REPOSITORY_ID = 1364387206;
export const WORKFLOW_ID = 355028197;
export const WORKFLOW_PATH = '.github/workflows/ci.yml';
const sha = /^[a-f0-9]{40}$/;
const positive = (n:number) => Number.isSafeInteger(n) && n > 0;
export type ReadRequest = {kind:'repository'} | {kind:'pull';number:number} | {kind:'run';id:number} | {kind:'attempt';id:number;attempt:number} | {kind:'workflow'} | {kind:'commit';sha:string} | {kind:'workflowBlob';sha:string};
export function readArguments(request:ReadRequest):string[] {
  const prefix=`repos/${REPOSITORY}`;let endpoint:string;
  switch(request.kind){
    case 'repository':endpoint=prefix;break;
    case 'pull':if(!positive(request.number))throw new Error('INVALID_PR');endpoint=`${prefix}/pulls/${request.number}`;break;
    case 'run':if(!positive(request.id))throw new Error('INVALID_RUN');endpoint=`${prefix}/actions/runs/${request.id}`;break;
    case 'attempt':if(!positive(request.id)||!positive(request.attempt))throw new Error('INVALID_ATTEMPT');endpoint=`${prefix}/actions/runs/${request.id}/attempts/${request.attempt}`;break;
    case 'workflow':endpoint=`${prefix}/actions/workflows/${WORKFLOW_ID}`;break;
    case 'commit':if(!sha.test(request.sha))throw new Error('INVALID_SHA');endpoint=`${prefix}/git/commits/${request.sha}`;break;
    case 'workflowBlob':if(!sha.test(request.sha))throw new Error('INVALID_SHA');endpoint=`${prefix}/contents/${WORKFLOW_PATH}?ref=${request.sha}`;break;
    default:throw new Error('UNAPPROVED_READ_OPERATION');
  }
  return ['api','--hostname','github.com','--method','GET',endpoint];
}
export type ReadTransport = (args:string[],env:NodeJS.ProcessEnv)=>Promise<string>;
export function controllerReadEnvironment(environment:NodeJS.ProcessEnv) {
  // Host-side gh reads its existing auth itself. No keychain/config/token extraction or duplication.
  if (!environment.HOME) throw new Error('CONTROLLER_HOME_REQUIRED');
  const clean:NodeJS.ProcessEnv=Object.create(null);
  for(const key of ['HOME','PATH','LANG','TMPDIR'])if(environment[key])clean[key]=environment[key];
  return clean;
}
export class ReadOnlyGitHub {
  private stopped=false;
  constructor(private readonly transport:ReadTransport,private readonly environment:NodeJS.ProcessEnv){}
  async get(request:ReadRequest):Promise<unknown>{
    if(this.stopped)throw new Error('READ_SESSION_STOPPED_NO_RETRY');
    const args=readArguments(request);
    try{return JSON.parse(await this.transport(args,controllerReadEnvironment(this.environment))) as unknown;}
    catch{this.stopped=true;throw new Error('GITHUB_READ_FAILED_AUTH_QUOTA_NETWORK_OR_RESPONSE_REQUIRES_HUMAN_CHECK');}
  }
}
export function existingGhTransport(executable:string,cwd:string):ReadTransport {
  if(!executable.startsWith('/')||!cwd.startsWith('/'))throw new Error('ABSOLUTE_HOST_PATHS_REQUIRED');
  return async(args,env)=>(await promisify(execFile)(executable,args,{cwd,env,timeout:30_000,maxBuffer:2*1024*1024,encoding:'utf8'})).stdout;
}
// API input is untrusted JSON; only exact pinned metadata is adopted. Never evaluate provider text.
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_OBSERVATION');return value as Record<string,unknown>;}
function at(value:unknown,...keys:string[]):unknown{let result:unknown=value;for(const key of keys)result=object(result)[key];return result;}
export type CiPin={repository:string;repositoryId:number;workflowId:number;workflowPath:string;workflowBlobSha:string;pr:number;runId:number;attempt:number;base:string;head:string;merge:string;tree:string};
export type Observations={repository:unknown;pull:unknown;run:unknown;attempt:unknown;workflow:unknown;merge:unknown;head:unknown;workflowBlob:unknown};
export function validateCi(pin:CiPin,data:Observations){
  if(pin.repository!==REPOSITORY||pin.repositoryId!==REPOSITORY_ID||pin.workflowId!==WORKFLOW_ID||pin.workflowPath!==WORKFLOW_PATH||![pin.base,pin.head,pin.merge,pin.tree,pin.workflowBlobSha].every(x=>sha.test(x))||![pin.pr,pin.runId,pin.attempt].every(positive))throw new Error('INVALID_TRUSTED_CI_PIN');
  const equal=(actual:unknown,expected:unknown,reason:string)=>{if(actual!==expected)throw new Error(reason);};
  equal(at(data.repository,'id'),pin.repositoryId,'REPOSITORY_ID');equal(at(data.repository,'full_name'),pin.repository,'REPOSITORY_NAME');
  equal(at(data.workflow,'id'),pin.workflowId,'WORKFLOW_ID');equal(at(data.workflow,'path'),pin.workflowPath,'WORKFLOW_PATH');equal(at(data.workflow,'state'),'active','WORKFLOW_DISABLED');
  equal(at(data.workflowBlob,'sha'),pin.workflowBlobSha,'WORKFLOW_CONTENT_CHANGED');equal(at(data.workflowBlob,'path'),pin.workflowPath,'WORKFLOW_BLOB_PATH');
  equal(at(data.pull,'number'),pin.pr,'PR_NUMBER');equal(at(data.pull,'head','sha'),pin.head,'CURRENT_PR_HEAD_CHANGED');equal(at(data.pull,'head','repo','id'),pin.repositoryId,'FORK_HEAD');equal(at(data.pull,'base','sha'),pin.base,'CURRENT_PR_BASE_CHANGED');equal(at(data.pull,'base','repo','id'),pin.repositoryId,'PR_BASE_REPOSITORY');
  for(const run of [data.run,data.attempt]){
    equal(at(run,'repository','id'),pin.repositoryId,'RUN_REPOSITORY');equal(at(run,'repository','full_name'),pin.repository,'RUN_REPOSITORY_NAME');equal(at(run,'head_repository','id'),pin.repositoryId,'RUN_HEAD_REPOSITORY');
    equal(at(run,'id'),pin.runId,'RUN_ID');equal(at(run,'run_attempt'),pin.attempt,'STALE_RUN_ATTEMPT');equal(at(run,'workflow_id'),pin.workflowId,'RUN_WORKFLOW');equal(at(run,'path'),pin.workflowPath,'RUN_WORKFLOW_PATH');equal(at(run,'event'),'pull_request','UNAPPROVED_EVENT');equal(at(run,'head_sha'),pin.head,'STALE_CI_HEAD');equal(at(run,'status'),'completed','CI_NOT_COMPLETE');equal(at(run,'conclusion'),'success','CI_NOT_SUCCESS');
  }
  equal(at(data.merge,'sha'),pin.merge,'MERGE_SHA');equal(at(data.merge,'tree','sha'),pin.tree,'MERGE_TREE');equal(at(data.head,'sha'),pin.head,'HEAD_SHA');equal(at(data.head,'tree','sha'),pin.tree,'HEAD_TREE');
  const parents=at(data.merge,'parents');if(!Array.isArray(parents)||JSON.stringify(parents.map(p=>at(p,'sha')))!==JSON.stringify([pin.base,pin.head]))throw new Error('UNVERIFIED_INTEGRATION');
  return {status:'VERIFIED_READ_ONLY' as const,...pin,event:'pull_request',conclusion:'success',writeAuthorizationProven:false,liveDispatchProven:false};
}
export async function observePinnedCi(client:ReadOnlyGitHub,pin:CiPin){
  // Sequential and single-shot: auth/quota/unknown failures halt this session immediately.
  const data:Observations={repository:await client.get({kind:'repository'}),attempt:await client.get({kind:'attempt',id:pin.runId,attempt:pin.attempt}),workflow:await client.get({kind:'workflow'}),merge:await client.get({kind:'commit',sha:pin.merge}),head:await client.get({kind:'commit',sha:pin.head}),workflowBlob:await client.get({kind:'workflowBlob',sha:pin.head}),run:await client.get({kind:'run',id:pin.runId}),pull:await client.get({kind:'pull',number:pin.pr})};
  return validateCi(pin,data);
}
