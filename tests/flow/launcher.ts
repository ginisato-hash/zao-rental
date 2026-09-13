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
export async function startFlowApp(options:{paymentFault?:'SAVE_THEN_LOSE';contentFixture?:boolean;publicP0?:boolean;publicP1?:boolean;publicP4?:boolean}={}){
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
  if(options.publicP4)access=await provisionBookingAccessRole(db.pool,db.identity);
  startupPhase='WEB';
  const origin=`http://127.0.0.1:${db.identity.webPort}`;
  const config:DevelopmentRuntime={origin,namespace:db.identity.namespace,authSecret:randomBytes(32).toString('hex'),authDb:roles.authDb,ledgerDb:roles.ledgerDb,holdDb:roles.holdDb,transferDb:roles.transferDb,pricingDb:roles.pricingDb,recommendationDb:roles.recommendationDb};
  const env:NodeJS.ProcessEnv={...(access?{ZAO_BOOKING_ACCESS_RUNTIME:JSON.stringify(access.accessDb)}:{}),...(guest&&content?{ZAO_GUEST_RUNTIME:JSON.stringify(guest.guestDb),ZAO_CONTENT_READ_RUNTIME:JSON.stringify(content.contentReadDb),ZAO_CONTENT_RUNTIME:JSON.stringify(content.contentDb),ZAO_PUBLIC_ORIGIN:origin,ZAO_TEST_PUBLIC_INDEXING:'1'}:{}),...(options.publicP1?{ZAO_TEST_PUBLIC_P1:'1'}:{}),NODE_ENV:'development',PATH:process.env.PATH,NEXT_TELEMETRY_DISABLED:'1',ZAO_DEVELOPMENT_RUNTIME:JSON.stringify(config),ZAO_TEST_FLOW_RUNTIME:JSON.stringify(flow.flowDb),ZAO_TEST_CUSTODY_RUNTIME:JSON.stringify(custody.custodyDb),...(options.contentFixture?{ZAO_TEST_CONTENT_FIXTURE_ROOT:resolve('.local/content-fixtures')}:{ }),...(options.paymentFault?{ZAO_TEST_FLOW_FAULT:options.paymentFault}:{})};
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
  const stop=()=>stopping??=(async()=>{try{await current.stop();}finally{try{await access?.close();await guest?.close();await content?.close();await custody!.close();await flow!.close();await roles!.close();}finally{await db.stop();}}})();
  if(options.publicP0){
   // Next dev cold route compilation can reconnect HMR and reload an active form.
   // Compile this catch-all before opening a browser; this anonymous read must stay401.
   try{let ready=false;for(let n=0;n<100;n++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}if(!ready)throw new Error('TEST_APP_START_TIMEOUT');
    const rejected=await fetch(origin+'/api/custody/booking/00000000-0000-4000-8000-000000000000');if(rejected.status!==401)throw new Error('TEST_ANONYMOUS_CUSTODY_NOT_REJECTED');
   }catch(e){await stop();throw e;}
  }
  return {origin,db,roles,flow,custody,guest,content,get exit(){return current.exit;},get webPid(){return current.pid;},stop,async restartWeb(){
   if(stopping||restarting)throw new Error('TEST_RESTART_NOT_ALLOWED');restarting=true;
   try{const old=current.pid;await current.stop();await assertPortFree(db.identity.webPort);current=launch();return {oldPid:old,newPid:current.pid};}finally{restarting=false;}
  }};
 }catch(error){const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';console.error(JSON.stringify({code:'TEST_APP_START_FAILED',phase:startupPhase,category:/^(23505|23503|23514|40001|40P01|53300|57014|08003|08006|57P01|EADDRINUSE)$/.test(code)?code:'OTHER'}));await access?.close();await guest?.close();await content?.close();await custody?.close();if(flow)await flow.close();if(roles)await roles.close();await db.stop();throw new Error('DEVELOPMENT_START_FAILED; authentication and database details withheld');}
}
