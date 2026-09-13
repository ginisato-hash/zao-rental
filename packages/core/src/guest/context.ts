import {randomBytes,randomUUID,createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {authorizeBookingActor,type GuestActor} from '../../../auth/src/booking-actor';
import {HoldError} from '../../../contracts/src/hold';
export const GUEST_COOKIE='zao_guest';
export const DEVELOPMENT_CONTEXT_SECONDS=86400;
export type GuestDraft={id:string;context_id:string;revision:number;input:unknown;preview_key:string|null;preview_id:string|null;selection:unknown;selection_key:string|null;booking_key:string;booking_id:string|null};
const hash=(token:string)=>createHash('sha256').update(token).digest('hex');
export class GuestContexts{
 constructor(readonly pool:Pool){}
 async create(){const c=await this.pool.connect();try{await c.query('BEGIN');const now=(await c.query<{now:Date}>('SELECT inventory_clock() now')).rows[0]!.now,id=randomUUID(),subject='guest_'+id,token=randomBytes(32).toString('base64url'),expiresAt=new Date(now.getTime()+DEVELOPMENT_CONTEXT_SECONDS*1000);
  await c.query("INSERT INTO booking_actors VALUES($1,'GUEST')",[subject]);await c.query('INSERT INTO guest_contexts(id,actor_id,token_sha256,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[id,subject,hash(token),now,expiresAt]);await c.query('INSERT INTO guest_drafts(id,context_id,booking_key) VALUES($1,$2,$3)',[randomUUID(),id,randomUUID()]);await c.query('COMMIT');return {token,expiresAt};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async resolve(token:string|undefined):Promise<GuestActor>{if(!token||!/^[-_A-Za-z0-9]{43}$/.test(token))throw new HoldError('GUEST_CONTEXT_REQUIRED',401);const tokenHash=hash(token),row=(await this.pool.query('SELECT id,actor_id FROM guest_contexts WHERE token_sha256=$1 AND revoked_at IS NULL AND expires_at>inventory_clock()',[tokenHash])).rows[0];if(!row)throw new HoldError('GUEST_CONTEXT_EXPIRED',401);return {kind:'GUEST',subject:row.actor_id,contextId:row.id,tokenHash};}
 async read(actor:GuestActor,c:Pick<PoolClient,'query'>=this.pool):Promise<GuestDraft>{await authorizeBookingActor(c,actor,['BOOKING_VIEW']);const d=(await c.query<GuestDraft>('SELECT * FROM guest_drafts WHERE context_id=$1',[actor.contextId])).rows[0];if(!d)throw new HoldError('GUEST_CONTEXT_REQUIRED',401);return d;}
 async change<T>(actor:GuestActor,fn:(c:PoolClient,d:GuestDraft)=>Promise<T>){const c=await this.pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='5000ms'");await authorizeBookingActor(c,actor,['BOOKING_CREATE']);await c.query('SELECT 1 FROM guest_contexts WHERE id=$1 FOR UPDATE',[actor.contextId]);const d=await this.read(actor,c);const v=await fn(c,d);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async revoke(actor:GuestActor){const c=await this.pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(71820600)');await authorizeBookingActor(c,actor,['BOOKING_VIEW']);await c.query('UPDATE guest_contexts SET revoked_at=inventory_clock() WHERE id=$1',[actor.contextId]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
}
export function guestToken(headers:Headers){const pairs=(headers.get('cookie')??'').split(';').map(s=>s.trim().split('='));const matches=pairs.filter(p=>p[0]===GUEST_COOKIE);return matches.length===1?matches[0]![1]:undefined;}
export function guestCookie(token:string,secure:boolean,remove=false){return `${GUEST_COOKIE}=${remove?'':token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${remove?0:DEVELOPMENT_CONTEXT_SECONDS}${secure?'; Secure':''}`;}
