// Restore evidence finalizer (Issue 47, TD review of PR #51, M1). The migration/grants gate must not accept a hand-written `restore-pass.json`: it accepts only a
// versioned record this command derives from the REAL Production restore - the drill result the Owner wrapper saved plus the downloaded ciphertext - after checking that
// the drill ran against the Production class, the same object, the 53-entry pre-0054 registry and the exact ciphertext size. The record is created exclusively (0600) and
// carries the sha256 of the drill result; every later read re-verifies that binding, so editing either file afterwards invalidates the gate.
//   no arguments:  .local/evidence/production-backup/{object-key.txt, <basename>, restore-drill-result.json}  ->  restore-pass.json
import {createHash} from 'node:crypto';
import {closeSync,createReadStream,fchmodSync,lstatSync,openSync,readFileSync,writeSync} from 'node:fs';
import {join} from 'node:path';
import {assertKeyConsistent,parseObjectKey,plannedOutput} from './production-backup-object-get';
import {evidenceDirectory} from './production-backup-credential';

export const RESTORE_PASS_VERSION='production-restore-pass/1';
/** The pre-migration Production backup is taken at the first 53 migrations; 0054/0055 are installed only after this proof. */
export const PRE_0054_MIGRATIONS=53;
export const RESTORE_PASS_MAX_AGE_HOURS=24;
const SHA256=/^[a-f0-9]{64}$/;
const fail=(code:string)=>new Error('RESTORE_EVIDENCE_'+code);
const RECORD_KEYS=['backupScheduledAt','ciphertextBytes','drillResultSha256','finalizedAt','migrations','objectKey','objectSha256','observedBackupAgeSeconds','plaintextSha256','restoreSeconds','result','version'];

export type RestorePassRecord={version:typeof RESTORE_PASS_VERSION;result:'PASS';objectKey:string;objectSha256:string;ciphertextBytes:number;plaintextSha256:string;migrations:number;
 drillResultSha256:string;backupScheduledAt:string;restoreSeconds:number;observedBackupAgeSeconds:number;finalizedAt:string};
