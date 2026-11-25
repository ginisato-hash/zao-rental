import {FlowError} from '../../../contracts/src/rental-flow';
import {normalizeBookingRef} from '../../../contracts/src/reservation-qr';
import type {OperationsContext} from './context';
import {ORDER_BASE_SQL,ORDER_ROW_SQL,type OrderRow} from './orders-service';

/** Read-only lookup of a booking by the short number shown on screen (`#` + first 8 hex of the booking id).
 * Never picks among several matches: it returns every candidate (at most CANDIDATE_MAX) and the staff member chooses.
 * Scope is the actor's own stations (BOOKING_VIEW); a booking outside them is indistinguishable from "no such booking".
 * Nothing is written and nothing is confirmed here. */
export const CANDIDATE_MAX=10;
export type BookingCandidate=Pick<OrderRow,'id'|'ref'|'customer'|'status'|'pickupStore'|'returnStore'|'startDate'|'endDate'|'slot'>;
export class BookingRefLookup{
 constructor(private ctx:OperationsContext){}
 async find(raw:unknown):Promise<{ref:string;matches:BookingCandidate[];truncated:boolean}>{
  const ref=normalizeBookingRef(raw);if(!ref)throw new FlowError('INVALID_INPUT',422);
  let disclosed:string[]=[];
  const rows=await this.ctx.light('BOOKING_VIEW',[],async(c,principal)=>{const visible=[...principal.storeIds] as string[];disclosed=visible;
   if(!visible.length)return [] as OrderRow[];
   const today=jst((await c.query('SELECT inventory_clock() AS now')).rows[0].now as Date);
   return (await c.query(`${ORDER_BASE_SQL} SELECT ${ORDER_ROW_SQL} v FROM s WHERE upper(s.id::text) LIKE $3||'%' ORDER BY s.created_at DESC,s.id LIMIT ${CANDIDATE_MAX+1}`,[visible,today,ref])).rows.map(r=>r.v as OrderRow);
  });
  await this.ctx.confirmScope('BOOKING_VIEW',disclosed);
  const matches=rows.slice(0,CANDIDATE_MAX).map(r=>({id:r.id,ref:r.ref,customer:r.customer,status:r.status,pickupStore:r.pickupStore,returnStore:r.returnStore,startDate:r.startDate,endDate:r.endDate,slot:r.slot}));
  return {ref,matches,truncated:rows.length>CANDIDATE_MAX};
 }
}
const jst=(d:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(d);
