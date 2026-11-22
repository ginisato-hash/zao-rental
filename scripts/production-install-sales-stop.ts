// Fixed Production installer for the 0062 sales stop delta: `migrate` applies 0062 once (one transaction), `grants` adds the approved operations-role privileges once,
// `verify` only reads back the installed state in a READ ONLY transaction (no write; also the post-COMMIT-unknown and rollback check).
// No arguments. Admission before any database connection: exact accepted main (clean checkout, HEAD == origin/main), no TLS override, a machine-derived Production restore
// PASS record (verified, not just shape-checked), then a memory-only owner session proven over verify-full TLS. Output is a sanitised status object; failures are fixed codes.
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {neonCliPort} from './production-backup-credential';
import {applyProductionSalesStopMigration,applyProductionSalesStopGrants,verifyProductionSalesStop} from './production-sales-stop-delta';
import {assertAcceptedMainRelease,assertNoTlsOverrides,openOwnerSession,type OwnerSession} from './lib/production-owner-session';
import {requirePre0062RestorePass} from './production-restore-evidence-pre0062';

const COMMANDS=['migrate','grants','verify'] as const;
type Command=typeof COMMANDS[number];
const NEON_BIN=join(homedir(),'.npm/_npx/978debf9b3a75271/node_modules/.bin/neon');
const SAFE_CODE=/^PRODUCTION_(INSTALL|SALES_STOP|FIRST_ADMIN|STAFF_BOOTSTRAP|CREDENTIAL)_[A-Z0-9_]{1,80}$|^BACKUP_(CREDENTIAL|HOST|PORT)_[A-Z0-9_]{1,80}$/;

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
 // Both writing commands need a fresh restore proof of the database they run on, the 0001-0061 Production database
 // (scripts/production-restore-evidence-pre0062.ts). No older restore contract can stand in for it. `verify` writes nothing
 // (READ ONLY transaction), so it stays available after that proof expires, e.g. when deciding a rollback.
 if(command!=='verify')await requirePre0062RestorePass(root);
 const session=await seams.openSession();
 try{
  const result=command==='migrate'?await applyProductionSalesStopMigration(session.client,'neondb','neondb_owner'):command==='grants'?await applyProductionSalesStopGrants(session.client,'neondb','neondb_owner'):await verifyProductionSalesStop(session.client,'neondb','neondb_owner');
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
