import assert from 'node:assert/strict';
import test from 'node:test';
import {readinessDetails,readinessResponse} from '../../apps/web/src/lib/readiness-http';
import {staffLabel} from '../../apps/web/src/components/staff-labels';
import type {StaffState} from '../../packages/auth/src/staff-auth';
const state={ready:true,stage:'READY'} as const;
const operator:StaffState={status:'authorized',stamp:'synthetic',principal:{subject:'synthetic',role:'STAFF',scope:'ALL',storeIds:[],permissions:['OPERATIONS_VIEW'],revision:1}};

test('commercial payment configuration reaches the authorized operations display without claiming provider health',async()=>{
 const response=readinessDetails(state,operator,{APP:'READY',PAYMENT_ADAPTER:'CONFIGURED_COMMERCIAL'});
 assert.equal(response.status,200);assert.equal((await response.json()).components.PAYMENT_ADAPTER,'CONFIGURED_COMMERCIAL');
 assert.equal(staffLabel('CONFIGURED_COMMERCIAL'),'本番設定済み');
});

test('unknown component details remain filtered and public readiness stays minimal',async()=>{
 const response=readinessDetails(state,operator,{APP:'READY',PAYMENT_ADAPTER:'SYNTHETIC_UNKNOWN_DETAIL',password:'SYNTHETIC_SECRET'}),body=await response.json();
 assert.equal(body.components.PAYMENT_ADAPTER,'UNAVAILABLE');assert.ok(!JSON.stringify(body).includes('SYNTHETIC_'));assert.deepEqual(Object.keys(body.components),['APP','DB','GUEST','PAYMENT_ADAPTER','WEBHOOK','MEDIA','NOTIFICATION']);
 assert.match(response.headers.get('cache-control')!,/private, no-store/);assert.deepEqual(await readinessResponse(state).json(),{status:'READY'});
});

test('commercial configuration detail does not bypass staff authorization',()=>{
 assert.equal(readinessDetails(state,{status:'anonymous',principal:null,stamp:null},{PAYMENT_ADAPTER:'CONFIGURED_COMMERCIAL'}).status,401);
 assert.equal(readinessDetails(state,{...operator,principal:{...operator.principal,permissions:['BOOKING_VIEW']}},{PAYMENT_ADAPTER:'CONFIGURED_COMMERCIAL'}).status,403);
});
