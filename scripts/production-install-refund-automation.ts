// Fixed Production installer for migration 0056 (Owner decision 2026-10-09, Issue 47): `migrate` applies 0056 once, `grants` applies its three
// EXECUTE grants once. Same admission as the normal-worker installer: exact accepted main (clean, HEAD == origin/main), no TLS override,
// a verified Production restore PASS record, then a memory-only owner session over verify-full TLS. Output is a sanitised status object.
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {neonCliPort} from './production-backup-credential';
import {applyProductionRefundAutomationMigration,applyProductionRefundAutomationGrants} from './production-refund-automation';
import {assertAcceptedMainRelease,assertNoTlsOverrides,openOwnerSession,requireRestorePass,type OwnerSession} from './lib/production-owner-session';

const COMMANDS=['migrate','grants'] as const;
type Command=typeof COMMANDS[number];
const NEON_BIN=join(homedir(),'.npm/_npx/978debf9b3a75271/node_modules/.bin/neon');
const SAFE_CODE=/^PRODUCTION_(INSTALL|REFUND_AUTOMATION|CREDENTIAL)_[A-Z0-9_]{1,80}$|^BACKUP_(CREDENTIAL|HOST|PORT)_[A-Z0-9_]{1,80}$/;

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
  const result=command==='migrate'?await applyProductionRefundAutomationMigration(session.client,'neondb','neondb_owner'):await applyProductionRefundAutomationGrants(session.client,'neondb','neondb_owner');
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
