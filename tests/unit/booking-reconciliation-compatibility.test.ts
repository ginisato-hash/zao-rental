import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Pool,PoolClient} from 'pg';
import {BookingService,type BookingRow} from '../../packages/core/src/payment/booking-service';
import {flowHash,type PaymentObservation,type FlowPermission} from '../../packages/contracts/src/rental-flow';
import {decidePaymentTruth,type PaymentContext} from '../../packages/core/src/payment/payment-truth';
const now=new Date('2035-01-01T00:00:00Z');
const expected={attemptId:'attempt-fixture',bookingId:'booking-fixture',idempotencyKey:'key-fixture',merchantId:'merchant-fixture',locationId:'location-fixture',amountJpy:100,currency:'JPY' as const};
const pending:PaymentObservation={providerId:'payment-fixture',referenceId:expected.bookingId,idempotencyKey:expected.idempotencyKey,merchantId:expected.merchantId,locationId:expected.locationId,amountJpy:100,currency:'JPY',status:'PENDING',updatedAt:now.toISOString(),completedAt:null};
/** Runs the unmodified BookingService method with scripted SQL only. Not DB/auth/inventory proof. */
class ScriptedBooking extends BookingService{
 calls:{sql:string;values:unknown[]}[]=[];events=new Map<string,{attempt_id:string;payload_sha256:string}>();
 constructor(private state:string,private providerState:string|null,private expired=false){super({} as Pool,{} as Pool,{subject:'fixture',sessionId:'fixture'});}
 protected override async transaction<T>(_permission:FlowPermission,_stores:string[],_preflight:(c:Pick<PoolClient,'query'>)=>Promise<void>,fn:(c:PoolClient,now:Date)=>Promise<T>):Promise<T>{
  const query=async(sql:string,values:unknown[]=[])=>{this.calls.push({sql,values});
   if(sql.includes('SELECT * FROM rental_payment_attempts'))return {rows:[{id:expected.attemptId,booking_id:expected.bookingId,idempotency_key:expected.idempotencyKey,merchant_id:expected.merchantId,location_id:expected.locationId,amount_jpy:'100',currency:'JPY',state:this.state,provider_id:pending.providerId,provider_state:this.providerState,provider_updated_at:null,completed_at:null}]};
   if(sql.includes('SELECT * FROM rental_provider_events'))return {rows:this.events.has(String(values[0]))?[this.events.get(String(values[0]))]:[]};
   if(sql.includes('SELECT * FROM inventory_holds'))return {rows:[{id:'hold-fixture',state:'ACTIVE',conditions:{},expires_at:new Date(now.getTime()+(this.expired?-1:600000)),due_at:new Date(now.getTime()+3600000),allocation_stage:'PROVISIONAL'}]};
   if(sql.includes('INSERT INTO rental_provider_events'))this.events.set(String(values[0]),{attempt_id:String(values[1]),payload_sha256:String(values[2])});return {rows:[]};
  };
  return fn({query} as unknown as PoolClient,now);
 }
 protected override async booking(){return {id:expected.bookingId,hold_id:'hold-fixture',confirmed_at:this.state==='COMPLETED'?now:null,conditions:{},price_snapshot:{advanceDiscountJpy:0},contact:{email:'synthetic-fixture@example.invalid'}} as unknown as BookingRow;}
 protected override async verifyClaims(){} // explicit fixture only; normal service code unchanged
 protected override async time(){return now;}
 outcome(){return this.calls.filter(c=>c.sql.includes('INSERT INTO rental_provider_events')).at(-1)?.values[3];}
}
const ctx=(state:PaymentContext['current']['state'],providerState:PaymentObservation['status']|null):PaymentContext=>({expected,current:{state,providerId:pending.providerId,providerState,providerUpdatedAt:null},latest:null});
test('unmodified BookingService: COMPLETED protects stock/booking from delayed PENDING/FAILED; engine does not apply either',async()=>{
 for(const status of ['PENDING','FAILED'] as const){const s=new ScriptedBooking('COMPLETED','COMPLETED'),o={...pending,status};await s.recordObservation(expected.bookingId,expected.attemptId,'event',o);assert.equal(s.outcome(),'STALE_OR_TERMINAL_IGNORED');assert.ok(!s.calls.some(c=>c.sql.startsWith('UPDATE')));assert.equal(decidePaymentTruth(ctx('COMPLETED','COMPLETED'),o.providerId,o,now).decision,'NOOP_TERMINAL');}
});
for(const status of ['FAILED','CANCELED'] as const)test('unmodified BookingService '+status+' contradictory completion goes to review; engine blocks',async()=>{
 const s=new ScriptedBooking('FAILED',status),o={...pending,status:'COMPLETED' as const,completedAt:now.toISOString()};await s.recordObservation(expected.bookingId,expected.attemptId,'event',o);assert.equal(s.outcome(),'CONTRADICTORY_TERMINAL_PAYMENT');assert.equal(decidePaymentTruth(ctx('FAILED',status),o.providerId,o,now).decision,'BLOCKED_INVALID_TRANSITION');assert.ok(!s.calls.some(c=>c.sql.includes("state='CONFIRMED_DEV'")));
});
test('ACCEPT_COMPLETED is not booking confirmation: unmodified BookingService still refuses expired HOLD',async()=>{
 const s=new ScriptedBooking('PENDING','PENDING',true),o={...pending,status:'COMPLETED' as const,completedAt:now.toISOString()};await s.recordObservation(expected.bookingId,expected.attemptId,'event',o);assert.equal(s.outcome(),'PAYMENT_SUCCESS_REQUIRES_INVENTORY_OR_PRICE_REVIEW');assert.ok(!s.calls.some(c=>c.sql.includes("state='CONFIRMED_DEV'")));assert.equal(decidePaymentTruth(ctx('PENDING','PENDING'),o.providerId,o,now).decision,'ACCEPT_COMPLETED');
});
test('unmodified BookingService valid PENDING->COMPLETED still confirms only through old inventory/price boundary',async()=>{
 const s=new ScriptedBooking('PENDING','PENDING'),o={...pending,status:'COMPLETED' as const,completedAt:now.toISOString()};await s.recordObservation(expected.bookingId,expected.attemptId,'event',o);assert.equal(s.outcome(),'CONFIRMED_DEV');assert.ok(s.calls.some(c=>c.sql.includes("payment_state='SUCCESS'")));assert.equal(flowHash(o),s.events.get('event')?.payload_sha256);
});
test('unmodified BookingService event replay and mismatched identity retain original safeguards',async()=>{
 const s=new ScriptedBooking('PENDING','PENDING');await s.recordObservation(expected.bookingId,expected.attemptId,'event',pending);const count=s.calls.filter(c=>c.sql.startsWith('UPDATE')).length;await s.recordObservation(expected.bookingId,expected.attemptId,'event',pending);assert.equal(s.calls.filter(c=>c.sql.startsWith('UPDATE')).length,count);await assert.rejects(s.recordObservation(expected.bookingId,expected.attemptId,'event',{...pending,amountJpy:1}),{code:'EVENT_ID_CONFLICT'});
 const bad=new ScriptedBooking('PENDING','PENDING');await bad.recordObservation(expected.bookingId,expected.attemptId,'bad',{...pending,merchantId:'wrong'});assert.equal(bad.outcome(),'MISMATCH');
});
