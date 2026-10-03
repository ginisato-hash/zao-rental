import {Pool} from 'pg';
import {TLSSocket,checkServerIdentity} from 'node:tls';
import {exactProductionIdentityConfiguration,type ExactProductionIdentity} from '../../auth/src/production-identity';
import {verifyProductionDatabase} from './production-connection';
import {acceptanceDatabaseConfig,verifyAcceptanceRole} from '../../../scripts/lib/production-payment-acceptance';
import {PgPaymentReconciliation} from './payment-reconciliation';
import {PgPaymentProjection} from './payment-projection';
import {issueProductionReconciliationAuthority} from '../../core/src/payment/production-reconciliation-authority';
import {productionProjectionPermit} from '../../core/src/payment/production-projection-authority';
import {PaymentReconciliationWorker,boundedLookup,type PaymentTruthProvider} from '../../core/src/payment/payment-reconciliation';
import {TransactionalPaymentProjection,type ProjectionSource} from '../../core/src/payment/payment-projection';
import {normalWorkerPlan,normalProjectionReference,runNormalProductionTick,type NormalProjectionCandidate} from '../../core/src/payment/normal-production-worker';
import type {BookingNotificationWorker} from '../../core/src/notification/worker';
import type {CancellationRefundWorker} from '../../core/src/payment/cancellation-refund-worker';

export type ProductionWorkerInput={plan:unknown;databaseUrls:Record<'dispatcher'|'worker'|'projector',string>;lookup:PaymentTruthProvider;preflight?:boolean};
/** Explicit finite factory only. No web startup/scheduler. Every pool is identity-checked before lookup. */
export async function runProductionWorker(identity:ExactProductionIdentity,input:ProductionWorkerInput,operations:Pool,notifications:BookingNotificationWorker|null,refunds:CancellationRefundWorker|null){
 const c=exactProductionIdentityConfiguration(identity),plan=normalWorkerPlan(input.plan),pools:Pool[]=[];
 if(!c?.payment||!c.flags.booking||!c.flags.payment)throw Error('NORMAL_WORKER_IDENTITY_REJECTED');
 const close=async()=>{await Promise.all(pools.map(p=>p.end()));};
 try{
  if(['NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR'].some(k=>process.env[k]!==undefined))throw Error('NORMAL_WORKER_TLS_OVERRIDE_REJECTED');
  await verifyProductionDatabase(operations,c,'operations');
  const opened={} as Record<'dispatcher'|'worker'|'projector',Pool>;
  // Parse all role bindings before opening any socket. F2 lease credentials are not renewed here.
  const configs=Object.fromEntries((['dispatcher','worker','projector'] as const).map(role=>[role,acceptanceDatabaseConfig(c,role,input.databaseUrls[role])])) as Record<'dispatcher'|'worker'|'projector',ReturnType<typeof acceptanceDatabaseConfig>>;
  for(const role of ['dispatcher','worker','projector'] as const){
   const config=configs[role],pool=new Pool({...config,application_name:'zao_normal_worker_'+role});pools.push(pool);pool.on('error',()=>{});
   const client=await pool.connect();try{const stream=(Reflect.get(client,'connection') as {stream?:unknown})?.stream;
    if(!(stream instanceof TLSSocket)||!stream.authorized||!stream.encrypted||Reflect.get(stream,'servername')!==config.host||!['TLSv1.2','TLSv1.3'].includes(stream.getProtocol()??'')||checkServerIdentity(config.host,stream.getPeerCertificate())!==undefined)throw Error('NORMAL_WORKER_TLS_IDENTITY_REJECTED');
   }finally{client.release();}
   await verifyAcceptanceRole(pool,c,role);opened[role]=pool;
   const signature={dispatcher:'payment_reconciliation.dispatch_normal(text,integer,timestamptz)',worker:'payment_reconciliation.claim_normal(text,integer,text,timestamptz)',projector:'payment_projection.normal_candidates(text,timestamptz,integer)'}[role];
   const check=(await pool.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') allowed,rolvaliduntil IS NULL OR rolvaliduntil>$2::timestamptz lease FROM pg_roles WHERE rolname=current_user",[signature,plan.deadline])).rows[0];
   if(check?.allowed!==true||check?.lease!==true)throw Error('NORMAL_WORKER_ROLE_NOT_READY');
  }
  if((await operations.query("SELECT has_function_privilege(current_user,'notification_due_normal(timestamptz,integer)','EXECUTE') allowed")).rows[0]?.allowed!==true)throw Error('NORMAL_WORKER_ROLE_NOT_READY');
  if(input.preflight)return {state:'PREFLIGHT_PASS',providerCalls:0,roleMutations:0};
  const authority=issueProductionReconciliationAuthority(identity),dispatcher=new PgPaymentReconciliation(opened.dispatcher,undefined,authority,undefined,plan.acceptedBookingsAfter),worker=new PgPaymentReconciliation(opened.worker,undefined,authority,undefined,plan.acceptedBookingsAfter);
  const contexts={async load(claim:Parameters<typeof worker.load>[0]){const context=await worker.load(claim);return context&&context.expected.merchantId===c.payment!.merchantId&&Object.values(c.payment!.locations).includes(context.expected.locationId)?context:null;}};
  const reconciliation=new PaymentReconciliationWorker({dispatch:(e,n)=>dispatcher.dispatch(e,n),claimBatch:(e,id,n)=>worker.claimBatch(e,id,n),finalize:(claim,outcome)=>worker.finalize(claim,outcome),diagnostics:async()=>[]},contexts,{async lookupPayment(request){if(Date.now()>=Date.parse(plan.deadline))return {kind:'FAILED',code:'NETWORK_RETRYABLE'};return input.lookup.lookupPayment(request);}},undefined,undefined,(run,ms)=>boundedLookup(run,Math.min(ms,Math.max(1,Date.parse(plan.deadline)-Date.now()))));
  return await runNormalProductionTick(plan,{
   reconciliation,
   candidates:async limit=>(await opened.projector.query<{v:NormalProjectionCandidate}>('SELECT payment_projection.normal_candidates($1,$2,$3) v',[c.payment!.merchantId,plan.acceptedBookingsAfter,limit])).rows.map(r=>r.v),
   project:async candidate=>{
    const ref=normalProjectionReference(candidate),permit=productionProjectionPermit(identity,ref);
    const repository=new PgPaymentProjection(opened.projector,async client=>(await client.query<{v:ProjectionSource|null}>('SELECT payment_projection.lock_source_production($1,$2,$3) v',[ref.jobId,c.payment!.merchantId,candidate.paymentId])).rows[0]?.v??null,undefined,permit);
    return new TransactionalPaymentProjection(repository,undefined,permit).project(ref);
   },
   notifications,refunds,
   refundCandidates:async limit=>(await operations.query(`SELECT r.id,r.amount_jpy,r.provider_id,r.dispatched_at,r.state FROM booking_cancellation_refunds r JOIN rental_bookings b ON b.id=r.booking_id
    WHERE b.mode='SQUARE_PRODUCTION' AND b.created_at>=$1 AND r.merchant_id=$2 AND r.location_id=ANY($3::text[]) AND r.state IN ('PENDING','UNKNOWN') ORDER BY r.created_at,r.id LIMIT $4`,[plan.acceptedBookingsAfter,c.payment!.merchantId,Object.values(c.payment!.locations),limit])).rows,
   close:async()=>{},
  });
 }finally{await close();}
}
