import {test} from 'node:test';
import assert from 'node:assert/strict';
import {flowHash} from '../../packages/contracts/src/rental-flow';
import {decidePaymentProjection as decide,type ProjectionState} from '../../packages/core/src/payment/payment-projection';
import {productionPaymentActivationGrants} from '../../scripts/production-payment-roles';
import {clock,id,stateFixture,observation} from '../fixtures/payment-projection';
function expired(){
 const s=stateFixture();s.booking.mode='SQUARE_PRODUCTION';s.booking.priceSnapshot.chargeReady=true;
 s.booking.priceHash=flowHash(s.booking.priceSnapshot);s.quote!.snapshot=s.booking.priceSnapshot;s.quote!.snapshotHash=s.booking.priceHash;s.quote!.commercialPriceValid=true;
 s.attempt.providerId=null;s.attempt.state='UNKNOWN';s.hold!.expiresAt=clock.toISOString();return s;
}
for(const status of ['FAILED','CANCELED'] as const)for(const state of ['PAYMENT_PENDING','PAYMENT_REVIEW'])test('expired unbound '+status+' cancels '+state,()=>{
 const s=expired();s.booking.state=state;const before=structuredClone(s),plan=decide(s,observation(status),clock);
 assert.equal(plan.decision,status==='FAILED'?'APPLY_FAILED':'APPLY_CANCELED');assert.equal(plan.mutation,'FAILED_CANCELLED');assert.equal(plan.operatorActionRequired,false);assert.deepEqual(s,before);
});
for(const status of ['COMPLETED','PENDING'] as const)test('expired unbound '+status+' stays blocked',()=>{
 const plan=decide(expired(),observation(status),clock);assert.equal(plan.decision,'BLOCK_IDENTITY_MISMATCH');assert.equal(plan.mutation,'NONE');
});
for(const [name,change] of [
 ['active HOLD',(s:ProjectionState)=>{s.hold!.expiresAt=new Date(clock.getTime()+1).toISOString();}],
 ['wrong HOLD',(s:ProjectionState)=>{s.hold!.id=id(91);}],
 ['wrong HOLD owner',(s:ProjectionState)=>{s.hold!.ownerId='other';}],
 ['wrong reservation',(s:ProjectionState)=>{s.hold!.reservationId=id(91);}],
 ['confirmed HOLD',(s:ProjectionState)=>{s.hold!.confirmedAt=clock.toISOString();}],
 ['released HOLD',(s:ProjectionState)=>{s.hold!.state='RELEASED';}],
 ['fixed allocation',(s:ProjectionState)=>{s.hold!.allocationStage='PREPARATION_FIXED';}],
 ['invalid expiry',(s:ProjectionState)=>{s.hold!.expiresAt='invalid';}],
 ['Sandbox',(s:ProjectionState)=>{s.booking.mode='SQUARE_SANDBOX';}],
 ['completed attempt',(s:ProjectionState)=>{s.attempt.state='COMPLETED';}],
 ['prior completed truth',(s:ProjectionState)=>{s.attempt.providerState='COMPLETED';}],
 ['wrong actor',(s:ProjectionState)=>{s.attempt.actor='other';}],
 ['price hash',(s:ProjectionState)=>{s.booking.priceHash='f'.repeat(64);}],
 ['commercial approval',(s:ProjectionState)=>{s.quote!.commercialPriceValid=false;}],
 ['wrong quote',(s:ProjectionState)=>{s.quote!.holdId=id(91);}],
 ['coupon',(s:ProjectionState)=>{s.quote!.couponId=id(91);}],
] as const)test('expired failure rejects '+name,()=>{
 const s=expired();change(s);const plan=decide(s,observation('FAILED'),clock);assert.equal(plan.mutation,'NONE');assert.ok(plan.decision.startsWith('BLOCK_'));
});
test('expired failure requires full payment tuple; bound failure retains ordinary path',()=>{
 for(const patch of [{referenceId:id(91)},{idempotencyKey:id(91)},{merchantId:'other'},{locationId:'other'},{amountJpy:1}])assert.equal(decide(expired(),{...observation('FAILED'),...patch},clock).mutation,'NONE');
 const s=expired();s.attempt.providerId=observation().providerId;assert.equal(decide(s,observation('FAILED'),clock).mutation,'FAILED');
});
test('return due boundary alone qualifies an exact expired HOLD',()=>{
 const s=expired();s.hold!.expiresAt=new Date(Date.parse(s.hold!.dueAt)+1).toISOString();
 assert.equal(decide(s,observation('FAILED'),new Date(s.hold!.dueAt)).mutation,'FAILED_CANCELLED');
 assert.equal(decide(s,observation('FAILED'),new Date(Date.parse(s.hold!.dueAt)-1)).mutation,'NONE');
});
test('exactly one terminalization grant, no direct cancellation or generic Sandbox grants',()=>{
 const grants=productionPaymentActivationGrants('neondb');
 assert.deepEqual(grants.filter(g=>g.includes('terminalize_expired')),['GRANT EXECUTE ON FUNCTION payment_projection.terminalize_expired_unbound_failed_production(uuid,uuid,uuid,text,text,bigint,text) TO neondb_pay_projection']);
 assert.ok(!grants.some(g=>/^GRANT .*\bbooking_cancel\(|^GRANT .*\bbooking_cancellation_preview\(/.test(g)));
});
