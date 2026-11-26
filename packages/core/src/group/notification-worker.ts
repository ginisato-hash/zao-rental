import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {loadStaff} from '../../../auth/src/staff-auth';
import {FlowError,flowId} from '../../../contracts/src/rental-flow';
import {GroupError} from '../../../contracts/src/group-order';
import {safeDeliveryResult,type BookingNotificationDelivery,type DeliveryResult} from '../notification/contracts';
import {renderGroupNotification,defaultGroupLink,type GroupLinkBuilder,type GroupNotificationEvent,type GroupNotificationMaterial} from './notification-template';

/** Delivery of `group_notification_outbox` rows (created by the state-commit transaction itself, see GROUP_INVITE_CORE.md).
 * Same reservation / settlement model as BookingNotificationWorker, on the group tables, in the group application role:
 *  - the state commit never waits for or depends on delivery (the row already exists; delivery failure cannot undo it);
 *  - a row is leased with FOR UPDATE; two workers cannot send the same row;
 *  - only an authoritative NOT_ACCEPTED is retried; an unknown outcome stays UNKNOWN and is never re-sent (lookup only);
 *  - a notice is never delivered after a newer state exists for the group (SUPPRESSED, checked at claim and again after the
 *    lease, immediately before the provider call) and a newer notice is not sent while an older one is still in flight. */
type Row={id:string;group_id:string;event_id:string;event_type:GroupNotificationEvent;dedupe_key:string;locale:'ja'|'en';admin_message:string|null;status:string;attempt_count:number;next_attempt_at:Date|null;claim_id:string|null;claim_until:Date|null;last_safe_failure_code:string};
const EMAIL=/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/;
/** State the group must still be in for each notice to be true when read. */
const EXPECTED:Record<GroupNotificationEvent,string>={GROUP_REVIEW_HELD:'REVIEW_HELD',GROUP_CONFIRMED:'CONFIRMED',GROUP_CHANGES_REQUESTED:'CHANGES_REQUESTED',GROUP_RELEASED:'RELEASED',GROUP_CANCELLED:'CANCELLED'};
type Settle=DeliveryResult|{state:'SUPPRESSED';code:'NONE'|'TEMPLATE_UNAVAILABLE'|'RECIPIENT_UNAVAILABLE'};
type Material={recipient:string;material:GroupNotificationMaterial}|{stale:true};

