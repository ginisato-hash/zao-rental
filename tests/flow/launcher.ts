import {readdir} from 'node:fs/promises';
/** Reachable routes of the fixture app, derived from the app directory so the list cannot
 * drift. A required dynamic segment is skipped; an optional catch-all is reached at its own
 * base path, which is enough to compile the module. */
async function fixtureRoutes(directory='tests/flow-app/src/app',prefix=''):Promise<{path:string;api:boolean}[]>{
 const routes:{path:string;api:boolean}[]=[];
 for(const entry of await readdir(directory,{withFileTypes:true})){
  if(entry.isDirectory()){
   if(entry.name==='.next')continue;
   // An optional catch-all also matches the path without it; anything else cannot be reached
   // without inventing a value, so it is left to compile on its own first use.
   if(entry.name.startsWith('[')&&!/^\[\[\.\.\..+\]\]$/.test(entry.name))continue;
   const segment=entry.name.startsWith('[')?'':'/'+entry.name;
   routes.push(...await fixtureRoutes(directory+'/'+entry.name,prefix+segment));
  }else if(entry.name==='page.tsx')routes.push({path:prefix||'/',api:false});
  else if(entry.name==='route.ts')routes.push({path:prefix||'/',api:true});
 }
 return routes;
}
/** Compile every reachable route before the browser opens. Page routes are fetched; API
 * routes are probed with HEAD so no GET handler runs, because only the compilation matters. */
