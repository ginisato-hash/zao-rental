import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture,simulation} from './fixture';
import {writeAccount,listAccounts} from '../../packages/auth/src/accounts';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import type {PaymentGateway} from '../../packages/contracts/src/rental-flow';
const x=await flowFixture();let failed=false,stage='setup';
try{
 const d=await x.draft(undefined,undefined,{reason:'SYNTHETIC scope-revocation concurrency mechanics'});let entered!:()=>void,release!:()=>void;const waiting=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
 const adapter:PaymentGateway={kind:'SIMULATED_DEV',async create(){entered();await gate;throw new Error('SYNTHETIC_RESPONSE_LOST');},async lookup(){return null;}};
 const service=new BookingService(x.flow.flowPool,x.roles.authPool,x.signed.identity,adapter,simulation);
 const payment=service.startPayment(d.booking.id,randomUUID()).catch(e=>e);await waiting;
 const blocker=await x.db.pool.connect();let change:Promise<unknown>|undefined;
 async function blocked(user:string,query:string){for(let i=0;i<150;i++){if((await x.db.pool.query("SELECT 1 FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock' AND query LIKE $2",[user,query])).rowCount)return;await new Promise(r=>setTimeout(r,3));}throw new Error('EXPECTED_LOCK_WAIT_NOT_OBSERVED');}
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT revision FROM staff_members WHERE id=$1 FOR UPDATE',[x.actor]);
  const settings=(await listAccounts(x.roles.authPool,x.bp)).find(s=>s.id===x.actor)!;
  change=writeAccount(x.roles.authPool,x.bp,x.actor,{displayName:settings.displayName,active:true,role:settings.role,scope:'ASSIGNED',storeIds:['ONSEN_BASE'],permissions:settings.permissions,expectedRevision:settings.revision}).catch(e=>e);
  stage='administrator holds exclusive actor lock while waiting for target row';await blocked(x.roles.authDb.user,'SELECT revision FROM staff_members%');
  release();stage='UNKNOWN preflight passes then waits on real shared actor lock';await blocked(x.flow.flowDb.user,'SELECT pg_advisory_xact_lock_shared(71820901%');
 }finally{release();await blocker.query('COMMIT');blocker.release();}
 const changed=await change;assert.ok(changed&&!(changed instanceof Error));const result=await payment;assert.equal(result.code,'FORBIDDEN');assert.equal((await x.db.pool.query('SELECT payment_state FROM inventory_holds WHERE id=$1',[d.holdId])).rows[0].payment_state,'PENDING');assert.equal((await x.db.pool.query('SELECT state FROM rental_payment_attempts WHERE booking_id=$1',[d.booking.id])).rows[0].state,'SUBMITTING');
 console.log('PASS actual PostgreSQL interleaving: ordinary administrator write holds exclusive actor lock; UNKNOWN fallback waits after old preflight; fresh post-lock store check rejects mutation.');
}catch(e){failed=true;console.error('FLOW_SCOPE_RACE_FAILED '+stage+' '+(e as Error).name);if(e instanceof assert.AssertionError)console.error(JSON.stringify({actual:e.actual,expected:e.expected}));}finally{await x.close();console.log('Owned scope-race PostgreSQL stopped.');}if(failed)process.exit(1);
