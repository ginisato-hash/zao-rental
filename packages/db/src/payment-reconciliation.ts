import type {InboxPool,InboxConnection} from './square-webhook-inbox';
import type {PaymentContext} from '../../core/src/payment/payment-truth';
import type {WebhookEnvironment} from '../../core/src/payment/square-webhook-inbox';
import type {PaymentReconciliationRepository,ReconciliationClaim,JobOutcome,JobSummary,PaymentContextReader} from '../../core/src/payment/payment-reconciliation';
import {productionReconciliationTarget,type ProductionReconciliationAuthority} from '../../core/src/payment/production-reconciliation-authority';
/** Explicit transaction, commit barrier, no retries. SQL stores only allowlisted truth metadata.
 *
 * F5 (TD correction): `environment==='PRODUCTION'` alone is never sufficient to route onto the
 * *_production SQL surface — that would still be deciding Production admission from a raw string
 * already present in caller-supplied/persisted data (payment_reconciliation.jobs.environment,
 * a ReconciliationClaim, etc.), exactly the duck-typed evidence F2 already closed for the
 * projection permit. Every method below requires the explicit `authority` capability
 * (production-reconciliation-authority.ts, issued only from an F2 ExactProductionIdentity) before
 * it will touch a PRODUCTION row at all, and — the converse — an instance holding that authority
 * never falls back to the generic Sandbox-capable functions, matching exactly what a Production
 * payment role (scripts/production-payment-roles.ts) is granted EXECUTE on and nothing else.
 * Without `authority`, this class's Sandbox path (including `target`-scoped R15/dev routing) is
 * byte-identical to before. */
export class PgPaymentReconciliation implements PaymentReconciliationRepository,PaymentContextReader{
 constructor(private readonly pool:InboxPool,private readonly target?:{merchantId:string;paymentId:string},private readonly authority?:ProductionReconciliationAuthority){}
 private async tx<T>(run:(c:InboxConnection)=>Promise<T>):Promise<T>{
  const c=await this.pool.connect().catch(()=>{throw new Error('RECONCILIATION_STORAGE_UNAVAILABLE');});let broken=false;
  try{await c.query('BEGIN');await c.query("SET LOCAL synchronous_commit=on; SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='5000ms'; SET LOCAL idle_in_transaction_session_timeout='10000ms'");const result=await run(c);await c.query('COMMIT');return result;}
  catch{broken=true;await c.query('ROLLBACK').catch(()=>{});throw new Error('RECONCILIATION_STORAGE_UNAVAILABLE');}finally{c.release(broken);}
 }
 /** Fail closed both ways: a PRODUCTION-environment call with no authority, and a
  * SANDBOX-environment call while holding one, are both structural misuse. */
 private assertEnvironment(environment:WebhookEnvironment):void{
  if(environment==='PRODUCTION'&&!this.authority)throw new Error('PRODUCTION_RECONCILIATION_AUTHORITY_REQUIRED');
  if(environment==='SANDBOX'&&this.authority)throw new Error('PRODUCTION_RECONCILIATION_AUTHORITY_MISUSE');
 }
 private requireAuthorityTarget(){
  const t=productionReconciliationTarget(this.authority);
  if(!t)throw new Error('PRODUCTION_RECONCILIATION_AUTHORITY_REQUIRED');
  return t;
 }
 async dispatch(environment:WebhookEnvironment,limit:number){
  this.assertEnvironment(environment);
  return this.tx(async c=>this.authority
   ?(await c.query<{n:number}>('SELECT payment_reconciliation.dispatch_production($1,$2) AS n',[this.requireAuthorityTarget().merchantId,limit])).rows[0]!.n
   :(await c.query<{n:number}>(this.target?'SELECT payment_reconciliation.dispatch_target($1,$2,$3,$4) AS n':'SELECT payment_reconciliation.dispatch($1,$2) AS n',this.target?[environment,limit,this.target.merchantId,this.target.paymentId]:[environment,limit])).rows[0]!.n);
 }
 async claimBatch(environment:WebhookEnvironment,workerId:string,limit:number){
  this.assertEnvironment(environment);
  return this.tx(async c=>{
   const rows=this.authority
    ?(await c.query<{claim:ReconciliationClaim}>('SELECT payment_reconciliation.claim_production($1,$2,$3) AS claim',[workerId,limit,this.requireAuthorityTarget().merchantId])).rows
    :(await c.query<{claim:ReconciliationClaim}>(this.target?'SELECT payment_reconciliation.claim_target($1,$2,$3,$4,$5) AS claim':'SELECT payment_reconciliation.claim($1,$2,$3) AS claim',this.target?[environment,workerId,limit,this.target.merchantId,this.target.paymentId]:[environment,workerId,limit])).rows;
   return rows.map(({claim})=>({...claim,leaseExpiresAt:new Date(claim.leaseExpiresAt),deadlineAt:new Date(claim.deadlineAt)}));
  });
 }
 async finalize(claim:ReconciliationClaim,outcome:JobOutcome){
  this.assertEnvironment(claim.environment);
  return this.tx(async c=>(await c.query<{ok:boolean}>(this.authority?'SELECT payment_reconciliation.finalize_production($1,$2,$3,$4,$5,$6,$7::jsonb) AS ok':'SELECT payment_reconciliation.finalize($1,$2,$3,$4,$5,$6,$7::jsonb) AS ok',[claim.id,claim.leaseToken,claim.truthRevision,outcome.state,outcome.code,outcome.retrySeconds,outcome.truth?JSON.stringify(outcome.truth):null])).rows[0]?.ok===true);
 }
 async loadBatch(claims:ReconciliationClaim[]):Promise<ReadonlyMap<string,PaymentContext>>{
  if(claims.length===0)return new Map();if(claims.length>20||claims.some(c=>c.environment!==claims[0]!.environment))throw new Error('INVALID_CONTEXT_BATCH');
  this.assertEnvironment(claims[0]!.environment);
  return this.tx(async c=>new Map((await c.query<{entry:{jobId:string;context:PaymentContext}}>(this.authority?'SELECT payment_reconciliation.load_contexts_production($1,$2::uuid[]) AS entry':'SELECT payment_reconciliation.load_contexts($1,$2::uuid[]) AS entry',[claims[0]!.environment,claims.map(c=>c.id)])).rows.map(({entry})=>[entry.jobId,entry.context])));
 }
 async load(claim:ReconciliationClaim){
  this.assertEnvironment(claim.environment);
  return this.tx(async c=>(await c.query<{context:PaymentContext|null}>(this.authority?'SELECT payment_reconciliation.load_context_production($1,$2,$3) AS context':'SELECT payment_reconciliation.load_context($1,$2,$3) AS context',[claim.environment,claim.merchantId,claim.paymentId])).rows[0]?.context??null);
 }
 async diagnostics(environment:WebhookEnvironment,limit:number){
  this.assertEnvironment(environment);
  return this.tx(async c=>(await c.query<{summary:JobSummary}>(this.authority?'SELECT payment_reconciliation.diagnostics_production($1) AS summary':'SELECT payment_reconciliation.diagnostics($1,$2) AS summary',this.authority?[limit]:[environment,limit])).rows.map(({summary})=>({...summary,updatedAt:new Date(summary.updatedAt)})));
 }
}
