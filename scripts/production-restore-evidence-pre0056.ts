// Pre-0056 restore evidence (R-01, Issue 47). The 0056 installer runs on the 0001-0055 Production database, so it needs a fresh restore proof of THAT database. The frozen
// pre-0054 finalizer (`production-restore-evidence.ts`, 53 migrations, byte-pinned by the reviewed 0054/0055 lifecycle policy) stays unchanged and cannot satisfy this gate.
// Same bindings as the frozen contract — object key, downloaded ciphertext size+sha256, the hashed drill result, pg_restore 18, PRODUCTION class, 24 hours from the drill's own
// `finishedAt` — but bound to the 55-entry registry digest of this checkout's migrations 0001-0055 and requiring the current receipt-capacity ledger in the critical fingerprint.
// It has its own drill result and record files, so neither record can stand in for the other. NOT PROVEN (as for the frozen contract): no signature; a writer of the evidence
// directory can forge a self-consistent set, and nothing here proves the object in R2 is this file.
//   no arguments:  .local/evidence/production-backup/{object-key.txt, <basename>, restore-drill-result-pre-0056.json}  ->  restore-pass-pre-0056.json
import {createHash} from 'node:crypto';
import {closeSync,createReadStream,fchmodSync,lstatSync,openSync,readFileSync,rmSync,writeSync} from 'node:fs';
import {join} from 'node:path';
import {migrationPlan,migrationsDirectory} from '../packages/db/src/index';
import {assertKeyConsistent,parseObjectKey,plannedOutput} from './production-backup-object-get';
import {evidenceDirectory} from './production-backup-credential';
import {registryDigest} from './lib/registry-digest';
import {RESTORE_PASS_MAX_AGE_HOURS} from './production-restore-evidence';

export const PRE_0056_RESTORE_PASS_VERSION='production-restore-pass-pre-0056/1';
/** The database 0056 is installed on: migrations 0001-0055. */
export const PRE_0056_MIGRATIONS=55;
export const PRE_0056_DRILL_FILE='restore-drill-result-pre-0056.json';
export const PRE_0056_RECORD_FILE='restore-pass-pre-0056.json';
/** Added by 0054; a pre-0056 backup must contain it (current business integrity). */
export const RECEIPT_LEDGER='public.provisional_capacity_receipts';
const SHA256=/^[a-f0-9]{64}$/;
const fail=(code:string)=>new Error('RESTORE_EVIDENCE_'+code);
const RECORD_KEYS=['backupScheduledAt','ciphertextBytes','drillResultSha256','finalizedAt','finishedAt','migrations','objectKey','objectSha256','observedBackupAgeSeconds','plaintextSha256','restoreSeconds','result','version'];

export type Pre0056RestorePassRecord={version:typeof PRE_0056_RESTORE_PASS_VERSION;result:'PASS';objectKey:string;objectSha256:string;ciphertextBytes:number;plaintextSha256:string;
 migrations:typeof PRE_0056_MIGRATIONS;drillResultSha256:string;backupScheduledAt:string;restoreSeconds:number;observedBackupAgeSeconds:number;finishedAt:string;finalizedAt:string};
