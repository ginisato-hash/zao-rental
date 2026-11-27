// Recovery evidence required before the 0065 custody link is applied to Production (registry 64 -> 65). The 0064 restore drill covered a 63-migration
// database and cannot stand in for it. The age key is NOT requested again (Owner instruction 2026-11-27): the evidence is a short record, written by the
// operator right before the privileged window, of ONE of three recovery bases for the 64-migration database:
//   NEON_RESTORE_POINT  a provider point-in-time restore point inside the retention window (reference = the provider's own identifier / timestamp)
//   RESTORE_DRILL       a restore drill PASS of a backup that already contains 0064
//   RETAINED_SOURCE_DATABASE  the cutover (scripts/production-cutover-run.ts) never alters, drops or truncates the source database: it stays in the cluster as a fenced read-only copy,
//                       identified by the digest manifest its preflight records. No age key and no Owner action are needed for this base.
// It is a fixed-shape, no-secret record; this check refuses anything else and anything older than 24 hours. It does not prove the restore itself.
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

export const PRE_0065_RECOVERY_FILE='pre-0065-recovery.json';
export const PRE_0065_RECOVERY_VERSION='production-recovery-pre-0065/1';
export const PRE_0065_MAX_AGE_MS=24*60*60*1000;
const KINDS=['NEON_RESTORE_POINT','RESTORE_DRILL','RETAINED_SOURCE_DATABASE'] as const;
const refuse=():never=>{throw Error('PRODUCTION_INSTALL_PRE0065_RECOVERY_REQUIRED');};

export function validatePre0065Recovery(raw:unknown,now:Date=new Date()){
 if(typeof raw!=='object'||raw===null||Array.isArray(raw))refuse();
 const r=raw as Record<string,unknown>;
 const keys=Object.keys(r).sort().join();
 if(keys!=='kind,recordedAt,reference,registry,version')refuse();
 if(r.version!==PRE_0065_RECOVERY_VERSION||r.registry!==64||!(KINDS as readonly unknown[]).includes(r.kind))refuse();
 if(typeof r.reference!=='string'||!/^[A-Za-z0-9_.:@/+=-]{8,200}$/.test(r.reference))refuse();
 if(typeof r.recordedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(r.recordedAt))refuse();
 const at=new Date(r.recordedAt as string).getTime(),age=now.getTime()-at;
 if(!Number.isFinite(at)||age<0||age>PRE_0065_MAX_AGE_MS)refuse();
 return {kind:r.kind as typeof KINDS[number],recordedAt:r.recordedAt,registry:64 as const};
}
export function requirePre0065Recovery(root:string=process.cwd(),now:Date=new Date()){
 const path=join(root,'.local/evidence/production-backup',PRE_0065_RECOVERY_FILE);
 if(!existsSync(path)||!lstatSync(path).isFile()||lstatSync(path).size>4096)refuse();
 let raw:unknown;try{raw=JSON.parse(readFileSync(path,'utf8'));}catch{refuse();}
 return validatePre0065Recovery(raw,now);
}
