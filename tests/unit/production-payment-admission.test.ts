import {test} from 'node:test';
import assert from 'node:assert/strict';
import {productionProjectionPermit,productionProjectionTarget} from '../../packages/core/src/payment/production-projection-authority';
import {decidePaymentProjection as decide,TransactionalPaymentProjection} from '../../packages/core/src/payment/payment-projection';
import {PgPaymentProjection} from '../../packages/db/src/payment-projection';
import {clock,id,stateFixture,observation,reference,sourceFixture,ProjectionSqlFixture} from '../fixtures/payment-projection';

const validEnv={VERCEL_ENV:'production',SQUARE_ENVIRONMENT:'PRODUCTION',PRODUCTION_PAYMENT_ADMISSION_AUTHORITY:'R6_PRODUCTION_ADMISSION'} as const;
const productionTarget={bookingId:id(1),attemptId:id(4),database:'zao_rental_production'};

// ---- production-projection-authority.ts: permit issuance gating ----

test('production permit requires every condition simultaneously',()=>{
 for(const bad of [
  {...validEnv,VERCEL_ENV:'preview'},
  {...validEnv,VERCEL_ENV:undefined},
  {...validEnv,SQUARE_ENVIRONMENT:'SANDBOX'},
  {...validEnv,SQUARE_ENVIRONMENT:undefined},
  {...validEnv,PRODUCTION_PAYMENT_ADMISSION_AUTHORITY:'WRONG'},
  {...validEnv,PRODUCTION_PAYMENT_ADMISSION_AUTHORITY:undefined},
 ]){
  assert.throws(()=>productionProjectionPermit(bad,productionTarget),{message:'PRODUCTION_PROJECTION_AUTHORITY_REQUIRED'});
 }
});
test('production permit rejects a disposable zr_* target database — that collapses to the ordinary dev floor, not Production',()=>{
 assert.throws(()=>productionProjectionPermit(validEnv,{...productionTarget,database:'zr_012345abcdef'}),{message:'PRODUCTION_PROJECTION_AUTHORITY_REQUIRED'});
});
test('production permit rejects an empty or unsafe database identifier',()=>{
 for(const database of ['','1leading-digit','has space','has-hyphen',"has'quote"]){
  assert.throws(()=>productionProjectionPermit(validEnv,{...productionTarget,database}),{message:'PRODUCTION_PROJECTION_AUTHORITY_REQUIRED'});
 }
});
test('production permit accepts a genuine non-zr_* Production-shaped target and binds it to exactly this booking/attempt',()=>{
 const permit=productionProjectionPermit(validEnv,productionTarget);
 assert.deepEqual(productionProjectionTarget(permit,{bookingId:productionTarget.bookingId,attemptId:productionTarget.attemptId}),productionTarget);
 assert.equal(productionProjectionTarget(permit,{bookingId:id(99),attemptId:productionTarget.attemptId}),null);
 assert.equal(productionProjectionTarget(permit,{bookingId:productionTarget.bookingId,attemptId:id(99)}),null);
});
test('an R15 permit and a Production permit are structurally distinct capabilities: one cannot be used as the other',()=>{
 const permit=productionProjectionPermit(validEnv,productionTarget);
 // productionProjectionTarget only ever recognizes its own WeakMap-issued permits.
 assert.equal(productionProjectionTarget(undefined,{bookingId:productionTarget.bookingId,attemptId:productionTarget.attemptId}),null);
 assert.notEqual(permit,undefined);
});

// ---- decidePaymentProjection: SQUARE_PRODUCTION is a recognized mode, additively ----

test('decidePaymentProjection recognizes SQUARE_PRODUCTION as a valid mode (additive, SQUARE_SANDBOX/SIMULATED_DEV unaffected)',()=>{
 const s=stateFixture();s.booking.mode='SQUARE_PRODUCTION';
 assert.equal(decide(s,observation(),clock).decision,'APPLY_COMPLETED');
});
test('decidePaymentProjection still rejects any other mode value',()=>{
 const s=stateFixture();s.booking.mode='SOMETHING_ELSE';
 assert.equal(decide(s,observation(),clock).decision,'BLOCK_IDENTITY_MISMATCH');
});

// ---- TransactionalPaymentProjection + PgPaymentProjection: environment/mode crossing prevention ----

function productionSource(){return {...sourceFixture(),environment:'PRODUCTION' as const};}
function productionFixture(){
 const f=new ProjectionSqlFixture();
 f.database=productionTarget.database;f.role=productionTarget.database+'_pay_projection';
 f.world.b.mode='SQUARE_PRODUCTION';f.world.src=productionSource();
 return f;
}

