import type {PoolClient} from 'pg';
import {loadStaff,type StaffPrincipal} from './staff-auth';
import {HoldError} from '../../contracts/src/hold';
export type GuestActor={kind:'GUEST';subject:string;contextId:string;tokenHash:string};
export type BookingActor=StaffPrincipal|GuestActor;
export function isGuest(actor:BookingActor|{subject:string}):actor is GuestActor{return 'kind' in actor&&actor.kind==='GUEST';}
const guestOperations=new Set(['HOLD_VIEW','HOLD_EDIT','QUOTE_VIEW','QUOTE_CREATE','BOOKING_VIEW','BOOKING_CREATE']);
/** Distinct capability, never a staff role. Callers retain all owner and stock guards. */
export async function authorizeBookingActor(c:Pick<PoolClient,'query'>,actor:BookingActor,operations:string[],stores:string[]=[]):Promise<{subject:string;storeIds:string[]}>{
 if(isGuest(actor)){
  if(operations.some(p=>!guestOperations.has(p))||stores.some(s=>!['MOUNTAIN_BASE','ONSEN_BASE'].includes(s)))throw new HoldError('FORBIDDEN',403);
  const ok=(await c.query(`SELECT 1 FROM guest_contexts g JOIN booking_actors a ON a.id=g.actor_id WHERE g.id=$1 AND g.actor_id=$2 AND g.token_sha256=$3 AND g.revoked_at IS NULL AND g.expires_at>inventory_clock() AND a.kind='GUEST'`,[actor.contextId,actor.subject,actor.tokenHash])).rowCount;
  if(!ok)throw new HoldError('GUEST_CONTEXT_EXPIRED',401);
  return {subject:actor.subject,storeIds:['MOUNTAIN_BASE','ONSEN_BASE']};
 }
 const p=await loadStaff(c,actor.subject);
 if(!p||p.revision!==actor.revision||operations.some(v=>!p.permissions.includes(v as never))||stores.some(s=>!p.storeIds.includes(s as never))||operations.includes('PRICE_EDIT')&&(p.role!=='ADMIN'||p.scope!=='ALL'))throw new HoldError('FORBIDDEN',403);
 return {subject:p.subject,storeIds:p.storeIds};
}
