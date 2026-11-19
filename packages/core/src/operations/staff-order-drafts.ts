import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {HoldError} from '../../../contracts/src/hold';
import type {GuestDraft} from '../guest/context';
import type {BookingDraftStore} from '../guest/service';

/** The server-verified staff identity (subject + session id taken from the staff stamp, never from the client). */
export type StaffOrderActor={subject:string;sessionId:string};
type Row=GuestDraft&{session_id:string;customer_profile_id:string|null;closed_at:Date|null};

/** Staff New order drafts (Issue #47 consolidated order §6). The shared booking flow (GuestBookingService) runs on this
 * store exactly as it runs on guest drafts. Every read/change re-checks the live session and permission in the same
 * transaction (ops_assert_actor). A draft belongs to one staff member and one session; another session cannot see it. */
export class StaffOrderDrafts implements BookingDraftStore<StaffOrderActor>{
 readonly draftTable='staff_order_drafts' as const;
 constructor(private pool:Pool){}
 private async tx<T>(actor:StaffOrderActor,permission:'BOOKING_VIEW'|'BOOKING_CREATE',fn:(c:PoolClient)=>Promise<T>):Promise<T>{
  const c=await this.pool.connect();
  try{
   await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='5000ms'");
   await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.session',$2,true)",[actor.subject,actor.sessionId]);
   await c.query("SELECT ops_assert_actor($1,'{}'::text[],$2)",[permission,actor.subject]);
   const v=await fn(c);await c.query('COMMIT');return v;
  }catch(e){await c.query('ROLLBACK').catch(()=>{});if(e instanceof HoldError)throw e;const code=(e as {code?:string}).code;
   if(code==='42501')throw new HoldError('FORBIDDEN',403);if(code==='23505')throw new HoldError('STALE_DRAFT',409);throw e;}
  finally{c.release();}
 }
 private async row(c:Pick<PoolClient,'query'>,actor:StaffOrderActor,lock=false){
  const d=(await c.query<Row>(`SELECT * FROM staff_order_drafts WHERE context_id=$1 AND session_id=$2 AND closed_at IS NULL${lock?' FOR UPDATE':''}`,[actor.subject,actor.sessionId])).rows[0];
  if(!d)throw new HoldError('STAFF_ORDER_REQUIRED',409);return d;
 }
 /** Open this session's draft, creating one if none is open. */
 async open(actor:StaffOrderActor){return this.tx(actor,'BOOKING_CREATE',async c=>{
  const existing=(await c.query<Row>('SELECT * FROM staff_order_drafts WHERE context_id=$1 AND session_id=$2 AND closed_at IS NULL',[actor.subject,actor.sessionId])).rows[0];if(existing)return existing;
  await c.query('INSERT INTO staff_order_drafts(id,context_id,session_id,booking_key) VALUES($1,$2,$3,$4)',[randomUUID(),actor.subject,actor.sessionId,randomUUID()]);return this.row(c,actor);});}
 /** Start a new order: the current draft is closed (a booking it created stays in Orders); a fresh draft is opened. */
 async restart(actor:StaffOrderActor){return this.tx(actor,'BOOKING_CREATE',async c=>{
  await c.query('UPDATE staff_order_drafts SET closed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE context_id=$1 AND session_id=$2 AND closed_at IS NULL',[actor.subject,actor.sessionId]);
  await c.query('INSERT INTO staff_order_drafts(id,context_id,session_id,booking_key) VALUES($1,$2,$3,$4)',[randomUUID(),actor.subject,actor.sessionId,randomUUID()]);return this.row(c,actor);});}
 async read(actor:StaffOrderActor){return this.tx(actor,'BOOKING_VIEW',c=>this.row(c,actor));}
 async change<T>(actor:StaffOrderActor,fn:(c:PoolClient,d:GuestDraft)=>Promise<T>){return this.tx(actor,'BOOKING_CREATE',async c=>fn(c,await this.row(c,actor,true)));}
 customerProfileId(d:GuestDraft){return (d as Row).customer_profile_id??undefined;}
 /** Explicit customer choice (null = new customer). Only a customer with at least one booking this staff member can see,
  * and only before a booking exists. The booking-creation transaction checks it again (0061 trigger). */
 async selectCustomer(actor:StaffOrderActor,draftId:unknown,revision:unknown,customerId:unknown){
  if(typeof draftId!=='string'||!Number.isInteger(revision)||(customerId!==null&&(typeof customerId!=='string'||!/^[0-9a-f-]{36}$/.test(customerId))))throw new HoldError('INVALID_INPUT',422);
  return this.tx(actor,'BOOKING_CREATE',async c=>{
   const d=await this.row(c,actor,true);if(d.id!==draftId||d.revision!==revision)throw new HoldError('STALE_DRAFT',409);if(d.booking_id)throw new HoldError('DRAFT_LOCKED',409);
   if(customerId!==null&&!(await c.query('SELECT 1 FROM customer_booking_links l WHERE l.customer_id=$1 AND customer_booking_visible($2,l.booking_id) LIMIT 1',[customerId,actor.subject])).rowCount)throw new HoldError('FORBIDDEN',403);
   await c.query('UPDATE staff_order_drafts SET customer_profile_id=$2,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1',[d.id,customerId]);return this.row(c,actor);});
 }
}
