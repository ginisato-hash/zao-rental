import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {migrate,seed} from '@rental/db';
import {startIsolatedPostgres} from './postgres';
import {assertPortFree} from './worktree';
import {provisionOperationsRole} from './operations-roles';
import {provisionApplicationRoles} from './application-roles';
import type {DevelopmentRuntime} from '../packages/auth/src/config';
// Owned local resources only. The child receives app roles, never the migration connection.
export async function startDevelopmentApp(options:{built?:boolean;operations?:boolean}={}){
 const db=await startIsolatedPostgres();let operations:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined;let roles:Awaited<ReturnType<typeof provisionApplicationRoles>>|undefined;
 try{
  await migrate(db.pool);await seed(db.pool,db.identity.namespace);await assertPortFree(db.identity.webPort);
  roles=await provisionApplicationRoles(db.pool,db.identity);
  if(options.operations)operations=await provisionOperationsRole(db.pool,db.identity);
  const origin=`http://127.0.0.1:${db.identity.webPort}`;
  const config:DevelopmentRuntime={...(operations?{operationsDb:operations.operationsDb}:{}),origin,namespace:db.identity.namespace,authSecret:randomBytes(32).toString('hex'),authDb:roles.authDb,ledgerDb:roles.ledgerDb,holdDb:roles.holdDb,transferDb:roles.transferDb,pricingDb:roles.pricingDb,recommendationDb:roles.recommendationDb};
  const env:NodeJS.ProcessEnv={NODE_ENV:options.built?'production':'development',PATH:process.env.PATH,NEXT_TELEMETRY_DISABLED:'1',ZAO_DEVELOPMENT_RUNTIME:JSON.stringify(config)};
  const args=['node_modules/next/dist/bin/next',options.built?'start':'dev','apps/web',...(options.built?[]:['--webpack']),'--hostname','127.0.0.1','--port',String(db.identity.webPort)];
  const web=spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe']});
  // Next diagnostics may contain callback codes or cookies. Never persist/print raw streams.
  web.stdout.resume();web.stderr.on('data',chunk=>{for(const line of String(chunk).split('\n'))if(/^AUTH_PIPELINE_CODE [A-Z0-9_]{1,80}$/.test(line))console.error(line);});
  let exited=false;const exit=new Promise<number>(resolve=>{web.once('error',()=>{exited=true;resolve(1);});web.once('exit',code=>{exited=true;resolve(code??1);});});
  let stopping:Promise<void>|undefined;
  const stop=()=>stopping??=(async()=>{try{if(!exited){web.kill('SIGTERM');const timer=setTimeout(()=>web.kill('SIGKILL'),10000);try{await exit;}finally{clearTimeout(timer);}}}finally{try{await operations?.close();await roles!.close();}finally{await db.stop();}}})();
  return {origin,db,roles,operations,exit,stop};
 }catch{await operations?.close();if(roles)await roles.close();await db.stop();throw new Error('DEVELOPMENT_START_FAILED; authentication and database details withheld');}
}