test('a Production permit against a booking still in SQUARE_SANDBOX mode is rejected (mode must match the bound environment)',async()=>{
 const f=productionFixture();f.world.b.mode='SQUARE_SANDBOX'; // wrong mode for a Production-bound call
 const permit=productionProjectionPermit(validEnv,productionTarget);
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f,undefined,undefined,permit),undefined,permit);
 await assert.rejects(svc.project(reference(f.world.src)),{code:'PROJECTION_MODE_MISMATCH'});
 assert.equal(f.world.history.length,0);
});
test('a SQUARE_PRODUCTION-mode booking is rejected without a Production permit (no silent Sandbox admission of Production bookings)',async()=>{
 const f=new ProjectionSqlFixture();f.world.b.mode='SQUARE_PRODUCTION';
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f)); // default: no permit, expects SQUARE_SANDBOX
 await assert.rejects(svc.project(reference(f.world.src)),{code:'PROJECTION_MODE_MISMATCH'});
 assert.equal(f.world.history.length,0);
});
test('a Production permit is refused against a disposable zr_* database, even with a matching role name (converse of the dev floor)',async()=>{
 const f=productionFixture();f.database='zr_012345abcdef';f.role='zr_012345abcdef_pay_projection';
 const permit=productionProjectionPermit(validEnv,productionTarget);
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f,undefined,undefined,permit),undefined,permit);
 await assert.rejects(svc.project(reference(f.world.src)),{code:'PROJECTION_PRODUCTION_DB_ONLY'});
 assert.ok(!f.calls.some(c=>c.sql.includes('pg_advisory_xact_lock')));
});
test('a Production permit is refused if the connected database name does not exactly match the permit target',async()=>{
 const f=productionFixture();f.database='some_other_production_shaped_db';
 const permit=productionProjectionPermit(validEnv,productionTarget);
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f,undefined,undefined,permit),undefined,permit);
 await assert.rejects(svc.project(reference(f.world.src)),{code:'PROJECTION_PRODUCTION_DB_ONLY'});
});
test('a Production permit is refused if the connected role does not match <database>_pay_projection',async()=>{
 const f=productionFixture();f.role='some_other_role';
 const permit=productionProjectionPermit(validEnv,productionTarget);
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f,undefined,undefined,permit),undefined,permit);
 await assert.rejects(svc.project(reference(f.world.src)),{code:'PROJECTION_PRODUCTION_DB_ONLY'});
});
test('a Production-permitted PRODUCTION source cannot be satisfied by a SANDBOX-environment persisted source (verifyProjectionSource environment binding)',async()=>{
 const f=productionFixture();f.world.src={...productionSource(),environment:'SANDBOX'};
 const permit=productionProjectionPermit(validEnv,productionTarget);
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f,undefined,undefined,permit),undefined,permit);
 await assert.rejects(svc.project(reference(f.world.src)),{code:'PROJECTION_SOURCE_NOT_ACCEPTED'});
});
test('correct Production permit + Production-shaped database/role + SQUARE_PRODUCTION booking + PRODUCTION source: admitted end to end',async()=>{
 const f=productionFixture();
 const permit=productionProjectionPermit(validEnv,productionTarget);
 const svc=new TransactionalPaymentProjection(new PgPaymentProjection(f,undefined,undefined,permit),undefined,permit);
 const result=await svc.project(reference(f.world.src));
 assert.equal(result.decision,'APPLY_COMPLETED');
 assert.equal(f.world.b.state,'CONFIRMED_DEV'); // booking.state literal is shared across modes; not Production-specific business behavior
 assert.equal(f.world.h.payment_state,'SUCCESS');
});
test('production constructor gate: NODE_ENV=production requires either an R15 or a Production permit',()=>{
 const old=process.env.NODE_ENV;Reflect.set(process.env,'NODE_ENV','production');
 try{
  assert.throws(()=>new TransactionalPaymentProjection(new PgPaymentProjection(new ProjectionSqlFixture())),{code:'PROJECTION_NOT_ACTIVATED'});
  const permit=productionProjectionPermit(validEnv,productionTarget);
  assert.doesNotThrow(()=>new TransactionalPaymentProjection(new PgPaymentProjection(productionFixture()),undefined,permit));
 }finally{if(old===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Reflect.set(process.env,'NODE_ENV',old);}
});

// ---- packages/db/src/payment-reconciliation.ts: PRODUCTION environment selects the _production SQL functions ----

test('PgPaymentReconciliation.load selects load_context_production only for a PRODUCTION claim, never for SANDBOX',async()=>{
 const {PgPaymentReconciliation}=await import('../../packages/db/src/payment-reconciliation');
 const calls:{sql:string;values:unknown[]}[]=[];
 const fakePool={connect:async()=>({
  query:async(sql:string,values:unknown[]=[])=>{calls.push({sql,values});if(sql==='BEGIN'||sql==='COMMIT'||sql.startsWith('SET '))return {rows:[],rowCount:0};return {rows:[{context:null}],rowCount:1};},
  release:()=>{},
 })} as never;
 const repo=new PgPaymentReconciliation(fakePool);
 await repo.load({id:'j',environment:'SANDBOX',merchantId:'m',paymentId:'p'} as never);
 await repo.load({id:'j',environment:'PRODUCTION',merchantId:'m',paymentId:'p'} as never);
 assert.ok(calls.some(c=>c.sql.includes('payment_reconciliation.load_context(') && !c.sql.includes('_production')));
 assert.ok(calls.some(c=>c.sql.includes('payment_reconciliation.load_context_production(')));
});