const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw fail('SHAPE_INVALID');return v as Record<string,unknown>;};
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const isoMs=(v:unknown)=>{const x=typeof v==='string'?Date.parse(v):NaN;if(!Number.isFinite(x)||new Date(x).toISOString()!==v)throw fail('SHAPE_INVALID');return x;};
const sha256File=(path:string)=>new Promise<string>((resolve,reject)=>{const h=createHash('sha256');const s=createReadStream(path);s.on('data',d=>h.update(d));s.on('error',()=>reject(fail('FILE_UNREADABLE')));s.on('end',()=>resolve(h.digest('hex')));});
const keyTimeIso=(key:string)=>{
 const m=/\/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.dump\.age$/.exec(key);
 if(!m)throw fail('KEY_INVALID');
 return `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
};
/** Digest over id:checksum of this checkout's migrations 0001-0055; refused unless 0056 is the next migration of the source plan. */
export function expectedPre0056RegistrySha256(){
 if(migrationPlan.length<=PRE_0056_MIGRATIONS||!migrationPlan[PRE_0056_MIGRATIONS]!.id.startsWith('0056'))throw fail('SOURCE_MIGRATIONS_UNREADABLE');
 try{return registryDigest(migrationPlan.slice(0,PRE_0056_MIGRATIONS).map(e=>({id:e.id,checksum:createHash('sha256').update(readFileSync(join(migrationsDirectory,e.file),'utf8')).digest('hex')})));}
 catch{throw fail('SOURCE_MIGRATIONS_UNREADABLE');}
}
function regularFile(path:string,maxBytes?:number){
 let stat;try{stat=lstatSync(path);}catch{throw fail('FILE_MISSING');}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||(maxBytes!==undefined&&stat.size>maxBytes)||(process.getuid&&stat.uid!==process.getuid()))throw fail('FILE_INVALID');
 return stat;
}

/** The drill result must be the PRODUCTION class result for this very object at the 0001-0055 registry, with the receipt ledger fingerprinted. */
export function validatePre0056DrillResult(raw:unknown,expect:{key:string;ciphertextBytes:number;ciphertextSha256:string}){
 const r=obj(raw);
 if(r.status!=='DRILL_PASS'||r.dataClass!=='PRODUCTION')throw fail('NOT_PRODUCTION_DRILL_PASS');
 if(r.key!==expect.key||r.backupScheduledAt!==keyTimeIso(expect.key))throw fail('KEY_MISMATCH');
 if(r.ciphertextBytes!==expect.ciphertextBytes)throw fail('CIPHERTEXT_MISMATCH');
 if(typeof r.ciphertextSha256!=='string'||!SHA256.test(r.ciphertextSha256))throw fail('SHAPE_INVALID');
 if(r.ciphertextSha256!==expect.ciphertextSha256)throw fail('CIPHERTEXT_MISMATCH');
 if(typeof r.plaintextSha256!=='string'||!SHA256.test(r.plaintextSha256))throw fail('SHAPE_INVALID');
 if(!finite(r.plaintextBytes)||!finite(r.restoreSeconds)||!finite(r.observedBackupAgeSeconds))throw fail('SHAPE_INVALID');
 const scheduled=isoMs(r.backupScheduledAt),started=isoMs(r.startedAt),finished=isoMs(r.finishedAt);
 if(started<scheduled||finished<started||Math.abs(finished-started-(r.restoreSeconds as number)*1000)>1||Math.abs(finished-scheduled-(r.observedBackupAgeSeconds as number)*1000)>1)throw fail('SHAPE_INVALID');
 if(typeof r.toolVersion!=='string'||!/^pg_restore \(PostgreSQL\) 18\./.test(r.toolVersion))throw fail('SHAPE_INVALID');
 if(r.productionRpoRtoApproved!==false)throw fail('SHAPE_INVALID');
 const v=obj(r.verification);
 if(v.migrations!==PRE_0056_MIGRATIONS)throw fail('MIGRATIONS_MISMATCH');
 if(typeof v.registrySha256!=='string'||!SHA256.test(v.registrySha256))throw fail('SHAPE_INVALID');
 if(v.registrySha256!==expectedPre0056RegistrySha256())throw fail('MIGRATIONS_MISMATCH');
 if(!Number.isInteger(v.foreignKeys)||(v.foreignKeys as number)<1||!Number.isInteger(v.sequences))throw fail('SHAPE_INVALID');
 const critical=obj(v.critical),tables=Object.keys(critical);
 if(!tables.includes(RECEIPT_LEDGER))throw fail('SHAPE_INVALID');
 for(const t of tables){const c=obj(critical[t]);if(!Number.isInteger(c.rows)||(c.rows as number)<0||typeof c.sha256!=='string'||!SHA256.test(c.sha256))throw fail('SHAPE_INVALID');}
 return {plaintextSha256:r.plaintextSha256 as string,backupScheduledAt:r.backupScheduledAt as string,restoreSeconds:r.restoreSeconds as number,observedBackupAgeSeconds:r.observedBackupAgeSeconds as number,finishedAt:r.finishedAt as string};
}

function derive(root:string){
 const dir=evidenceDirectory(root);
 regularFile(join(dir,'object-key.txt'),512);
 const key=parseObjectKey(readFileSync(join(dir,'object-key.txt'),'utf8'));assertKeyConsistent(key);
 const drillPath=join(dir,PRE_0056_DRILL_FILE);regularFile(drillPath,65536);
 const drillBytes=readFileSync(drillPath);
 let drill:unknown;try{drill=JSON.parse(drillBytes.toString('utf8'));}catch{throw fail('SHAPE_INVALID');}
 return {dir,key,drill,drillSha:createHash('sha256').update(drillBytes).digest('hex')};
}
function assertFresh(finishedAt:string,finalizedAt:string,nowMs:number){
 const finished=isoMs(finishedAt),finalized=isoMs(finalizedAt);
 if(finalized<finished||finalized-nowMs>60_000||finished-nowMs>60_000||nowMs-finished>RESTORE_PASS_MAX_AGE_HOURS*3_600_000)throw fail('STALE');
}

export async function finalizePre0056RestoreEvidence(root:string=process.cwd(),now:()=>Date=()=>new Date()):Promise<Pre0056RestorePassRecord>{
 const {dir,key,drill,drillSha}=derive(root);
 const cipher=plannedOutput(root,key),stat=regularFile(cipher),objectSha256=await sha256File(cipher);
 const summary=validatePre0056DrillResult(drill,{key,ciphertextBytes:stat.size,ciphertextSha256:objectSha256});
 const record:Pre0056RestorePassRecord={version:PRE_0056_RESTORE_PASS_VERSION,result:'PASS',objectKey:key,objectSha256,ciphertextBytes:stat.size,plaintextSha256:summary.plaintextSha256,
  migrations:PRE_0056_MIGRATIONS,drillResultSha256:drillSha,backupScheduledAt:summary.backupScheduledAt,restoreSeconds:summary.restoreSeconds,observedBackupAgeSeconds:summary.observedBackupAgeSeconds,
  finishedAt:summary.finishedAt,finalizedAt:now().toISOString()};
 assertFresh(record.finishedAt,record.finalizedAt,now().getTime());
 const path=join(dir,PRE_0056_RECORD_FILE);
 let fd:number;try{fd=openSync(path,'wx',0o600);}catch{throw fail('ALREADY_FINALIZED');}
 try{fchmodSync(fd,0o600);writeSync(fd,JSON.stringify(record)+'\n');}catch(e){try{closeSync(fd);}catch{/* ignore */}rmSync(path,{force:true});throw e;}
 closeSync(fd);
 return record;
}

/** Strict reader for the 0056 installer: re-verifies every binding and the freshness on each read. */
export async function verifyPre0056RestorePassRecord(root:string=process.cwd(),now:()=>Date=()=>new Date()):Promise<Pre0056RestorePassRecord>{
 const dir=evidenceDirectory(root);
 regularFile(join(dir,PRE_0056_RECORD_FILE),4096);
 let raw:unknown;try{raw=JSON.parse(readFileSync(join(dir,PRE_0056_RECORD_FILE),'utf8'));}catch{throw fail('SHAPE_INVALID');}
 const r=obj(raw);
 if(JSON.stringify(Object.keys(r).sort())!==JSON.stringify(RECORD_KEYS))throw fail('SHAPE_INVALID');
 if(r.version!==PRE_0056_RESTORE_PASS_VERSION||r.result!=='PASS'||r.migrations!==PRE_0056_MIGRATIONS)throw fail('SHAPE_INVALID');
 if(typeof r.objectKey!=='string')throw fail('SHAPE_INVALID');
 const key=parseObjectKey(r.objectKey);assertKeyConsistent(key);
 for(const f of ['objectSha256','plaintextSha256','drillResultSha256'])if(typeof r[f]!=='string'||!SHA256.test(r[f] as string))throw fail('SHAPE_INVALID');
 if(!Number.isInteger(r.ciphertextBytes)||(r.ciphertextBytes as number)<1||!finite(r.restoreSeconds)||!finite(r.observedBackupAgeSeconds))throw fail('SHAPE_INVALID');
 assertFresh(r.finishedAt as string,r.finalizedAt as string,now().getTime());
 const {drill,drillSha,key:currentKey}=derive(root);
 if(drillSha!==r.drillResultSha256||currentKey!==key)throw fail('BINDING_MISMATCH');
 const summary=validatePre0056DrillResult(drill,{key,ciphertextBytes:r.ciphertextBytes as number,ciphertextSha256:r.objectSha256 as string});
 if(summary.plaintextSha256!==r.plaintextSha256||summary.backupScheduledAt!==r.backupScheduledAt||summary.restoreSeconds!==r.restoreSeconds||summary.observedBackupAgeSeconds!==r.observedBackupAgeSeconds||summary.finishedAt!==r.finishedAt)throw fail('BINDING_MISMATCH');
 const cipher=plannedOutput(root,key);let present=true;try{lstatSync(cipher);}catch{present=false;}
 if(present){const stat=regularFile(cipher);if(stat.size!==r.ciphertextBytes||await sha256File(cipher)!==r.objectSha256)throw fail('BINDING_MISMATCH');}
 return r as unknown as Pre0056RestorePassRecord;
}

/** Installer gate: same safe error code as the frozen `requireRestorePass`. */
export async function requirePre0056RestorePass(root:string=process.cwd()){
 try{return await verifyPre0056RestorePassRecord(root);}
 catch(e){const m=String((e as Error)?.message??'');throw Object.assign(new Error('PRODUCTION_INSTALL_RESTORE_PASS_REQUIRED'),{reason:/^RESTORE_EVIDENCE_[A-Z_]{1,40}$/.test(m)?m:null});}
}

export async function main(argv:string[],root:string=process.cwd()){
 if(argv.length)throw fail('ARGUMENTS_REFUSED');
 const r=await finalizePre0056RestoreEvidence(root);
 console.log(JSON.stringify({version:r.version,state:'RESTORE_PASS_FINALIZED',objectKey:r.objectKey,migrations:r.migrations,ciphertextBytes:r.ciphertextBytes,restoreSeconds:r.restoreSeconds,observedBackupAgeSeconds:r.observedBackupAgeSeconds}));
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
 main(process.argv.slice(2)).catch(error=>{
  const m=String((error as Error)?.message??'');
  console.error(JSON.stringify({state:'FAILED',code:/^(RESTORE_EVIDENCE|BACKUP_OBJECT_GET)_[A-Z_]{1,40}$/.test(m)?m:'RESTORE_EVIDENCE_FAILED'}));
  process.exitCode=1;
 });
}
