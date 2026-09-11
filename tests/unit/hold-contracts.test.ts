import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePeriod,parseConditions,paymentDecision,transferDecision} from '../../packages/contracts/src/hold';
import {matchPeriods} from '../../packages/core/src/inventory/period-matching';
import {requestFor} from '../inventory/fixture';
test('Tokyo golden AM/PM, whole-date occupancy, month/year boundaries and inclusive ten days',()=>{
 const am=normalizePeriod({startDate:'2030-12-31',endDate:'2030-12-31',slot:'AM'}),pm=normalizePeriod({startDate:'2030-12-31',endDate:'2030-12-31',slot:'PM'});
 assert.equal(am.startsAt,'2030-12-30T23:30:00.000Z');assert.equal(am.dueAt,'2030-12-31T03:00:00.000Z');assert.equal(pm.startsAt,'2030-12-31T04:00:00.000Z');assert.equal(pm.dueAt,'2030-12-31T08:00:00.000Z');assert.equal(am.occupancyStartsAt,'2030-12-30T15:00:00.000Z');assert.equal(am.occupancyEndsAt,pm.occupancyEndsAt);assert.equal(am.occupancyEndsAt,'2030-12-31T15:00:00.000Z');
 assert.deepEqual(normalizePeriod({startDate:'2030-12-28',endDate:'2031-01-06',slot:'MULTIDAY'}).dates,['2030-12-28','2030-12-29','2030-12-30','2030-12-31','2031-01-01','2031-01-02','2031-01-03','2031-01-04','2031-01-05','2031-01-06']);
 assert.equal(normalizePeriod({startDate:'2028-02-29',endDate:'2028-03-01',slot:'MULTIDAY'}).days,2);
 for(const period of [{startDate:'2030-02-29',endDate:'2030-02-29',slot:'DAY'},{startDate:'2030-01-01',endDate:'2030-01-11',slot:'MULTIDAY'},{startDate:'2030-01-02',endDate:'2030-01-01',slot:'DAY'}])assert.throws(()=>normalizePeriod(period as never));
 const previous=process.env.TZ;try{for(const tz of ['Pacific/Honolulu','Europe/London','Asia/Tokyo']){process.env.TZ=tz;assert.equal(normalizePeriod({startDate:'2030-12-31',endDate:'2030-12-31',slot:'AM'}).startsAt,am.startsAt);}}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
test('bundle completeness, forbidden client expiry/identity, unique group member and variant candidates',()=>{
 const input=requestFor('2030-01-01');assert.ok(parseConditions(input));assert.throws(()=>parseConditions({...input,expiresAt:'2099-01-01'}));assert.throws(()=>parseConditions({...input,owner_id:'spoof'}));assert.throws(()=>parseConditions({...input,members:[{...input.members[0],product:'SKI_SET'}]}));assert.throws(()=>parseConditions({...input,members:[input.members[0],input.members[0]]}));
});
test('period solver finds flexible A155 constrained B150; bounded exhaustion is indeterminate',()=>{const d=[{key:'a',start:'2030-01-01',end:'2030-01-01',candidates:['150','155']},{key:'b',start:'2030-01-01',end:'2030-01-01',candidates:['150']}],cap=new Map([['150',1],['155',1]]);const result=matchPeriods(d,cap,[])!;assert.equal(result.find(x=>x.key==='a')!.unit,'155');assert.equal(result.find(x=>x.key==='b')!.unit,'150');assert.equal(matchPeriods(d.map(x=>({...x,candidates:['150']})),cap,[]),null);assert.throws(()=>matchPeriods(d,cap,[],0),/INDETERMINATE/);});
test('payment contract never converts UNKNOWN to failure or late success to inventory confirmation',()=>{
 for(const state of ['PENDING','UNKNOWN'] as const)for(const expired of [true,false])assert.equal(paymentDecision(state,true,expired,false),'RECONCILIATION_REQUIRED');
 assert.equal(paymentDecision('SUCCESS',false,true,false),'INVENTORY_REACQUIRE_REQUIRED');assert.equal(paymentDecision('SUCCESS',false,true,true),'INVENTORY_ONLY_VALID_PAYMENT_VERIFICATION_REQUIRED');assert.equal(paymentDecision('NONE',true,true,false),'MAY_EXPIRE');
});
test('E07 contract: 17:00 schedule is no receipt; sealed/departed additions denied; protected receipt still needs E07',()=>{
 const base={batchId:'synthetic-batch',scheduledAt:'2030-01-01T17:00:00+09:00',state:'COMMITTED' as const,actualReceivedAt:null,inspectionReady:false,protectedAllocation:true};assert.equal(transferDecision(base),'TRANSFER_PLAN_REQUIRED');assert.equal(transferDecision({...base,state:'DEPARTED'},true),'BATCH_CLOSED');assert.equal(transferDecision({...base,state:'RECEIVED',actualReceivedAt:'2030-01-01T17:10:00+09:00',inspectionReady:true}),'E07_RECEIPT_VERIFICATION_REQUIRED');
});

 test('cross-store source custody fence overlaps all later use, but not an earlier unrelated date',async()=>{const {fitIntervals}=await import('../../packages/core/src/inventory/period-matching');assert.equal(fitIntervals([{start:'2030-04-01',end:'9999-12-31'},{start:'2030-04-02',end:'2030-04-02'}],1),false);assert.equal(fitIntervals([{start:'2030-04-01',end:'9999-12-31'},{start:'2030-03-31',end:'2030-03-31'}],1),true);});