const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw fail('SHAPE_INVALID');return v as Record<string,unknown>;};
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const sha256File=(path:string)=>new Promise<string>((resolve,reject)=>{const h=createHash('sha256');const s=createReadStream(path);s.on('data',d=>h.update(d));s.on('error',()=>reject(fail('FILE_UNREADABLE')));s.on('end',()=>resolve(h.digest('hex')));});
const keyTimeIso=(key:string)=>{
 const m=/\/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.dump\.age$/.exec(key);
 if(!m)throw fail('KEY_INVALID');
 return `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
};
function regularFile(path:string,maxBytes?:number){
 let stat;try{stat=lstatSync(path);}catch{throw fail('FILE_MISSING');}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||(maxBytes!==undefined&&stat.size>maxBytes)||(process.getuid&&stat.uid!==process.getuid()))throw fail('FILE_INVALID');
 return stat;
}

/** The drill result must be the PRODUCTION class result for this very object at the pre-0054 registry. Nothing here trusts a free-form field. */
export function validateDrillResult(raw:unknown,expect:{key:string;ciphertextBytes:number}){
 const r=obj(raw);
 if(r.status!=='DRILL_PASS'||r.dataClass!=='PRODUCTION')throw fail('NOT_PRODUCTION_DRILL_PASS');
 if(r.key!==expect.key)throw fail('KEY_MISMATCH');
 if(r.backupScheduledAt!==keyTimeIso(expect.key))throw fail('KEY_MISMATCH');
 if(r.ciphertextBytes!==expect.ciphertextBytes)throw fail('CIPHERTEXT_MISMATCH');
 if(typeof r.plaintextSha256!=='string'||!SHA256.test(r.plaintextSha256))throw fail('SHAPE_INVALID');
 if(!finite(r.plaintextBytes)||!finite(r.restoreSeconds)||!finite(r.observedBackupAgeSeconds))throw fail('SHAPE_INVALID');
 if(typeof r.toolVersion!=='string'||!/^pg_restore \(PostgreSQL\) 18\./.test(r.toolVersion))throw fail('SHAPE_INVALID');
 if(r.productionRpoRtoApproved!==false)throw fail('SHAPE_INVALID');
 const v=obj(r.verification);
 if(v.migrations!==PRE_0054_MIGRATIONS)throw fail('MIGRATIONS_MISMATCH');
 if(!Number.isInteger(v.foreignKeys)||(v.foreignKeys as number)<1||!Number.isInteger(v.sequences))throw fail('SHAPE_INVALID');
 const critical=obj(v.critical),tables=Object.keys(critical);
 if(!tables.length||tables.includes('public.provisional_capacity_receipts'))throw fail('SHAPE_INVALID');
 for(const t of tables){const c=obj(critical[t]);if(!Number.isInteger(c.rows)||(c.rows as number)<0||typeof c.sha256!=='string'||!SHA256.test(c.sha256))throw fail('SHAPE_INVALID');}
 return {plaintextSha256:r.plaintextSha256 as string,backupScheduledAt:r.backupScheduledAt as string,restoreSeconds:r.restoreSeconds as number,observedBackupAgeSeconds:r.observedBackupAgeSeconds as number};
}

async function derive(root:string){
 const dir=evidenceDirectory(root);
 regularFile(join(dir,'object-key.txt'),512);
 const key=parseObjectKey(readFileSync(join(dir,'object-key.txt'),'utf8'));assertKeyConsistent(key);
 const drillPath=join(dir,'restore-drill-result.json');regularFile(drillPath,65536);
 const drillBytes=readFileSync(drillPath);
 let drill:unknown;try{drill=JSON.parse(drillBytes.toString('utf8'));}catch{throw fail('SHAPE_INVALID');}
 return {dir,key,drillBytes,drill,drillSha:createHash('sha256').update(drillBytes).digest('hex')};
}

export async function finalizeRestoreEvidence(root:string=process.cwd(),now:()=>Date=()=>new Date()):Promise<RestorePassRecord>{
 const {dir,key,drill,drillSha}=await derive(root);
 const cipher=plannedOutput(root,key),stat=regularFile(cipher);
 const summary=validateDrillResult(drill,{key,ciphertextBytes:stat.size});
 const record:RestorePassRecord={version:RESTORE_PASS_VERSION,result:'PASS',objectKey:key,objectSha256:await sha256File(cipher),ciphertextBytes:stat.size,plaintextSha256:summary.plaintextSha256,
  migrations:PRE_0054_MIGRATIONS,drillResultSha256:drillSha,backupScheduledAt:summary.backupScheduledAt,restoreSeconds:summary.restoreSeconds,observedBackupAgeSeconds:summary.observedBackupAgeSeconds,finalizedAt:now().toISOString()};
 let fd:number;try{fd=openSync(join(dir,'restore-pass.json'),'wx',0o600);}catch{throw fail('ALREADY_FINALIZED');}
 try{fchmodSync(fd,0o600);writeSync(fd,JSON.stringify(record)+'\n');}finally{closeSync(fd);}
 return record;
}

/** Strict reader used by every gate (0054/0055 installer, grants installer). A shape-only file, an edited record, a changed drill result or a replaced ciphertext fails. */
export async function verifyRestorePassRecord(root:string=process.cwd(),now:()=>Date=()=>new Date()):Promise<RestorePassRecord>{
 const dir=evidenceDirectory(root);
 regularFile(join(dir,'restore-pass.json'),4096);
 let raw:unknown;try{raw=JSON.parse(readFileSync(join(dir,'restore-pass.json'),'utf8'));}catch{throw fail('SHAPE_INVALID');}
 const r=obj(raw);
 if(JSON.stringify(Object.keys(r).sort())!==JSON.stringify(RECORD_KEYS))throw fail('SHAPE_INVALID');
 if(r.version!==RESTORE_PASS_VERSION||r.result!=='PASS'||r.migrations!==PRE_0054_MIGRATIONS)throw fail('SHAPE_INVALID');
 if(typeof r.objectKey!=='string')throw fail('SHAPE_INVALID');
 const key=parseObjectKey(r.objectKey);assertKeyConsistent(key);
 for(const f of ['objectSha256','plaintextSha256','drillResultSha256'])if(typeof r[f]!=='string'||!SHA256.test(r[f] as string))throw fail('SHAPE_INVALID');
 if(!Number.isInteger(r.ciphertextBytes)||(r.ciphertextBytes as number)<1||!finite(r.restoreSeconds)||!finite(r.observedBackupAgeSeconds))throw fail('SHAPE_INVALID');
 const finalized=typeof r.finalizedAt==='string'?Date.parse(r.finalizedAt):NaN;
 if(!Number.isFinite(finalized)||new Date(finalized).toISOString()!==r.finalizedAt)throw fail('SHAPE_INVALID');
 const age=now().getTime()-finalized;
 if(age<-60_000||age>RESTORE_PASS_MAX_AGE_HOURS*3_600_000)throw fail('STALE');
 // The record is bound to the drill result file and, while it still exists, to the exact downloaded ciphertext.
 const {drill,drillSha,key:currentKey}=await derive(root);
 if(drillSha!==r.drillResultSha256||currentKey!==key)throw fail('BINDING_MISMATCH');
 const summary=validateDrillResult(drill,{key,ciphertextBytes:r.ciphertextBytes as number});
 if(summary.plaintextSha256!==r.plaintextSha256||summary.backupScheduledAt!==r.backupScheduledAt)throw fail('BINDING_MISMATCH');
 const cipher=plannedOutput(root,key);let present=true;try{lstatSync(cipher);}catch{present=false;}
 if(present){const stat=regularFile(cipher);if(stat.size!==r.ciphertextBytes||await sha256File(cipher)!==r.objectSha256)throw fail('BINDING_MISMATCH');}
 return r as unknown as RestorePassRecord;
}

export async function main(argv:string[],root:string=process.cwd()){
 if(argv.length)throw fail('ARGUMENTS_REFUSED');
 const r=await finalizeRestoreEvidence(root);
 console.log(JSON.stringify({version:r.version,state:'RESTORE_PASS_FINALIZED',objectKey:r.objectKey,migrations:r.migrations,ciphertextBytes:r.ciphertextBytes,restoreSeconds:r.restoreSeconds,observedBackupAgeSeconds:r.observedBackupAgeSeconds}));
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
 main(process.argv.slice(2)).catch(error=>{
  const m=String((error as Error)?.message??'');
  console.error(JSON.stringify({state:'FAILED',code:/^(RESTORE_EVIDENCE|BACKUP_OBJECT_GET)_[A-Z_]{1,40}$/.test(m)?m:'RESTORE_EVIDENCE_FAILED'}));
  process.exitCode=1;
 });
}
