import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchR15Once,type R15Operation} from '../../packages/db/src/r15-operation-guard';
import type {InboxPool,InboxConnection} from '../../packages/db/src/square-webhook-inbox';
const op:R15Operation={manifestSha256:'a'.repeat(64),action:'CREATE_PAYMENT',bookingId:'synthetic-booking',attemptId:'synthetic-attempt',idempotencyKey:'synthetic-key',locationId:'synthetic-location',paymentId:null};
for(const failure of ['BEGIN','reserve','COMMIT','none'])test('R15 dispatch barrier '+failure,async()=>{
 const order:string[]=[];const pool:InboxPool={async connect(){return {release(){order.push('release');},async query(sql:string){order.push(sql);if(sql.includes(failure)&&failure!=='none')throw Error('PRIVATE_FAILURE');return {rows:[{acquired:true}],rowCount:1};}} as InboxConnection;}};
 const call=()=>dispatchR15Once(pool,op,async()=>{order.push('SEND');return true;});
 if(failure==='none'){assert.equal(await call(),true);assert.ok(order.indexOf('COMMIT')<order.indexOf('SEND'));assert.ok(order.indexOf('release')<order.indexOf('SEND'));}
 else{await assert.rejects(call(),/R15_GUARD_NOT_ACQUIRED_DO_NOT_RETRY/);assert.ok(!order.includes('SEND'));}
});
