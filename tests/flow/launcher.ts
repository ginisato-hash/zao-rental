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
export async function startFlowApp(options:{paymentFault?:'SAVE_THEN_LOSE';contentFixture?:boolean}={}){
 const db=await startIsolatedPostgres();let roles:Awaited<ReturnType<typeof provisionApplicationRoles>>|undefined;let flow:Awaited<ReturnType<typeof provisionFlowRole>>|undefined;
 let custody:Awaited<ReturnType<typeof provisionCustodyRole>>|undefined;
 try{
  await migrate(db.pool);await seed(db.pool,db.identity.namespace);await assertPortFree(db.identity.webPort);
  roles=await provisionApplicationRoles(db.pool,db.identity);flow=await provisionFlowRole(db.pool,db.identity);custody=await provisionCustodyRole(db.pool,db.identity);
  const origin=`http://127.0.0.1:${db.identity.webPort}`;
  const config:DevelopmentRuntime={origin,namespace:db.identity.namespace,authSecret:randomBytes(32).toString('hex'),authDb:roles.authDb,ledgerDb:roles.ledgerDb,holdDb:roles.holdDb,transferDb:roles.transferDb,pricingDb:roles.pricingDb,recommendationDb:roles.recommendationDb};
  const env:NodeJS.ProcessEnv={NODE_ENV:'development',PATH:process.env.PATH,NEXT_TELEMETRY_DISABLED:'1',ZAO_DEVELOPMENT_RUNTIME:JSON.stringify(config),ZAO_TEST_FLOW_RUNTIME:JSON.stringify(flow.flowDb),ZAO_TEST_CUSTODY_RUNTIME:JSON.stringify(custody.custodyDb),...(options.contentFixture?{ZAO_TEST_CONTENT_FIXTURE_ROOT:resolve('.local/content-fixtures')}:{ }),...(options.paymentFault?{ZAO_TEST_FLOW_FAULT:options.paymentFault}:{})};
  const args=['node_modules/next/dist/bin/next','dev','tests/flow-app','--webpack','--hostname','127.0.0.1','--port',String(db.identity.webPort)];
  function launch(){
   const web=spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe']});
   // Never persist raw auth/callback/cookie diagnostics.
   web.stdout.resume();web.stderr.on('data',chunk=>{for(const line of String(chunk).split('\n'))if(/^AUTH_PIPELINE_CODE [A-Z0-9_]{1,80}$/.test(line))console.error(line);});
   let exited=false;const exit=new Promise<number>(resolve=>{web.once('error',()=>{exited=true;resolve(1);});web.once('exit',code=>{exited=true;resolve(code??1);});});
   let closing:Promise<void>|undefined;
   return {pid:web.pid,exit,stop:()=>closing??=(async()=>{if(!exited){web.kill('SIGTERM');const timer=setTimeout(()=>web.kill('SIGKILL'),10000);try{await exit;}finally{clearTimeout(timer);}}})()};
  }
  let current=launch(),stopping:Promise<void>|undefined,restarting=false;
  const stop=()=>stopping??=(async()=>{try{await current.stop();}finally{try{await custody!.close();await flow!.close();await roles!.close();}finally{await db.stop();}}})();
  return {origin,db,roles,flow,custody,get exit(){return current.exit;},get webPid(){return current.pid;},stop,async restartWeb(){
   if(stopping||restarting)throw new Error('TEST_RESTART_NOT_ALLOWED');restarting=true;
   try{const old=current.pid;await current.stop();await assertPortFree(db.identity.webPort);current=launch();return {oldPid:old,newPid:current.pid};}finally{restarting=false;}
  }};
 }catch{await custody?.close();if(flow)await flow.close();if(roles)await roles.close();await db.stop();throw new Error('DEVELOPMENT_START_FAILED; authentication and database details withheld');}
}
