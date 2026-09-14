import type {InboxPool,InboxConnection} from './square-webhook-inbox';
import type {PaymentContext} from '../../core/src/payment/payment-truth';
import type {WebhookEnvironment} from '../../core/src/payment/square-webhook-inbox';
import type {PaymentReconciliationRepository,ReconciliationClaim,JobOutcome,JobSummary,PaymentContextReader} from '../../core/src/payment/payment-reconciliation';
/** Explicit transaction, commit barrier, no retries. SQL stores only allowlisted truth metadata. */
export class PgPaymentReconciliation implements PaymentReconciliationRepository,PaymentContextReader{
 constructor(private readonly pool:InboxPool){}
 private async tx<T>(run:(c:InboxConnection)=>Promise<T>):Promise<T>{
  const c=await this.pool.connect().catch(()=>{throw new Error('RECONCILIATION_STORAGE_UNAVAILABLE');});let broken=false;
  try{await c.query('BEGIN');await c.query("SET LOCAL synchronous_commit=on; SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='5000ms'; SET LOCAL idle_in_transaction_session_timeout='10000ms'");const result=await run(c);await c.query('COMMIT');return result;}
  catch{broken=true;await c.query('ROLLBACK').catch(()=>{});throw new Error('RECONCILIATION_STORAGE_UNAVAILABLE');}finally{c.release(broken);}
 }
 dispatch(environment:WebhookEnvironment,limit:number){return this.tx(async c=>(await c.query<{n:number}>('SELECT payment_reconciliation.dispatch($1,$2) AS n',[environment,limit])).rows[0]!.n);}
 claimBatch(environment:WebhookEnvironment,workerId:string,limit:number){return this.tx(async c=>{
  const rows=(await c.query<{claim:ReconciliationClaim}>('SELECT payment_reconciliation.claim($1,$2,$3) AS claim',[environment,workerId,limit])).rows;
  return rows.map(({claim})=>({...claim,leaseExpiresAt:new Date(claim.leaseExpiresAt),deadlineAt:new Date(claim.deadlineAt)}));
 });}
 finalize(claim:ReconciliationClaim,outcome:JobOutcome){return this.tx(async c=>(await c.query<{ok:boolean}>('SELECT payment_reconciliation.finalize($1,$2,$3,$4,$5,$6,$7::jsonb) AS ok',[claim.id,claim.leaseToken,claim.truthRevision,outcome.state,outcome.code,outcome.retrySeconds,outcome.truth?JSON.stringify(outcome.truth):null])).rows[0]?.ok===true);}
 async loadBatch(claims:ReconciliationClaim[]):Promise<ReadonlyMap<string,PaymentContext>>{
  if(claims.length===0)return new Map();if(claims.length>20||claims.some(c=>c.environment!==claims[0]!.environment))throw new Error('INVALID_CONTEXT_BATCH');
  return this.tx(async c=>new Map((await c.query<{entry:{jobId:string;context:PaymentContext}}>('SELECT payment_reconciliation.load_contexts($1,$2::uuid[]) AS entry',[claims[0]!.environment,claims.map(c=>c.id)])).rows.map(({entry})=>[entry.jobId,entry.context])));
 }
 load(claim:ReconciliationClaim){return this.tx(async c=>(await c.query<{context:PaymentContext|null}>('SELECT payment_reconciliation.load_context($1,$2,$3) AS context',[claim.environment,claim.merchantId,claim.paymentId])).rows[0]?.context??null);}
 diagnostics(environment:WebhookEnvironment,limit:number){return this.tx(async c=>(await c.query<{summary:JobSummary}>('SELECT payment_reconciliation.diagnostics($1,$2) AS summary',[environment,limit])).rows.map(({summary})=>({...summary,updatedAt:new Date(summary.updatedAt)})));}
}
