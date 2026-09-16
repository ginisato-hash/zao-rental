import test from 'node:test';
import assert from 'node:assert/strict';
import {r15ProjectionPermit,r15ProjectionTarget} from '../../packages/core/src/payment/r15-projection-authority';
import {TransactionalPaymentProjection} from '../../packages/core/src/payment/payment-projection';
import type {PaymentProjectionRepository} from '../../packages/core/src/payment/payment-projection';
import {PgPaymentProjection} from '../../packages/db/src/payment-projection';
import {id} from '../fixtures/payment-projection';
const env={VERCEL_ENV:'preview',VERCEL_PROJECT_ID:'prj_ehUMOzM77em9DVnHJBJffncD5hg7',R15_ACTIVATION_AUTHORITY:'P6_R15',SQUARE_ENVIRONMENT:'SANDBOX'};
const target={bookingId:id(1),attemptId:id(4),database:'zr_0123456789ab'};
test('R15 production-build exception requires exact Preview project and server-issued synthetic target',()=>{
 for(const patch of [{VERCEL_ENV:'production'},{VERCEL_PROJECT_ID:'other'},{R15_ACTIVATION_AUTHORITY:''},{SQUARE_ENVIRONMENT:'PRODUCTION'}])assert.throws(()=>r15ProjectionPermit({...env,...patch},target),/R15_PREVIEW_AUTHORITY_REQUIRED/);
 const permit=r15ProjectionPermit(env,target);assert.deepEqual(r15ProjectionTarget(permit),target);assert.equal(r15ProjectionTarget(permit,{...target,bookingId:id(10)}),null);assert.equal(r15ProjectionTarget({kind:'R15_HOSTED_SYNTHETIC_PROJECTION'}),null);
});
test('R15 production build preserves ordinary rejection and refuses forged/wrong target before DB',async()=>{
 let calls=0;const pool={async connect(){calls++;throw Error('DB_NOT_EXPECTED');}},repository={} as PaymentProjectionRepository;
 const previous=process.env.NODE_ENV;try{(process.env as Record<string,string|undefined>).NODE_ENV='production';
  assert.throws(()=>new TransactionalPaymentProjection(repository),{code:'PROJECTION_NOT_ACTIVATED'});
  assert.throws(()=>new TransactionalPaymentProjection(repository,{kind:'R15_HOSTED_SYNTHETIC_PROJECTION'}),{code:'PROJECTION_NOT_ACTIVATED'});
  const permit=r15ProjectionPermit(env,target);assert.doesNotThrow(()=>new TransactionalPaymentProjection(repository,permit));
  const ref={bookingId:id(10),attemptId:id(4),jobId:id(9),truthRevision:1,truthFingerprint:'a'.repeat(64),observationFingerprint:'b'.repeat(64),expectedRevision:0};
  await assert.rejects(new TransactionalPaymentProjection(repository,permit).project(ref),{code:'PROJECTION_NOT_ACTIVATED'});
  await assert.rejects(new PgPaymentProjection(pool,undefined,permit).transaction(ref,async()=>{}),{code:'PROJECTION_NOT_ACTIVATED'});assert.equal(calls,0);
 }finally{if(previous===undefined)delete (process.env as Record<string,string|undefined>).NODE_ENV;else (process.env as Record<string,string|undefined>).NODE_ENV=previous;}
});
