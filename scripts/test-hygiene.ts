import {randomUUID,createHash} from 'node:crypto';
import {statfsSync,realpathSync,writeFileSync,readFileSync,lstatSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {resolve,join,dirname,basename} from 'node:path';
const markerPath=(directory:string)=>directory+'.owner.json';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function assessDisk(availableBytes:number,minimumBytes:number){if(!Number.isSafeInteger(availableBytes)||availableBytes<0||!Number.isSafeInteger(minimumBytes)||minimumBytes<1)throw new Error('DISK_MEASUREMENT_INVALID');return {availableBytes,minimumBytes,ready:availableBytes>=minimumBytes};}
/** Operational safety floor, not a product policy. No environment override. */
export function diskPreflight(root:string,kind:'CLUSTER'|'VERIFY'='CLUSTER'){
 const s=statfsSync(root),e={...assessDisk(s.bavail*s.bsize,(kind==='VERIFY'?4:2)*1024**3),checkedAt:new Date().toISOString(),kind};
 if(!e.ready)throw new Error('DISK_BLOCKED '+JSON.stringify(e));return e;
}
type Owner={schemaVersion:1;root:string;namespace:string;runId:string;commandId:string;clusterId:string;launcherPid:number;postgresPid:number|null;state:'CREATED'|'RUNNING'|'STOPPED'|'FAILED';kind:'CLUSTER'|'RESTORE'|'BACKUP';createdAt:string;updatedAt:string};
function alive(pid:number|null){if(pid===null)return false;try{process.kill(pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code!=='ESRCH';}}
export function createClusterOwner(directory:string,namespace:string,kind:Owner['kind']='CLUSTER'){
 const root=realpathSync(process.cwd()),parent=join(root,kind==='BACKUP'?'.local/backup-drill':'.local/postgres'),prefix=kind==='CLUSTER'?'run-':kind==='RESTORE'?'restored-':'backup-';
 const dataDirectory=kind==='CLUSTER'?directory:join(directory,'cluster');
 if(realpathSync(dirname(directory))!==parent||!new RegExp('^'+prefix+'[A-Za-z0-9]+$').test(basename(directory))||!/^zr_[a-f0-9]{12}$/.test(namespace))throw new Error('CLUSTER_OWNERSHIP_INVALID');
 const runId=process.env.ZAO_TEST_RUN_ID,commandId=process.env.ZAO_TEST_COMMAND_ID;
 if(Boolean(runId)!==Boolean(commandId)||runId&&!uuid.test(runId)||commandId&&!uuid.test(commandId))throw new Error('CLUSTER_OWNERSHIP_INVALID');
 const now=new Date().toISOString();let owner:Owner={schemaVersion:1,root,namespace,runId:runId??randomUUID(),commandId:commandId??randomUUID(),clusterId:randomUUID(),launcherPid:process.pid,postgresPid:null,state:'CREATED',kind,createdAt:now,updatedAt:now};
 const save=()=>writeFileSync(markerPath(directory),JSON.stringify(owner,null,2)+'\n',{mode:0o600});save();
 return {update(state:Owner['state']){
  let postgresPid=owner.postgresPid;const file=join(dataDirectory,'postmaster.pid');
  if(state==='RUNNING'){postgresPid=Number(readFileSync(file,'utf8').split('\n')[0]);if(!Number.isSafeInteger(postgresPid)||postgresPid<2)throw new Error('CLUSTER_PID_INVALID');}
  if(state==='STOPPED'&&(existsSync(file)||alive(postgresPid)))throw new Error('OWNED_POSTGRES_STILL_RUNNING');
  owner={...owner,state,postgresPid,updatedAt:new Date().toISOString()};save();
 }};
}
export type CleanupEvidence={runId:string;commandId:string;exitCode:number;logPath:string;logSha256:string};
/** Called only after a child exited and its complete log has been persisted. Markers
 * are resource ownership records, not a sandbox/authorization boundary. */
export function cleanupSuccessfulClusters(root:string,e:CleanupEvidence){
 const records:{directory:string;result:string}[]=[];root=realpathSync(root);
 if(!uuid.test(e.runId)||!uuid.test(e.commandId))throw new Error('CLEANUP_EVIDENCE_INVALID');
 const log=resolve(e.logPath);if(!log.startsWith(join(root,'.local/evidence/') )||!existsSync(log)||lstatSync(log).isSymbolicLink()||createHash('sha256').update(readFileSync(log)).digest('hex')!==e.logSha256)throw new Error('CLEANUP_EVIDENCE_INVALID');
 for(const relativeParent of ['.local/postgres','.local/backup-drill']){
 const parent=join(root,relativeParent);if(!existsSync(parent))continue;
 if(lstatSync(parent).isSymbolicLink()||realpathSync(parent)!==parent)throw new Error('CLEANUP_ROOT_INVALID');
 for(const name of readdirSync(parent)){
  if(!(relativeParent==='.local/postgres'?/^(run|restored)-[A-Za-z0-9]+$/:/^backup-[A-Za-z0-9]+$/).test(name))continue;
  const path=join(parent,name),note={directory:relativeParent+'/'+name,result:'PRESERVED_UNKNOWN'};
  if(!lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink()){records.push(note);continue;}
  const f=markerPath(path);let o:Owner;try{if(lstatSync(f).isSymbolicLink())throw new Error();o=JSON.parse(readFileSync(f,'utf8'));}catch{records.push(note);continue;}
  const kind=name.startsWith('run-')?'CLUSTER':name.startsWith('restored-')?'RESTORE':'BACKUP',dataDirectory=kind==='CLUSTER'?path:join(path,'cluster');
  if(o.kind!==kind){records.push(note);continue;}
  if(o.schemaVersion!==1||o.root!==root||o.runId!==e.runId||o.commandId!==e.commandId||!uuid.test(o.clusterId)){records.push(note);continue;}
  if(e.exitCode!==0||o.state==='FAILED'){note.result='PRESERVED_FAILED';records.push(note);continue;}
  if(o.state!=='STOPPED'||existsSync(join(dataDirectory,'postmaster.pid'))||alive(o.postgresPid)||alive(o.launcherPid)){note.result='PRESERVED_LIVE_OR_UNCONFIRMED';records.push(note);continue;}
  if(!existsSync(join(dataDirectory,'PG_VERSION'))){records.push(note);continue;}
  // Log proof above and stopped owner state below are written before deletion.
  note.result='DISPOSING_SUCCESSFUL_OWNED';writeFileSync(log+'.cleanup-'+o.clusterId+'.json',JSON.stringify({evidence:e,owner:o,directory:note.directory},null,2)+'\n');
  rmSync(path,{recursive:true});rmSync(f);note.result='DISPOSED_SUCCESSFUL_OWNED';records.push(note);
 }
 }
 return records;
}
