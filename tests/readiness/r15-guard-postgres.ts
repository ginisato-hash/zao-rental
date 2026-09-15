import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {migrate} from '../../packages/db/src/index';
import {provisionPaymentActivationRoles} from '../../scripts/payment-activation-roles';
import {dispatchR15Once,type R15Operation} from '../../packages/db/src/r15-operation-guard';
import type {InboxPool,InboxConnection} from '../../packages/db/src/square-webhook-inbox';
import {seed} from './r14-postgres';
import {id} from '../fixtures/payment-projection';
if(process.env.NODE_ENV==='production')throw Error('LOCAL_TEST_ONLY');
const out='.local/r15-guard';await mkdir(out,{recursive:true});
const db=await startIsolatedPostgres();let roles:Awaited<ReturnType<typeof provisionPaymentActivationRoles>>|undefined;
const results:{name:string;result:string}[]=[];
const op:R15Operation={manifestSha256:'a'.repeat(64),action:'CREATE_PAYMENT',bookingId:id(1),attemptId:id(4),idempotencyKey:id(5),locationId:'fixture-location',paymentId:null};
async function check(name:string,f:()=>Promise<void>){try{await f();results.push({name,result:'PASS'});console.log('PASS '+name);}catch(e){results.push({name,result:'FAIL'});throw e;}}
let validationFailed=false;
try{
 await migrate(db.pool);await seed(db.pool,'MLKDVEDH1ME21',null);roles=await provisionPaymentActivationRoles(db.pool,db.identity);const p=roles.pools.worker;
 await check('unregistered manifest stops before dispatch',async()=>{let calls=0;await assert.rejects(dispatchR15Once(p,op,async()=>calls++));assert.equal(calls,0);});
 await db.pool.query("INSERT INTO r15_activation.manifest VALUES(true,$1,'store_i5vh0ZEKo2ikcVo9',$2,$3,$4,$5,'MLKDVEDH1ME21','fixture-location','SANDBOX',100,'JPY')",[op.manifestSha256,db.identity.database,op.bookingId,op.attemptId,op.idempotencyKey]);
 await check('wrong manifest or target and public role are refused before dispatch',async()=>{let calls=0;
  for(const changed of [{manifestSha256:'b'.repeat(64)},{bookingId:id(99)},{idempotencyKey:id(98)},{locationId:'wrong'}])await assert.rejects(dispatchR15Once(p,{...op,...changed},async()=>calls++));
  await assert.rejects(dispatchR15Once(roles!.pools.publicProbe,op,async()=>calls++));assert.equal(calls,0);
 });
 await check('two concurrent CREATE reservations allow exactly one synthetic dispatch; lost result never resets',async()=>{let calls=0;const send=async()=>{calls++;throw Error('SYNTHETIC_RESPONSE_LOSS');};
  await Promise.allSettled([dispatchR15Once(p,op,send),dispatchR15Once(p,op,send)]);assert.equal(calls,1);
  await assert.rejects(dispatchR15Once(p,{...op},send));assert.equal(calls,1);
 });
 await check('runtime cannot read or rewrite manifest/operations and cannot grant itself reset',async()=>{
  for(const pool of Object.values(roles!.pools))for(const sql of ['SELECT * FROM r15_activation.manifest','DELETE FROM r15_activation.operations','TRUNCATE r15_activation.operations',"UPDATE r15_activation.manifest SET manifest_sha256=repeat('b',64)","INSERT INTO r15_activation.operations(action,manifest_sha256) VALUES('GET_PAYMENT','x')"])
   await assert.rejects(pool.query(sql),{code:'42501'});
 });
 // Test-owner fixture setup only in this freshly owned loopback cluster. Never a runtime reset API.
 const c=await db.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor','synthetic-actor',true)");await c.query("UPDATE rental_payment_attempts SET provider_id='fixture-payment',state='PENDING' WHERE id=$1",[op.attemptId]);await c.query('COMMIT');}finally{c.release();}
 const get={...op,action:'GET_PAYMENT' as const,paymentId:'fixture-payment'};
 await check('GET uncertain COMMIT blocks send and a new connection cannot repeat',async()=>{let calls=0;const lost:InboxPool={async connect(){const x=await p.connect();return {release:(bad?:boolean)=>x.release(bad),async query(sql:string,v?:unknown[]){const r=await x.query(sql,v);if(sql==='COMMIT')throw Error('SYNTHETIC_COMMIT_LOSS');return r;}} as InboxConnection;}};
  await assert.rejects(dispatchR15Once(lost,get,async()=>calls++));await assert.rejects(dispatchR15Once(p,get,async()=>calls++));assert.equal(calls,0);
 });
 await check('test-only reset then child crash after durable reservation blocks reconstructed process',async()=>{
  await db.pool.query("DELETE FROM r15_activation.operations WHERE action='GET_PAYMENT'");
  const child=async(crash:boolean)=>{const child=fork(fileURLToPath(new URL('./r15-guard-child.ts',import.meta.url)),[],{execArgv:['--import','tsx'],env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'test'},stdio:['ignore','ignore','ignore','ipc']});
   const done=new Promise<number|null>(r=>child.once('exit',r)),timer=setTimeout(()=>child.kill('SIGKILL'),10000);
   child.send({config:{host:'127.0.0.1',port:p.options.port,database:p.options.database,user:p.options.user,password:p.options.password,max:1},op:get,crash});
   try{return await done;}finally{clearTimeout(timer);}
  };
  assert.equal(await child(true),23);assert.equal(await child(false),22);
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM r15_activation.operations WHERE action='GET_PAYMENT'")).rows[0].n,1);
 });
 await check('guard SECURITY DEFINER has fixed search path and PUBLIC no execution grant',async()=>{
  const row=(await db.pool.query("SELECT p.prosecdef,p.proconfig,has_function_privilege($1,p.oid,'EXECUTE') allowed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='r15_activation' AND p.proname='reserve'",[roles!.names.publicProbe])).rows[0];assert.equal(row.prosecdef,true);assert.ok(row.proconfig.includes('search_path=pg_catalog, pg_temp'));assert.equal(row.allowed,false);
 });
}catch(e){console.error('R15_GUARD_LOCAL_TEST_FAILED',{code:(e as {code?:string}).code??'TEST_FAILURE',line:(e as Error).stack?.split('\n').find(s=>s.includes('r15-guard-postgres'))});validationFailed=true;}
finally{await roles?.close();await db.stop();await writeFile(out+'/results.json',JSON.stringify({kind:'LOCAL_REAL_POSTGRESQL_NOT_HOSTED',actualExternalRequests:0,results,ownedDatabaseStopped:true},null,2));}

// All owned resources are already closed. async-exit-hook beforeExit forces 0,
// so a failed finite test must exit explicitly after cleanup.
if(validationFailed)process.exit(1);
