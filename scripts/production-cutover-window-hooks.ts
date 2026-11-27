// Hooks the cutover window calls AFTER the activation boundary (writes enabled, target runtime roles LOGIN) — design in CUTOVER_BINDINGS.md.
// The scheduled GitHub backup reads PRODUCTION_BACKUP_PGDATABASE/PGUSER/PGPASSWORD at every run, so these three secrets must not move before the window: until the switch the
// hourly backup keeps dumping the source, which is still the live database. Inside the window the existing backup credential lifecycle (production-backup-credential.ts,
// unchanged and pinned) provisions the NEW database's backup role and rewrites the three sinks. It is run as a child process with fixed arguments; its stdout (fixed codes,
// no secret) is parsed, never forwarded.
import {execFile} from 'node:child_process';
import {CUTOVER_TARGETS} from './production-cutover-bindings';

export type Exec=(file:string,args:string[])=>Promise<string>;
const nodeExec:Exec=(file,args)=>new Promise((resolve,reject)=>execFile(file,args,{maxBuffer:1<<20,timeout:300_000,encoding:'utf8',windowsHide:true},(e,out)=>e?reject(new Error('PRODUCTION_CUTOVER_HOOK_CHILD_FAILED')):resolve(String(out))));

export type BackupSwitchResult={database:string;step:'provision';status:string;sinksRewritten:3};
/** Provisions the backup role of the selected database and rewrites the three backup sinks. Call only after the activation boundary of the window. */
export async function switchBackupCredential(database:string,exec:Exec=nodeExec):Promise<BackupSwitchResult>{
 if(!(CUTOVER_TARGETS as readonly string[]).includes(database))throw new Error('PRODUCTION_CUTOVER_HOOK_TARGET_REFUSED');
 const out=await exec('npm',['run','--silent','backup:role-provision','--',`--database=${database}`]);
 const line=out.trim().split('\n').filter(Boolean).pop()??'';
 let parsed:{state?:unknown;status?:unknown}|null=null;try{parsed=JSON.parse(line);}catch{/* below */}
 const status=String(parsed?.state??parsed?.status??'');
 if(status!=='PROVISIONED')throw new Error('PRODUCTION_CUTOVER_HOOK_BACKUP_FAILED');
 return {database,step:'provision',status,sinksRewritten:3};
}
