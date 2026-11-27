// Entry point of the credential issuance: `npm run production:cutover-issue-credentials -- <neondb_v65|neondb_v65b>`.
// Prints only counts and key names; secret values never leave the library (see production-cutover-credentials.ts).
import {CUTOVER_TARGETS} from './production-cutover-bindings';
import {credentialSinks,issueCredentials,neonReadPort,safeCode,vercelWritePort} from './production-cutover-credentials';
import {assertAcceptedMainRelease,assertNoTlsOverrides} from './lib/production-owner-session';
import {productionPorts} from './production-cutover-run';

const [target,...rest]=process.argv.slice(2);
try{
 if(rest.length||!(CUTOVER_TARGETS as readonly string[]).includes(target??''))throw new Error('PRODUCTION_CUTOVER_CREDENTIALS_ARGUMENTS_REJECTED');
 assertNoTlsOverrides();
 const runner=productionPorts();
 const sinks=credentialSinks(target!);
 const result=await issueCredentials({
  neon:neonReadPort(target!),vercel:vercelWritePort(sinks),root:process.cwd(),now:()=>new Date(),release:()=>assertAcceptedMainRelease(),
  openOwner:async database=>{const h=await runner.openOwner(database);const c=await h.pool.connect();
   return {query:(sql:string,params?:unknown[])=>c.query(sql,params as never) as never,end:async()=>{c.release();await h.close();}};},
 },target!);
 console.log(JSON.stringify({status:'CUTOVER_CREDENTIALS_ISSUED',...result}));
}catch(e){
 console.error(JSON.stringify({status:'STOP',code:safeCode(e)}));
 process.exit(1);
}