async function warmPageRoutes(origin:string){
 let routes:{path:string;api:boolean}[]=[];
 try{routes=await fixtureRoutes();}catch{return;}
 const unique=[...new Map(routes.map(r=>[r.path+':'+r.api,r])).values()];
 for(let i=0;i<unique.length;i+=4)
  await Promise.all(unique.slice(i,i+4).map(r=>fetch(origin+r.path,{method:r.api?'HEAD':'GET',redirect:'manual'}).catch(()=>undefined)));
}
import {provisionAvatarReadRole} from '../../scripts/avatar-read-role';
import {deriveBookingAccessKeys} from '../../packages/core/src/guest/booking-access-keys';
import {BookingRecovery,type RecoveryMessage} from '../../packages/core/src/guest/booking-recovery';
import {GuestContexts} from '../../packages/core/src/guest/context';
import {provisionBookingAccessRole} from '../../scripts/booking-access-role';
import {webDiagnosticForwarder} from './web-diagnostics';
import {provisionGuestRole} from '../../scripts/guest-roles';
import {provisionContentRole} from '../../scripts/content-roles';
import {provisionCustodyRole} from '../../scripts/custody-roles';
import {provisionFlowRole} from '../../scripts/flow-roles';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {migrate,seed} from '../../packages/db/src/index';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {assertPortFree} from '../../scripts/worktree';
import {provisionApplicationRoles} from '../../scripts/application-roles';
import type {DevelopmentRuntime} from '../../packages/auth/src/config';
// Owned local resources only. The child receives app roles, never the migration connection.
export async function startFlowApp(options:{paymentFault?:'SAVE_THEN_LOSE';contentFixture?:boolean;publicP0?:boolean;publicP1?:boolean;publicP4?:boolean;publicP5?:boolean;avatarPhase5?:boolean;warmRoutes?:boolean}={}){
 let avatar:Awaited<ReturnType<typeof provisionAvatarReadRole>>|undefined;
 let access:Awaited<ReturnType<typeof provisionBookingAccessRole>>|undefined;
 const db=await startIsolatedPostgres();let roles:Awaited<ReturnType<typeof provisionApplicationRoles>>|undefined;let flow:Awaited<ReturnType<typeof provisionFlowRole>>|undefined;
 let guest:Awaited<ReturnType<typeof provisionGuestRole>>|undefined,content:Awaited<ReturnType<typeof provisionContentRole>>|undefined;
 let custody:Awaited<ReturnType<typeof provisionCustodyRole>>|undefined;
 let startupPhase='MIGRATE';
 try{
  await migrate(db.pool);startupPhase='SEED';await seed(db.pool,db.identity.namespace);startupPhase='PORT';await assertPortFree(db.identity.webPort);
  startupPhase='ROLES';
  roles=await provisionApplicationRoles(db.pool,db.identity);flow=await provisionFlowRole(db.pool,db.identity);custody=await provisionCustodyRole(db.pool,db.identity);
  if(options.publicP0){guest=await provisionGuestRole(db.pool,db.identity);content=await provisionContentRole(db.pool,db.identity);}
  if(options.avatarPhase5)avatar=await provisionAvatarReadRole(db.pool,db.identity);
  if(options.publicP4)access=await provisionBookingAccessRole(db.pool,db.identity);
  startupPhase='WEB';
  const origin=`http://127.0.0.1:${db.identity.webPort}`;
  const config:DevelopmentRuntime={origin,namespace:db.identity.namespace,authSecret:randomBytes(32).toString('hex'),authDb:roles.authDb,ledgerDb:roles.ledgerDb,holdDb:roles.holdDb,transferDb:roles.transferDb,pricingDb:roles.pricingDb,recommendationDb:roles.recommendationDb};
  // In-memory delivery capture exists only in the parent test harness. No HTTP
  // mailbox, environment flag, raw secret file or production route can expose it.
  const captured:RecoveryMessage[]=[];
  const recoveryFixture=options.publicP5&&access&&guest?{
   async enroll(guestToken:string,bookingId:string,requestId:string){
    const service=new BookingRecovery(access!.accessPool,deriveBookingAccessKeys(config.authSecret).recoveryKey,'development-recovery-v1',{
     async deliver(message){captured.push(message);return {messageId:message.messageId,state:'DELIVERED'};},
     async lookup(messageId){return {messageId,state:captured.some(m=>m.messageId===messageId)?'DELIVERED':'UNKNOWN'};}
    });
    return service.prepare(await new GuestContexts(guest!.guestPool).resolve(guestToken),bookingId,requestId);
   },code(){if(captured.length!==1)throw new Error('SYNTHETIC_MAIL_COUNT');return captured[0]!.code;}
  }:undefined;
  const env:NodeJS.ProcessEnv={...(avatar?{ZAO_AVATAR_READ_RUNTIME:JSON.stringify(avatar.avatarDb)}:{}),...(access?{ZAO_BOOKING_ACCESS_RUNTIME:JSON.stringify(access.accessDb)}:{}),...(guest&&content?{ZAO_GUEST_RUNTIME:JSON.stringify(guest.guestDb),ZAO_CONTENT_READ_RUNTIME:JSON.stringify(content.contentReadDb),ZAO_CONTENT_RUNTIME:JSON.stringify(content.contentDb),ZAO_PUBLIC_ORIGIN:origin,ZAO_TEST_PUBLIC_INDEXING:'1'}:{}),...(options.publicP1?{ZAO_TEST_PUBLIC_P1:'1'}:{}),NODE_ENV:'development',PATH:process.env.PATH,NEXT_TELEMETRY_DISABLED:'1',ZAO_DEVELOPMENT_RUNTIME:JSON.stringify(config),ZAO_TEST_FLOW_RUNTIME:JSON.stringify(flow.flowDb),ZAO_TEST_CUSTODY_RUNTIME:JSON.stringify(custody.custodyDb),...(options.contentFixture?{ZAO_TEST_CONTENT_FIXTURE_ROOT:resolve('.local/content-fixtures')}:{ }),...(options.paymentFault?{ZAO_TEST_FLOW_FAULT:options.paymentFault}:{})};
  const args=['node_modules/next/dist/bin/next','dev','tests/flow-app','--webpack','--hostname','127.0.0.1','--port',String(db.identity.webPort)];
  function launch(){
   const web=spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe']});
   // Never persist raw auth/callback/cookie diagnostics.
   const diagnostics=webDiagnosticForwarder(line=>console.error(line));web.stdout.resume();web.stderr.on('data',chunk=>diagnostics.push(chunk));web.stderr.on('end',()=>diagnostics.end());
   let exited=false,stopRequested=false;const exit=new Promise<number>(resolve=>{web.once('error',()=>{exited=true;resolve(1);});web.once('exit',(code,signal)=>{exited=true;if(!stopRequested)console.error(JSON.stringify({code:'TEST_WEB_UNEXPECTED_EXIT',exitCode:Number.isInteger(code)?code:null,signal:signal==='SIGKILL'||signal==='SIGTERM'||signal==='SIGABRT'?signal:'OTHER'}));resolve(code??1);});});
   let closing:Promise<void>|undefined;
   return {pid:web.pid,exit,stop:()=>closing??=(async()=>{if(!exited){stopRequested=true;web.kill('SIGTERM');const timer=setTimeout(()=>web.kill('SIGKILL'),10000);try{await exit;}finally{clearTimeout(timer);}}})()};
  }
  let current=launch(),stopping:Promise<void>|undefined,restarting=false;
  const stop=()=>stopping??=(async()=>{try{await current.stop();}finally{try{await avatar?.close();await access?.close();await guest?.close();await content?.close();await custody!.close();await flow!.close();await roles!.close();}finally{await db.stop();}}})();
  if(options.publicP0){
   // Next dev cold route compilation can reconnect HMR and reload an active form.
   // Compile this catch-all before opening a browser; this anonymous read must stay401.
   try{let ready=false;for(let n=0;n<100;n++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}if(!ready)throw new Error('TEST_APP_START_TIMEOUT');
    const rejected=await fetch(origin+'/api/custody/booking/00000000-0000-4000-8000-000000000000');if(rejected.status!==401)throw new Error('TEST_ANONYMOUS_CUSTODY_NOT_REJECTED');
    // Every route compiles on its first request too, so a test's opening navigation can
    // otherwise spend its whole timeout waiting for webpack. Suites that navigate straight
    // into a page opt in; warming is not automatic because the requests are real requests and
    // would consume guest budget in suites that measure it.
    if(options.warmRoutes)await warmPageRoutes(origin);
   }catch(e){await stop();throw e;}
  }
  return {origin,db,roles,flow,custody,guest,content,avatar,recoveryFixture,get exit(){return current.exit;},get webPid(){return current.pid;},stop,async restartWeb(){
   if(stopping||restarting)throw new Error('TEST_RESTART_NOT_ALLOWED');restarting=true;
   try{const old=current.pid;await current.stop();await assertPortFree(db.identity.webPort);current=launch();return {oldPid:old,newPid:current.pid};}finally{restarting=false;}
  }};
 }catch(error){const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';console.error(JSON.stringify({code:'TEST_APP_START_FAILED',phase:startupPhase,category:/^(23505|23503|23514|40001|40P01|53300|57014|08003|08006|57P01|EADDRINUSE)$/.test(code)?code:'OTHER'}));await avatar?.close();await access?.close();await guest?.close();await content?.close();await custody?.close();if(flow)await flow.close();if(roles)await roles.close();await db.stop();throw new Error('DEVELOPMENT_START_FAILED; authentication and database details withheld');}
}
