import type {SandboxRefundObservation} from './sandbox-refund';
import type {Pool,PoolClient} from 'pg';
import {FlowError,flowHash,flowId,type PaymentGateway,type PaymentRequest,type PaymentObservation} from '../../../contracts/src/rental-flow';
import type {SquareSandboxGateway} from './square-sandbox';
export const SANDBOX_ACTIVATION_ID='P4-SANDBOX-OWNER-R1';
export type SandboxActivation={id:typeof SANDBOX_ACTIVATION_ID;evidence:'FIXTURE'|'REAL_SANDBOX';merchantId:string;locationIds:string[]};
/** Persist one approval across process restarts. Setup uses the migration owner, never
 * the application connection. Real setup still requires the Owner's missing resources. */
export async function initializeSandboxActivation(owner:Pool,config:SandboxActivation){
 if(config.id!==SANDBOX_ACTIVATION_ID||!['FIXTURE','REAL_SANDBOX'].includes(config.evidence)||!config.merchantId||!config.locationIds.length||config.locationIds.some(v=>!v)||new Set(config.locationIds).size!==config.locationIds.length)throw new FlowError('SQUARE_ACTIVATION_UNCONFIGURED',503);
 const locations=[...config.locationIds].sort();
 await owner.query(`INSERT INTO sandbox_activation_runs(id,evidence,merchant_id,location_ids,payment_limit,refund_limit) VALUES($1,$2,$3,$4,20,5) ON CONFLICT DO NOTHING`,[config.id,config.evidence,config.merchantId,JSON.stringify(locations)]);
 const row=(await owner.query('SELECT * FROM sandbox_activation_runs WHERE id=$1',[config.id])).rows[0];
 if(row.evidence!==config.evidence||row.merchant_id!==config.merchantId||flowHash(row.location_ids)!==flowHash(locations))throw new FlowError('SQUARE_ACTIVATION_MISMATCH',503);
}
export class SandboxActivationJournal {
 constructor(private pool:Pool){}
 private async transaction<T>(f:(c:PoolClient)=>Promise<T>){const c=await this.pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='2000ms';SET LOCAL statement_timeout='5000ms'");const v=await f(c);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async reserve(request:PaymentRequest){
  flowId(request.idempotencyKey);flowId(request.bookingId);flowId(request.attemptId);
  if(!Number.isSafeInteger(request.amountJpy)||request.amountJpy<1||request.currency!=='JPY')throw new FlowError('PAYMENT_EVIDENCE_MISMATCH');
  const fingerprint=flowHash(request);
  return this.transaction(async c=>{
   const run=(await c.query('SELECT * FROM sandbox_activation_runs WHERE id=$1 FOR UPDATE',[SANDBOX_ACTIVATION_ID])).rows[0];
   if(!run||run.merchant_id!==request.merchantId||!run.location_ids.includes(request.locationId))throw new FlowError('SQUARE_ACTIVATION_MISMATCH',503);
   const old=(await c.query("SELECT * FROM sandbox_activation_calls WHERE run_id=$1 AND operation='PAYMENT' AND (request_key=$2 OR reference_id=$3)",[SANDBOX_ACTIVATION_ID,request.idempotencyKey,request.bookingId])).rows[0];
   if(old){if(old.fingerprint!==fingerprint)throw new FlowError('SQUARE_ACTIVATION_REPLAY_MISMATCH',409);return {call:false,observation:old.result as PaymentObservation|null};}
   if(run.stopped_reason)throw new FlowError(run.stopped_reason,503);
   const count=(await c.query("SELECT count(*)::int n FROM sandbox_activation_calls WHERE run_id=$1 AND operation='PAYMENT'",[SANDBOX_ACTIVATION_ID])).rows[0].n;
   if(count>=run.payment_limit)throw new FlowError('SQUARE_BUDGET_EXHAUSTED',503);
   await c.query(`INSERT INTO sandbox_activation_calls(run_id,operation,request_key,reference_id,fingerprint,amount_jpy,status) VALUES($1,'PAYMENT',$2,$3,$4,$5,'SUBMITTING')`,[SANDBOX_ACTIVATION_ID,request.idempotencyKey,request.bookingId,fingerprint,request.amountJpy]);
   return {call:true,observation:null};
  });
 }
 async observed(r:PaymentRequest,o:PaymentObservation){
  await this.pool.query("UPDATE sandbox_activation_calls SET status='OBSERVED',result=$3 WHERE run_id=$1 AND operation='PAYMENT' AND request_key=$2 AND fingerprint=$4",[SANDBOX_ACTIVATION_ID,r.idempotencyKey,JSON.stringify(o),flowHash(r)]);
 }
 async unknown(r:PaymentRequest,error:unknown){
  await this.pool.query("UPDATE sandbox_activation_calls SET status='UNKNOWN' WHERE run_id=$1 AND operation='PAYMENT' AND request_key=$2 AND status<>'OBSERVED'",[SANDBOX_ACTIVATION_ID,r.idempotencyKey]);
  if(error instanceof FlowError&&['SQUARE_AUTH_STOP','SQUARE_QUOTA_STOP'].includes(error.code))await this.pool.query('UPDATE sandbox_activation_runs SET stopped_reason=$2 WHERE id=$1',[SANDBOX_ACTIVATION_ID,error.code]);
 }
 async reserveRefund(key:string,paymentId:string,amountJpy:number,merchantId:string){
  flowId(key);if(!/^[A-Za-z0-9_-]{1,100}$/.test(paymentId)||!Number.isSafeInteger(amountJpy)||amountJpy<1)throw new FlowError('SANDBOX_REFUND_INVALID',422);
  const fingerprint=flowHash({key,paymentId,amountJpy});
  return this.transaction(async c=>{
   const run=(await c.query('SELECT * FROM sandbox_activation_runs WHERE id=$1 FOR UPDATE',[SANDBOX_ACTIVATION_ID])).rows[0];
   if(!run)throw new FlowError('SQUARE_ACTIVATION_UNCONFIGURED',503);if(run.merchant_id!==merchantId)throw new FlowError('SQUARE_ACTIVATION_MISMATCH',503);
   const old=(await c.query("SELECT * FROM sandbox_activation_calls WHERE run_id=$1 AND operation='REFUND' AND request_key=$2",[SANDBOX_ACTIVATION_ID,key])).rows[0];
   if(old){if(old.fingerprint!==fingerprint)throw new FlowError('SQUARE_ACTIVATION_REPLAY_MISMATCH',409);return {call:false,observation:old.result as SandboxRefundObservation|null,locationId:''};}
   if(run.stopped_reason)throw new FlowError(run.stopped_reason,503);
   const payment=(await c.query("SELECT result FROM sandbox_activation_calls WHERE run_id=$1 AND operation='PAYMENT' AND status='OBSERVED' AND result->>'providerId'=$2 AND result->>'status'='COMPLETED'",[SANDBOX_ACTIVATION_ID,paymentId])).rows;
   if(payment.length!==1||payment[0].result.merchantId!==run.merchant_id)throw new FlowError('SANDBOX_REFUND_PAYMENT_UNVERIFIED',409);
   const rows=(await c.query("SELECT amount_jpy,payment_id,status FROM sandbox_activation_calls WHERE run_id=$1 AND operation='REFUND'",[SANDBOX_ACTIVATION_ID])).rows;
   if(rows.length>=run.refund_limit)throw new FlowError('SQUARE_BUDGET_EXHAUSTED',503);
   const matching=rows.filter(r=>r.payment_id===paymentId);
   if(matching.some(r=>r.status!=='OBSERVED'))throw new FlowError('SANDBOX_REFUND_RECONCILIATION_REQUIRED',409);
   // Conservatively reserve even failed/refused refund amounts; no implicit release/retry.
   if(matching.reduce((n,r)=>n+Number(r.amount_jpy),0)+amountJpy>payment[0].result.amountJpy)throw new FlowError('SANDBOX_REFUND_EXCEEDS_PAYMENT',409);
   await c.query(`INSERT INTO sandbox_activation_calls(run_id,operation,request_key,reference_id,payment_id,fingerprint,amount_jpy,status) VALUES($1,'REFUND',$2,$2,$3,$4,$5,'SUBMITTING')`,[SANDBOX_ACTIVATION_ID,key,paymentId,fingerprint,amountJpy]);
   return {call:true,observation:null,locationId:payment[0].result.locationId as string};
  });
 }
 async refundObserved(key:string,result:SandboxRefundObservation){await this.pool.query("UPDATE sandbox_activation_calls SET status='OBSERVED',result=$3 WHERE run_id=$1 AND operation='REFUND' AND request_key=$2",[SANDBOX_ACTIVATION_ID,key,JSON.stringify(result)]);}
 async refundUnknown(key:string,error:unknown){await this.pool.query("UPDATE sandbox_activation_calls SET status='UNKNOWN' WHERE run_id=$1 AND operation='REFUND' AND request_key=$2 AND status<>'OBSERVED'",[SANDBOX_ACTIVATION_ID,key]);if(error instanceof FlowError&&['SQUARE_AUTH_STOP','SQUARE_QUOTA_STOP'].includes(error.code))await this.pool.query('UPDATE sandbox_activation_runs SET stopped_reason=$2 WHERE id=$1',[SANDBOX_ACTIVATION_ID,error.code]);}
 async assertLookup(request:PaymentRequest){const r=(await this.pool.query('SELECT stopped_reason,merchant_id,location_ids FROM sandbox_activation_runs WHERE id=$1',[SANDBOX_ACTIVATION_ID])).rows[0];if(!r)throw new FlowError('SQUARE_ACTIVATION_UNCONFIGURED',503);if(r.stopped_reason)throw new FlowError(r.stopped_reason,503);if(r.merchant_id!==request.merchantId||!r.location_ids.includes(request.locationId))throw new FlowError('SQUARE_ACTIVATION_MISMATCH',503);const prior=(await this.pool.query("SELECT 1 FROM sandbox_activation_calls WHERE run_id=$1 AND operation='PAYMENT' AND request_key=$2 AND fingerprint=$3",[SANDBOX_ACTIVATION_ID,request.idempotencyKey,flowHash(request)])).rowCount;if(!prior)throw new FlowError('SQUARE_ACTIVATION_REPLAY_MISMATCH',409);}

}
/** No automatic POST retries. Unknown/submitting reservations consume budget. A process
 * dying between journal reservation and send is ambiguous and must be reconciled. */
export class ActivatedSandboxGateway implements PaymentGateway {
 readonly kind='SQUARE_SANDBOX' as const;
 constructor(private gateway:SquareSandboxGateway,private journal:SandboxActivationJournal){}
 async create(r:PaymentRequest){const reservation=await this.journal.reserve(r);if(!reservation.call){if(reservation.observation)return reservation.observation;throw new FlowError('PAYMENT_RESULT_UNKNOWN',503);}
  try{const o=await this.gateway.create(r);await this.journal.observed(r,o);return o;}catch(e){await this.journal.unknown(r,e);throw e;}}
 async lookup(r:PaymentRequest,id:string|null){await this.journal.assertLookup(r);try{const o=await this.gateway.lookup(r,id);await this.journal.observed(r,o);return o;}catch(e){await this.journal.unknown(r,e);throw e;}}
}
