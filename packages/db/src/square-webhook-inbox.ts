import type {Pool,PoolClient} from 'pg';
import type {InboxClaim,InboxSignal,Receipt,ReconcileResult,SquareWebhookInbox,SquareWebhookReconciliation,WebhookEnvironment} from '../../core/src/payment/square-webhook-inbox';

export type InboxConnection=Pick<PoolClient,'query'|'release'>;
export type InboxPool={connect():Promise<InboxConnection>};
/** ACK waits for explicit COMMIT. No client-side retry after an uncertain commit. */
export class PgSquareWebhookInbox implements SquareWebhookInbox,SquareWebhookReconciliation {
 constructor(private readonly pool:InboxPool|Pool){}
 private async transaction<T>(run:(c:InboxConnection)=>Promise<T>):Promise<T>{
  const c=await this.pool.connect().catch(()=>{throw new Error('WEBHOOK_INBOX_UNAVAILABLE');});let broken=false;
  try{await c.query('BEGIN');await c.query("SET LOCAL synchronous_commit=on; SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='2500ms'; SET LOCAL idle_in_transaction_session_timeout='5000ms'");
   const result=await run(c);await c.query('COMMIT');return result;
  }catch{broken=true;await c.query('ROLLBACK').catch(()=>{});throw new Error('WEBHOOK_INBOX_UNAVAILABLE');}
  finally{c.release(broken);}
 }
 async receive(s:InboxSignal):Promise<Receipt>{
  return this.transaction(async c=>{
   const r=await c.query<{result:Receipt}>('SELECT square_webhook.receive($1,$2,$3,$4,$5,$6) AS result',[s.environment,s.eventId,s.type,s.merchantId,s.paymentId,s.bodySha256]);
   const v=r.rows[0]?.result;if(v!=='INSERTED'&&v!=='DUPLICATE'&&v!=='HASH_CONFLICT')throw new Error('INVALID_INBOX_RECEIPT');return v;
  });
 }
 async claim(environment:WebhookEnvironment,leaseSeconds:number):Promise<InboxClaim|null>{
  return this.transaction(async c=>{
   const r=await c.query<{event_id:string;event_type:InboxSignal['type'];merchant_id:string;payment_id:string;body_sha256:string;claim_token:string;attempt:number;lease_until:Date}>('SELECT * FROM square_webhook.claim($1,$2)',[environment,leaseSeconds]);
   const row=r.rows[0];return row?{environment,eventId:row.event_id,type:row.event_type,merchantId:row.merchant_id,paymentId:row.payment_id,bodySha256:row.body_sha256,claimToken:row.claim_token,attempt:row.attempt,leaseUntil:row.lease_until}:null;
  });
 }
 async settle(claim:InboxClaim,result:ReconcileResult):Promise<boolean>{
  return this.transaction(async c=>(await c.query<{settled:boolean}>('SELECT square_webhook.settle($1,$2,$3,$4,$5,$6) AS settled',[
   claim.environment,claim.eventId,claim.claimToken,result.state,'reason' in result?result.reason:null,'retrySeconds' in result?result.retrySeconds:null,
  ])).rows[0]?.settled===true);
 }
}
