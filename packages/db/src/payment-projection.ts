import type {InboxPool,InboxConnection} from './square-webhook-inbox';
import {ProjectionError,projectionClaims,decidePaymentProjection,type PaymentProjectionRepository,type PaymentProjectionTransaction,type ProjectionReference,type ProjectionState,type ProjectionSource,type ProjectionPlan,type ProjectionResult,type ProjectionClaim} from '../../core/src/payment/payment-projection';
const iso=(v:unknown):string|null=>v==null?null:new Date(v as string).toISOString();
const safeStates=(s:ProjectionState)=>({booking:s.booking.state,attempt:s.attempt.state,hold:s.hold?.state??null,holdPayment:s.hold?.paymentState??null});
/** No instantiated Pool, credential, HTTP or runtime. Only an explicitly injected local test repository. */
export class PgPaymentProjection implements PaymentProjectionRepository{
 constructor(private pool:InboxPool){}
 async transaction<T>(ref:ProjectionReference,run:(tx:PaymentProjectionTransaction)=>Promise<T>):Promise<T>{
  if(process.env.NODE_ENV==='production')throw new ProjectionError('PROJECTION_NOT_ACTIVATED');
  const c=await this.pool.connect().catch(()=>{throw new ProjectionError('PROJECTION_STORAGE_UNAVAILABLE');});let broken=false;
  try{
   await c.query('BEGIN');await c.query("SET LOCAL synchronous_commit=on; SET LOCAL lock_timeout='1500ms'; SET LOCAL statement_timeout='5000ms'; SET LOCAL idle_in_transaction_session_timeout='10000ms'");
   const db=(await c.query<{name:string}>('SELECT current_database() AS name')).rows[0]?.name;
   if(!db||!/^zr_[a-f0-9]{12}$/.test(db))throw new ProjectionError('PROJECTION_DEVELOPMENT_DB_ONLY');
   // Existing BookingService + stock writers acquire this BEFORE row locks. Not a new global lock.
   await c.query('SELECT pg_advisory_xact_lock(71820600)');
   const result=await run(new PgProjectionTransaction(c,ref));await c.query('COMMIT');return result;
  }catch(error){broken=true;await c.query('ROLLBACK').catch(()=>{});if(error instanceof ProjectionError)throw error;throw new ProjectionError('PROJECTION_STORAGE_UNAVAILABLE');}
  finally{c.release(broken);}
 }
}
class PgProjectionTransaction implements PaymentProjectionTransaction{
 constructor(private c:InboxConnection,private ref:ProjectionReference){}
 private sourceValue:ProjectionSource|null=null;
 async time(){return (await this.c.query<{now:Date}>('SELECT inventory_clock() AS now')).rows[0]!.now;}
 async load():Promise<ProjectionState>{
  const c=this.c,r=this.ref;
  const b=(await c.query(`SELECT id,owner_id,hold_id,quote_id,conditions,price_snapshot,price_sha256,mode,state,confirmed_at,version FROM rental_bookings WHERE id=$1 FOR UPDATE`,[r.bookingId])).rows[0];
  const a=(await c.query('SELECT * FROM rental_payment_attempts WHERE id=$1 AND booking_id=$2 FOR UPDATE',[r.attemptId,r.bookingId])).rows[0];
  if(!b||!a)throw new ProjectionError('PROJECTION_TARGET_MISMATCH');
  const h=(await c.query('SELECT * FROM inventory_holds WHERE id=$1 FOR UPDATE',[b.hold_id])).rows[0];
  const head=(await c.query('SELECT revision,last_observation FROM payment_projection.heads WHERE attempt_id=$1 FOR UPDATE',[r.attemptId])).rows[0];
  const q=(await c.query('SELECT id,actor,hold_id,conditions,snapshot,snapshot_sha256,coupon_id FROM price_quotes WHERE id=$1',[b.quote_id])).rows[0];
  const claims=(await c.query<ProjectionClaim>(`SELECT c.requirement_key,c.day::text,'GEAR' AS kind,1 AS quantity,v.id,v.family,v.age,v.tier,v.model_id,m.catalog_season,v.compatible_sports
   FROM inventory_claims c LEFT JOIN ledger_assets a ON a.id=c.asset_id LEFT JOIN ledger_poles p ON p.id=c.pole_id
   LEFT JOIN ledger_variants v ON v.id=coalesce(a.variant_id,p.variant_id) LEFT JOIN ledger_models m ON m.id=v.model_id WHERE c.hold_id=$1 AND c.active
   UNION ALL SELECT c.requirement_key,c.day::text,'WEAR' AS kind,c.quantity,v.id,v.family,v.age,v.tier,v.model_id,m.catalog_season,v.compatible_sports
   FROM wear_claims c JOIN wear_pools p ON p.id=c.pool_id JOIN ledger_variants v ON v.id=p.variant_id JOIN ledger_models m ON m.id=v.model_id WHERE c.hold_id=$1 AND c.active LIMIT 1401`,[b.hold_id])).rows;
  const integrity=projectionClaims(b.conditions,claims);
  const transfer=(await c.query(`SELECT coalesce(bool_or(b.issue IS NOT NULL OR p.state='CANCELLED'),false) AS forbidden,
   min(b.planned_ready_at) FILTER(WHERE p.state NOT IN ('READY','CLOSED')) AS unready_at
   FROM inventory_claims cl JOIN transfer_pieces p ON p.id=cl.transfer_piece_id JOIN transfer_batches b ON b.id=p.batch_id WHERE cl.hold_id=$1 AND cl.active`,[b.hold_id])).rows[0];
  return {booking:{id:b.id,ownerId:b.owner_id,holdId:b.hold_id,quoteId:b.quote_id,mode:b.mode,state:b.state,confirmedAt:iso(b.confirmed_at),version:b.version,conditions:b.conditions,priceSnapshot:b.price_snapshot,priceHash:b.price_sha256},
   attempt:{expected:{attemptId:a.id,bookingId:a.booking_id,idempotencyKey:a.idempotency_key,merchantId:a.merchant_id,locationId:a.location_id,amountJpy:Number(a.amount_jpy),currency:a.currency},actor:a.actor,state:a.state,providerId:a.provider_id,providerState:a.provider_state,providerUpdatedAt:iso(a.provider_updated_at),completedAt:iso(a.completed_at)},
   hold:h?{id:h.id,ownerId:h.owner_id,reservationId:h.reservation_id,state:h.state,paymentState:h.payment_state,allocationStage:h.allocation_stage,transferAttention:h.transfer_attention,expiresAt:iso(h.expires_at)!,dueAt:iso(h.due_at)!,confirmedAt:iso(h.confirmed_at),version:h.version,conditions:h.conditions}:null,
   quote:q?{id:q.id,actor:q.actor,holdId:q.hold_id,conditions:q.conditions,snapshot:q.snapshot,snapshotHash:q.snapshot_sha256,couponId:q.coupon_id}:null,
   gearClaimsIntact:integrity.gear,wearClaimsIntact:integrity.wear,forbiddenTransfer:transfer?.forbidden===true,unreadyTransferAt:iso(transfer?.unready_at),revision:head?.revision??0,previous:head?.last_observation??null};
 }
 async prior(fingerprint:string){return (await this.c.query<{result:ProjectionResult;jobId:string;truthFingerprint:string}>('SELECT result,job_id AS "jobId",truth_fingerprint AS "truthFingerprint" FROM payment_projection.events WHERE attempt_id=$1 AND booking_id=$2 AND observation_fingerprint=$3',[this.ref.attemptId,this.ref.bookingId,fingerprint])).rows[0]??null;}
 async linkReplay(ref:ProjectionReference){
  await this.c.query('INSERT INTO payment_projection.job_receipts(job_id,attempt_id,observation_fingerprint) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[ref.jobId,ref.attemptId,ref.observationFingerprint]);
 }
 async source(){
  // Read routing metadata, then take stream->job locks in the same order as R12 finalize/dispatch.
  const meta=(await this.c.query('SELECT environment,merchant_id,payment_id FROM payment_reconciliation.jobs WHERE id=$1',[this.ref.jobId])).rows[0];if(!meta)return null;
  const stream=(await this.c.query('SELECT * FROM payment_reconciliation.streams WHERE environment=$1 AND merchant_id=$2 AND payment_id=$3 FOR UPDATE',[meta.environment,meta.merchant_id,meta.payment_id])).rows[0];
  const job=(await this.c.query('SELECT * FROM payment_reconciliation.jobs WHERE id=$1 FOR UPDATE',[this.ref.jobId])).rows[0];if(!job||!stream)return null;
  this.sourceValue={jobId:job.id,environment:job.environment,merchantId:job.merchant_id,paymentId:job.payment_id,state:job.state,securityBlocked:job.security_blocked,truthRevision:Number(stream.truth_revision),decision:job.decision,decisionFingerprint:job.decision_fingerprint,contextFingerprint:job.context_fingerprint,observation:stream.latest};return this.sourceValue;
 }
 async persist(s:ProjectionState,plan:ProjectionPlan,r:ProjectionReference,now:Date):Promise<ProjectionResult>{
  // Sample after source lock waits; again immediately before the first business write.
  now=await this.time();if(plan.observation)plan=decidePaymentProjection(s,plan.observation,now);
  const c=this.c,a=s.attempt,b=s.booking,h=s.hold,previous=safeStates(s),o=plan.observation;
  if(plan.mutation!=='NONE'&&!o)throw new ProjectionError('INVALID_PROJECTION_PLAN');
  if(plan.mutation!=='NONE'){
   // The existing audit FK records original initiating actor. Origin is separately INTERNAL_LOCAL_PROJECTION.
   await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','PAYMENT_PROJECTION_LOCAL',true)",[a.actor]);
   const state=plan.mutation==='COMPLETED'?'COMPLETED':plan.mutation==='PENDING'?'PENDING':plan.mutation==='FAILED'?'FAILED':'REVIEW';
   await c.query('UPDATE rental_payment_attempts SET state=$2,provider_id=$3,provider_state=$4,provider_updated_at=$5,completed_at=$6,updated_at=$7 WHERE id=$1',[a.expected.attemptId,state,o!.providerId,o!.status,o!.updatedAt,o!.completedAt,now]);a.state=state;
   if(plan.mutation==='COMPLETED'){
    await c.query("UPDATE rental_bookings SET state='CONFIRMED_DEV',confirmed_at=$2,version=version+1 WHERE id=$1",[b.id,now]);b.state='CONFIRMED_DEV';
    const confirmed=await c.query("UPDATE inventory_holds SET payment_state='SUCCESS',confirmed_at=$2,version=version+1 WHERE id=$1 AND state='ACTIVE' AND confirmed_at IS NULL AND allocation_stage='PROVISIONAL' AND payment_state IN ('PENDING','UNKNOWN') AND expires_at>inventory_clock() AND due_at>inventory_clock() RETURNING id",[h!.id,now]);
    if(confirmed.rowCount!==1)throw new ProjectionError('PROJECTION_TIME_BOUNDARY_CHANGED');h!.paymentState='SUCCESS';
   }else if(plan.mutation==='FAILED'||plan.mutation==='REVIEW_COMPLETED'){
    await c.query("UPDATE rental_bookings SET state='PAYMENT_REVIEW',version=version+1 WHERE id=$1",[b.id]);b.state='PAYMENT_REVIEW';
   }
   if(plan.mutation==='PENDING'||plan.mutation==='FAILED'){
    const state=plan.mutation==='FAILED'?'FAILURE':'PENDING';await c.query('UPDATE inventory_holds SET payment_state=$2,version=version+1 WHERE id=$1',[h!.id,state]);h!.paymentState=state;
   }
  }
  const revision=s.revision+1,result:ProjectionResult={bookingId:b.id,attemptId:a.expected.attemptId,revision,decision:plan.decision,decisionFingerprint:plan.fingerprint,observationFingerprint:r.observationFingerprint,providerStatus:o?.status??null,bookingState:b.state,attemptState:a.state,operatorActionRequired:plan.operatorActionRequired,duplicate:false};
  const advanced=await c.query(`INSERT INTO payment_projection.heads(attempt_id,revision,last_observation) VALUES($1,$2,$4::jsonb) ON CONFLICT(attempt_id) DO UPDATE SET revision=EXCLUDED.revision,last_observation=coalesce(EXCLUDED.last_observation,payment_projection.heads.last_observation) WHERE payment_projection.heads.revision=$3`,[a.expected.attemptId,revision,s.revision,plan.mutation==='NONE'?null:JSON.stringify(o)]);
  if(advanced.rowCount!==1)throw new ProjectionError('STALE_PROJECTION_REVISION');
  await c.query(`INSERT INTO payment_projection.events(booking_id,attempt_id,job_id,provider_id,provider_updated_at,observation_fingerprint,truth_fingerprint,decision_fingerprint,decision,revision,observation,previous_state,new_state,operator_required,result,occurred_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15::jsonb,$16)`,[b.id,a.expected.attemptId,r.jobId,this.sourceValue!.paymentId,o?.updatedAt??this.sourceValue!.observation!.updatedAt,r.observationFingerprint,r.truthFingerprint,plan.fingerprint,plan.decision,revision,o?JSON.stringify(o):null,JSON.stringify(previous),JSON.stringify(safeStates(s)),plan.operatorActionRequired,JSON.stringify(result),now]);
  // Same commit as business writes: explicit R12 job receipt. R12 RECONCILED is evidence-only, not business success.
  await c.query('INSERT INTO payment_projection.job_receipts(job_id,attempt_id,observation_fingerprint) VALUES($1,$2,$3)',[r.jobId,a.expected.attemptId,r.observationFingerprint]);
  return result;
 }
}
