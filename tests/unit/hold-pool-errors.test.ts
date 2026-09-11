import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import type {StaffPrincipal} from '../../packages/auth/src/staff-auth';
import {requestFor} from '../inventory/fixture';

// Inject transport failures before any SQL/auth resolution; no model, real credential or DB connection.
// The separate real-PG exhaustion test also exercises the exact installed pg/pg-pool version in CI.
const principal:StaffPrincipal={subject:'synthetic-transport-probe',role:'VIEWER',scope:'ASSIGNED',permissions:[],storeIds:[],revision:0};
function service(failure:unknown){return new HoldService({connect:async()=>{throw failure;},query:async()=>{throw failure;}} as unknown as Pool,principal);}
test('pool timeout wording changes preserve bounded outcomes on read acquisition and write preflight',async()=>{
 for(const wording of ['Pool acquisition timed out while awaiting a free client','Acquisition TIMEOUT: deadline reached']){
  const s=service(new Error(wording));
  await assert.rejects(s.options(),{code:'INDETERMINATE',status:503});
  await assert.rejects(s.command('create',randomUUID(),requestFor('2035-01-01')),{code:'INDETERMINATE',status:503});
 }
});
test('coded authentication or permission errors and unknown failures never become retryable timeouts or leak details',async()=>{
 for(const failure of [Object.assign(new Error('Synthetic authentication timeout'),{code:'28P01'}),Object.assign(new Error('Synthetic permission timeout'),{code:'42501'}),new Error('Synthetic unavailable configuration'),null]){
  await assert.rejects(service(failure).options(),{code:'HOLD_OPERATION_FAILED',status:500,message:'HOLD_OPERATION_FAILED'});
 }
});
