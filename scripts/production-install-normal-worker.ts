// Fixed Production installer for the normal worker (Issue 47): `migrate` applies 0054/0055 once, `grants` applies the four Owner-approved EXECUTE grants once.
// No arguments. Admission before any database connection: exact accepted main (clean checkout, HEAD == origin/main), no TLS override, a machine-derived Production restore
// PASS record (verified, not just shape-checked), then a memory-only owner session proven over verify-full TLS. Output is a sanitised status object; failures are fixed codes.
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {neonCliPort} from './production-backup-credential';
import {applyProductionNormalWorkerMigration} from './production-normal-worker-migration';
import {applyProductionNormalWorkerGrants} from './production-normal-worker-grants';
import {assertAcceptedMainRelease,assertNoTlsOverrides,openOwnerSession,requireRestorePass,type OwnerSession} from './lib/production-owner-session';

const COMMANDS=['migrate','grants'] as const;
type Command=typeof COMMANDS[number];
const NEON_BIN=join(homedir(),'.npm/_npx/978debf9b3a75271/node_modules/.bin/neon');
const SAFE_CODE=/^PRODUCTION_(INSTALL|NORMAL_WORKER|FIRST_ADMIN|STAFF_BOOTSTRAP|CREDENTIAL)_[A-Z0-9_]{1,80}$|^BACKUP_(CREDENTIAL|HOST|PORT)_[A-Z0-9_]{1,80}$/;

/** The two steps that reach outside the checkout: the git/origin release check and the Neon owner session. Tests substitute both to prove admission refuses before any Neon call. */
export type InstallSeams={release:()=>string;openSession:()=>Promise<OwnerSession>};
const productionSeams:InstallSeams={release:()=>assertAcceptedMainRelease(),openSession:async()=>{
 if(!existsSync(NEON_BIN))throw new Error('PRODUCTION_INSTALL_NEON_CLI_MISSING');
 return openOwnerSession(neonCliPort(NEON_BIN));
}};

export async function main(argv:string[],root:string=process.cwd(),seams:InstallSeams=productionSeams){
 const [command,...rest]=argv;
 if(rest.length||!COMMANDS.includes(command as Command))throw new Error('PRODUCTION_INSTALL_ARGUMENTS_REJECTED');
 assertNoTlsOverrides();
 const head=seams.release();
 await requireRestorePass(root);
 const session=await seams.openSession();
 try{
  const result=command==='migrate'?await applyProductionNormalWorkerMigration(session.client,'neondb','neondb_owner'):await applyProductionNormalWorkerGrants(session.client,'neondb','neondb_owner');
  console.log(JSON.stringify({sourceSha:head,command,...result}));
 }finally{await session.close();}
}

if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
 main(process.argv.slice(2)).catch(error=>{
  const message=String((error as Error)?.message??'');
  const reason=String((error as {reason?:unknown})?.reason??'');
  console.error(JSON.stringify({status:'STOP',code:SAFE_CODE.test(message)?message:'PRODUCTION_INSTALL_OPERATION_FAILED',reason:/^RESTORE_EVIDENCE_[A-Z_]{1,40}$/.test(reason)?reason:null}));
  process.exitCode=1;
 });
}