export class GroupNotificationWorker{
 /** `adapter` has no default: without one nothing is claimed and nothing is sent (status UNCONNECTED). */
 constructor(private pool:Pool,private origin:string,private adapter?:BookingNotificationDelivery,private timeoutMs=5000,private link:GroupLinkBuilder=defaultGroupLink){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new FlowError('NOTIFICATION_CONFIGURATION_INVALID',503);
 }
 status(){return this.adapter?'CONFIGURED':'GROUP_DELIVERY_UNCONNECTED';}
 private async tx<T>(fn:(c:PoolClient)=>Promise<T>):Promise<T>{
  const c=await this.pool.connect();
  try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='3000ms'; SET LOCAL statement_timeout='10000ms'");const v=await fn(c);await c.query('COMMIT');return v;}
  catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
 }
 private async bounded(call:(signal:AbortSignal)=>Promise<DeliveryResult>){const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;try{return safeDeliveryResult(await Promise.race([call(controller.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error());},this.timeoutMs);})]));}catch{return {state:'UNKNOWN'} as const;}finally{clearTimeout(timer);}}

 /** Ids due now, oldest group event first (so an older notice of a group is attempted before a newer one). */
 async due(limit=20){
  const n=Math.max(0,Math.min(100,Math.trunc(limit)));
  return (await this.pool.query<{id:string;action:'SEND'|'LOOKUP'}>(`SELECT id,CASE WHEN status IN ('UNKNOWN','SENDING') THEN 'LOOKUP' ELSE 'SEND' END action FROM group_notification_outbox
   WHERE (status IN ('PENDING','RETRYABLE_FAILURE') AND next_attempt_at<=clock_timestamp()) OR (status='UNKNOWN' AND (next_attempt_at IS NULL OR next_attempt_at<=clock_timestamp())) OR (status='SENDING' AND claim_until<=clock_timestamp())
   ORDER BY event_id LIMIT $1`,[n])).rows;
 }
 private async claim(id:string):Promise<{claimId:string;dedupeKey:string}|{suppressed:true}|null>{
  return this.tx(async c=>{
   const o=(await c.query<Row>('SELECT * FROM group_notification_outbox WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!o)return null;
   const now=(await c.query<{t:Date}>('SELECT clock_timestamp() t')).rows[0]!.t;
   if(o.status==='SENDING'&&o.claim_until&&o.claim_until<=now){await c.query("UPDATE group_notification_outbox SET status='UNKNOWN',last_safe_failure_code='ACCEPTANCE_UNKNOWN',claim_id=NULL,claim_until=NULL,next_attempt_at=NULL WHERE id=$1",[o.id]);return null;}
   if(!['PENDING','RETRYABLE_FAILURE'].includes(o.status)||o.attempt_count>=3||!o.next_attempt_at||o.next_attempt_at>now)return null;
   // A newer notice exists: this one describes a state the group has already left.
   if((await c.query('SELECT 1 FROM group_notification_outbox WHERE group_id=$1 AND event_id>$2 LIMIT 1',[o.group_id,o.event_id])).rowCount){
    await c.query("UPDATE group_notification_outbox SET status='SUPPRESSED',next_attempt_at=NULL WHERE id=$1",[o.id]);return {suppressed:true as const};
   }
   // An older notice of this group is still in flight: wait, so the older text can never arrive after this newer one.
   if((await c.query("SELECT 1 FROM group_notification_outbox WHERE group_id=$1 AND event_id<$2 AND status='SENDING' AND claim_until>$3 LIMIT 1",[o.group_id,o.event_id,now])).rowCount)return null;
   const r=(await c.query<{claim_id:string}>("UPDATE group_notification_outbox SET status='SENDING',attempt_count=attempt_count+1,claim_id=gen_random_uuid(),claim_until=clock_timestamp()+interval '1 minute',next_attempt_at=NULL,last_safe_failure_code='NONE' WHERE id=$1 RETURNING claim_id",[o.id])).rows[0]!;
   return {claimId:r.claim_id,dedupeKey:o.dedupe_key};
  });
 }
 /** Materializes the mail from the canonical rows, inside the lease and immediately before the provider call. */
 private async material(id:string,claimId:string):Promise<Material|null>{
  return this.tx(async c=>{
   const o=(await c.query<Row>("SELECT * FROM group_notification_outbox WHERE id=$1 AND status='SENDING' AND claim_id=$2 AND claim_until>clock_timestamp()",[id,claimId])).rows[0];if(!o)return null;
   const g=(await c.query<{id:string;group_number:string;status:string;member_count:number;period:GroupNotificationMaterial['period'];pickup_store:string;return_store:string;contact_email:string}>('SELECT id,group_number,status,member_count,period,pickup_store,return_store,contact_email FROM group_orders WHERE id=$1',[o.group_id])).rows[0];
   if(!g)return null;
   const newer=(await c.query('SELECT 1 FROM group_notification_outbox WHERE group_id=$1 AND event_id>$2 LIMIT 1',[o.group_id,o.event_id])).rowCount;
   if(newer||g.status!==EXPECTED[o.event_type])return {stale:true as const};
   const ev=(await c.query<{payload:Record<string,unknown>;occurred_at:Date}>('SELECT payload,occurred_at FROM group_events WHERE id=$1',[o.event_id])).rows[0]!;
   const m:GroupNotificationMaterial={event:o.event_type,locale:o.locale,groupId:g.id,groupNumber:g.group_number,memberCount:g.member_count,period:g.period,pickupStore:g.pickup_store,returnStore:g.return_store,adminMessage:o.admin_message};
   if(o.event_type==='GROUP_REVIEW_HELD'){
    const q=(await c.query<{total_jpy:string}>("SELECT total_jpy FROM group_quotes WHERE group_id=$1 AND kind='ESTIMATE' AND created_at<=$2 ORDER BY version DESC LIMIT 1",[g.id,ev.occurred_at])).rows[0];
    m.estimateJpy=q?Number(q.total_jpy):null;
   }else if(o.event_type==='GROUP_CONFIRMED'){
    const p=ev.payload;m.confirmed={subtotalJpy:Number(p.subtotalJpy),discountJpy:Number(p.discountJpy),totalJpy:Number(p.totalJpy)};
   }else if(o.event_type==='GROUP_CANCELLED')m.receivedJpyNeedsManual=Number(ev.payload.receivedJpyNeedsManualRefund??0);
   return {recipient:g.contact_email,material:m};
  });
 }
 private async settle(id:string,claimId:string,r:Settle){
  return this.tx(async c=>{
   const o=(await c.query<Row>('SELECT * FROM group_notification_outbox WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!o||o.status!=='SENDING'||o.claim_id!==claimId)return false;
   let status:string,code:string,provider:string|null=null;
   if(r.state==='ACCEPTED'&&/^[-A-Za-z0-9_]{1,128}$/.test(r.providerMessageId)){status='SENT';code='NONE';provider=r.providerMessageId;}
   else if(r.state==='NOT_ACCEPTED'){const last=o.attempt_count>=3;status=last?'PERMANENT_FAILURE':'RETRYABLE_FAILURE';code=last?'RETRY_EXHAUSTED':r.code;}
   else if(r.state==='REJECTED'){status='PERMANENT_FAILURE';code='PERMANENT_REJECT';}
   else if(r.state==='SUPPRESSED'){status='SUPPRESSED';code=r.code;}
   else{status='UNKNOWN';code='ACCEPTANCE_UNKNOWN';}
   await c.query(`UPDATE group_notification_outbox SET status=$2,claim_id=NULL,claim_until=NULL,provider_message_id=$3,sent_at=CASE WHEN $2='SENT' THEN clock_timestamp() END,
    next_attempt_at=CASE WHEN $2='RETRYABLE_FAILURE' THEN clock_timestamp()+(power(2,attempt_count)*interval '1 minute') WHEN $2='UNKNOWN' THEN clock_timestamp()+interval '1 minute' END,last_safe_failure_code=$4 WHERE id=$1`,[id,status,provider,code]);
   return true;
  });
 }
 async dispatch(id:string){
  flowId(id);if(!this.adapter)return {state:'UNCONNECTED' as const};
  const claim=await this.claim(id);if(!claim)return {state:'NOT_CLAIMED' as const};if('suppressed' in claim)return {state:'SUPPRESSED' as const};
  const done=async(r:Settle)=>({state:(await this.settle(id,claim.claimId,r))?r.state:'UNKNOWN' as string});
  // An error before materialization cannot have reached the provider; the expired lease later becomes lookup-only UNKNOWN.
  const m=await this.material(id,claim.claimId);if(!m)return done({state:'SUPPRESSED',code:'NONE'});
  if('stale' in m)return done({state:'SUPPRESSED',code:'NONE'});
  if(typeof m.recipient!=='string'||m.recipient.length>254||!EMAIL.test(m.recipient))return done({state:'SUPPRESSED',code:'RECIPIENT_UNAVAILABLE'});
  let body:{subject:string;text:string;html:string};
  try{body=renderGroupNotification(m.material,this.origin,this.link);}catch{return done({state:'SUPPRESSED',code:'TEMPLATE_UNAVAILABLE'});}
  const result=await this.bounded(signal=>this.adapter!.send({idempotencyKey:createHash('sha256').update(claim.dedupeKey).digest('hex'),eventType:m.material.event as never,recipient:m.recipient,locale:m.material.locale,...body},signal));
  return done(result);
 }
 /** UNKNOWN / expired lease: lookup only. Nothing here can authorize another send. */
 async reconcile(id:string){
  flowId(id);if(!this.adapter)return {state:'UNCONNECTED' as const};
  const key=await this.tx(async c=>{
   const o=(await c.query<Row>('SELECT * FROM group_notification_outbox WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!o)return null;
   const now=(await c.query<{t:Date}>('SELECT clock_timestamp() t')).rows[0]!.t;
   let status=o.status;
   if(status==='SENDING'&&o.claim_until&&o.claim_until<=now){await c.query("UPDATE group_notification_outbox SET status='UNKNOWN',claim_id=NULL,claim_until=NULL,last_safe_failure_code='ACCEPTANCE_UNKNOWN' WHERE id=$1",[id]);status='UNKNOWN';}
   if(status==='UNKNOWN'&&(!o.next_attempt_at||o.next_attempt_at<=now)){await c.query("UPDATE group_notification_outbox SET next_attempt_at=clock_timestamp()+interval '10 minutes' WHERE id=$1",[id]);return o.dedupe_key;}
   return null;
  });
  if(!key)return {state:'NOT_UNKNOWN' as const};
  if(!this.adapter.lookup)return {state:'UNKNOWN' as const};
  const result=await this.bounded(signal=>this.adapter!.lookup!(createHash('sha256').update(key).digest('hex'),signal));
  if(result.state==='ACCEPTED'){await this.pool.query("UPDATE group_notification_outbox SET status='SENT',sent_at=clock_timestamp(),provider_message_id=$2,next_attempt_at=NULL,last_safe_failure_code='NONE' WHERE id=$1 AND status='UNKNOWN'",[id,result.providerMessageId]);return {state:'SENT' as const};}
  return {state:'UNKNOWN' as const};
 }
 /** One bounded pass (the connection point for the production tick is in docs/execution/GROUP_NOTIFICATIONS.md). */
 async runBatch(limit=20,deadline=new Date(Date.now()+30000)){
  if(!this.adapter)return {state:'UNCONNECTED' as const,processed:0};
  let processed=0;
  for(const row of await this.due(limit)){if(Date.now()>=deadline.getTime())break;if(row.action==='LOOKUP')await this.reconcile(row.id);else await this.dispatch(row.id);processed++;}
  return {state:'PROCESSED' as const,processed};
 }
}

export type GroupDeliveryItem={id:string;eventType:GroupNotificationEvent;revision:number;status:string;attemptCount:number;nextAttemptAt:string|null;sentAt:string|null;createdAt:string;lastSafeFailureCode:string;
 /** Never delivered because a newer state superseded it (a deliberate, correct outcome). */
 superseded:boolean;
 /** Provider outcome unknown: the delivery is only ever verified by lookup, never re-sent. */
 needsReconcile:boolean};
const asItem=(r:Record<string,unknown>):GroupDeliveryItem=>({id:String(r.id),eventType:r.event_type as GroupNotificationEvent,revision:Number(r.revision),status:String(r.status),attemptCount:Number(r.attempt_count),
 nextAttemptAt:r.next_attempt_at?new Date(r.next_attempt_at as Date).toISOString():null,sentAt:r.sent_at?new Date(r.sent_at as Date).toISOString():null,createdAt:new Date(r.created_at as Date).toISOString(),lastSafeFailureCode:String(r.last_safe_failure_code),
 superseded:r.status==='SUPPRESSED'&&r.last_safe_failure_code==='NONE',needsReconcile:r.status==='UNKNOWN'||(r.status==='SENDING'&&new Date(r.claim_until as Date).getTime()<=Date.now())});

/** Read-only delivery status for the administrator screens (C2 renders it). ADMIN + GROUP_VIEW + store scope, re-read in the
 * same read transaction. No recipient address, body or provider payload is returned. */
export class GroupNotificationStatus{
 constructor(private pool:Pool){}
 private async auth(c:Pick<PoolClient,'query'>,staff:{subject:string;revision:number},stores:string[]){
  const p=await loadStaff(c,staff.subject);
  if(!p||p.revision!==staff.revision||p.role!=='ADMIN'||!(p.permissions as string[]).includes('GROUP_VIEW')||stores.some(s=>!(p.storeIds as string[]).includes(s)))throw new GroupError('FORBIDDEN',403);
  return p;
 }
 private async read<T>(fn:(c:PoolClient)=>Promise<T>){const c=await this.pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const v=await fn(c);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 /** Delivery history of one parent group, oldest first. */
 async forGroup(staff:{subject:string;revision:number},groupId:string):Promise<{groupId:string;items:GroupDeliveryItem[]}>{
  return this.read(async c=>{
   const g=(await c.query<{pickup_store:string;return_store:string}>('SELECT pickup_store,return_store FROM group_orders WHERE id=$1',[(flowId(groupId),groupId)])).rows[0];if(!g)throw new GroupError('NOT_FOUND',404);
   await this.auth(c,staff,[g.pickup_store,g.return_store]);
   const rows=(await c.query(`SELECT o.id,o.event_type,e.revision,o.status,o.attempt_count,o.next_attempt_at,o.sent_at,o.created_at,o.last_safe_failure_code,o.claim_until FROM group_notification_outbox o JOIN group_events e ON e.id=o.event_id WHERE o.group_id=$1 ORDER BY o.event_id`,[groupId])).rows;
   return {groupId,items:rows.map(asItem)};
  });
 }
 /** Deliveries that need a person: unknown outcome, retry pending/exhausted, permanent failure, unusable template/recipient. Parent level. */
 async needingAttention(staff:{subject:string;revision:number},stores:string[],limit=50){
  return this.read(async c=>{
   if(!stores.length)throw new GroupError('FORBIDDEN',403);await this.auth(c,staff,stores);
   const rows=(await c.query(`SELECT o.id,o.group_id,g.group_number,o.event_type,e.revision,o.status,o.attempt_count,o.next_attempt_at,o.sent_at,o.created_at,o.last_safe_failure_code,o.claim_until FROM group_notification_outbox o JOIN group_orders g ON g.id=o.group_id JOIN group_events e ON e.id=o.event_id
    WHERE g.pickup_store=ANY($1::text[]) AND g.return_store=ANY($1::text[]) AND (o.status IN ('UNKNOWN','RETRYABLE_FAILURE','PERMANENT_FAILURE') OR (o.status='SUPPRESSED' AND o.last_safe_failure_code<>'NONE') OR (o.status='SENDING' AND o.claim_until<=clock_timestamp()))
    ORDER BY o.created_at DESC,o.id LIMIT $2`,[stores,Math.max(1,Math.min(200,Math.trunc(limit)))])).rows;
   return rows.map(r=>({groupId:String(r.group_id),groupNumber:String(r.group_number),...asItem(r)}));
  });
 }
}
