import {FlowError,flowObject} from '../../../contracts/src/rental-flow';
import {utcDate} from '../../../contracts/src/hold';
import type {OperationsContext} from './context';
import {ORDER_BASE_SQL,ORDER_ROW_SQL,type OrderRow} from './orders-service';

// Day-level sales stop (Owner request 2026-11-22, mainly temporary closure). Staff choose a date range and one or both
// stations and stop or release every day in it at once. A booking whose period touches a stopped day at its pickup or
// return station is refused for the public (HoldService); staff New order shows a warning and may continue. Existing
// bookings are never changed: the screen lists the ones that touch a stopped day so staff can contact them.
export const SALES_STOP_STORES=['MOUNTAIN_BASE','ONSEN_BASE'] as const;
export const SALES_STOP_MAX_DAYS=366;
export type SalesStop={store:string;day:string;reason:string;createdBy:string;createdAt:string};
export type SalesStopHistory={store:string;day:string;action:'STOP'|'RELEASE';reason:string;actor:string;occurredAt:string};
/** `affected` is null when the viewer may not see bookings (no BOOKING_VIEW): the screen says so instead of "none". Otherwise it is
 * one page of the affected bookings; `affectedTotal` counts all of them so nothing is silently cut off (PR74-AUTH-01, PR74-UI-02). */
export type SalesStopView={from:string;to:string;stores:string[];stops:SalesStop[];bookingView:boolean;affected:(OrderRow&{stoppedDays:string[]})[]|null;
 affectedTotal:number|null;affectedPage:number;affectedPageSize:number;history:SalesStopHistory[];canEdit:boolean};
const jstToday=(now:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(now);
const addDays=(date:string,n:number)=>{const t=new Date(date+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
const span=(from:string,to:string)=>Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000);
function day(v:unknown){if(typeof v!=='string')throw new FlowError('INVALID_INPUT',422);try{utcDate(v);}catch{throw new FlowError('INVALID_INPUT',422);}return v;}
function stores(v:unknown,allowed:readonly string[]){
 if(!Array.isArray(v)||!v.length||v.length>SALES_STOP_STORES.length||v.some(s=>typeof s!=='string'||!(SALES_STOP_STORES as readonly string[]).includes(s))||new Set(v).size!==v.length)throw new FlowError('INVALID_INPUT',422);
 if(v.some(s=>!allowed.includes(s)))throw new FlowError('FORBIDDEN',403);return [...v].sort() as string[];
}
// Bookings that still matter to a customer: not drafts, cancellations or finished rentals.
const OPEN_SQL="s.status NOT IN ('DRAFT','CANCELED','COMPLETED','RETURNED','NO_PICKUP')";
export const AFFECTED_PAGE_SIZE=100;
const MAX_PAGE=10000;
function page(v:unknown){if(v===undefined)return 1;if(typeof v!=='string'||!/^[1-9][0-9]{0,4}$/.test(v)||Number(v)>MAX_PAGE)throw new FlowError('INVALID_INPUT',422);return Number(v);}

export class SalesStopService{
 constructor(private ctx:OperationsContext){}
 /** Stops, affected open bookings and recent history for the stations the viewer may see (default: today + 120 days). */
 async view(query:{from?:string|undefined;to?:string|undefined;page?:string|undefined}={}):Promise<SalesStopView>{
  const pageNo=page(query.page);
  const principal=await this.ctx.authorize('INVENTORY_VIEW');const visible=(principal.storeIds as string[]).filter(s=>(SALES_STOP_STORES as readonly string[]).includes(s)).sort();
  const view=await this.ctx.snapshot('INVENTORY_VIEW',visible,async(c,p)=>{
   const now=(await c.query<{now:Date}>('SELECT inventory_clock() AS now')).rows[0]!.now,today=jstToday(now);
   const from=query.from?day(query.from):today,to=query.to?day(query.to):addDays(from,120);
   if(to<from||span(from,to)>SALES_STOP_MAX_DAYS)throw new FlowError('INVALID_INPUT',422);
   const stops=(await c.query<SalesStop>(`SELECT store_id store,to_char(day,'YYYY-MM-DD') "day",reason,created_by "createdBy",created_at "createdAt" FROM store_sales_stops
    WHERE store_id=ANY($1::text[]) AND day BETWEEN $2::date AND $3::date ORDER BY day,store_id`,[visible,from,to])).rows;
   // Bookings (customer name, email, status, amount) are disclosed only under BOOKING_VIEW, as on the Orders screen.
   const bookingView=p.permissions.includes('BOOKING_VIEW');let affected:SalesStopView['affected']=null,affectedTotal:number|null=null;
   if(bookingView){
    const hit=`(x.store_id=s.pickup_store OR x.store_id=s.return_store) AND x.store_id=ANY($1::text[]) AND x.day BETWEEN greatest(s.start_date,$3::date) AND least(s.end_date,$4::date)`;
    const where=`${OPEN_SQL} AND s.start_date<=$4::date AND s.end_date>=$3::date AND EXISTS(SELECT 1 FROM store_sales_stops x WHERE ${hit})`;
    affectedTotal=Number((await c.query<{n:number}>(`${ORDER_BASE_SQL} SELECT count(*)::int n FROM s WHERE ${where}`,[visible,today,from,to])).rows[0]!.n);
    affected=(await c.query<{row:OrderRow;stopped:string[]}>(`${ORDER_BASE_SQL}
     SELECT ${ORDER_ROW_SQL} AS row,ARRAY(SELECT DISTINCT to_char(x.day,'YYYY-MM-DD') FROM store_sales_stops x WHERE ${hit} ORDER BY 1) AS stopped
     FROM s WHERE ${where} ORDER BY s.start_date,s.created_at,s.id LIMIT ${AFFECTED_PAGE_SIZE} OFFSET $5`,[visible,today,from,to,(pageNo-1)*AFFECTED_PAGE_SIZE])).rows.map(r=>({...r.row,stoppedDays:r.stopped}));
   }
   const history=(await c.query<SalesStopHistory>(`SELECT store_id store,to_char(day,'YYYY-MM-DD') "day",action,reason,actor,occurred_at "occurredAt" FROM store_sales_stop_history
    WHERE store_id=ANY($1::text[]) ORDER BY id DESC LIMIT 50`,[visible])).rows;
   return {from,to,stores:visible,stops,bookingView,affected,affectedTotal,affectedPage:pageNo,affectedPageSize:AFFECTED_PAGE_SIZE,history,canEdit:p.permissions.includes('INVENTORY_EDIT')};
  });
  // snapshot() re-checked INVENTORY_VIEW and the stations after the read; bookings additionally need BOOKING_VIEW to still hold
  // now, so a permission removed while the read ran refuses the response instead of returning customer data.
  if(view.bookingView)await this.ctx.confirmScope('BOOKING_VIEW',visible);
  return view;
 }
 /** Stop (stop=true) or release every day from..to at the chosen stations at once. Idempotent per request key. */
 async set(requestKey:string,input:unknown){
  const v=flowObject(input,['stores','from','to','stop','reason']);
  const principal=await this.ctx.authorize('INVENTORY_EDIT');
  const chosen=stores(v.stores,principal.storeIds as string[]),from=day(v.from),to=day(v.to);
  if(typeof v.stop!=='boolean')throw new FlowError('INVALID_INPUT',422);
  if(typeof v.reason!=='string'||!v.reason.trim()||v.reason.trim().length>160)throw new FlowError('REASON_REQUIRED',422);
  if(to<from||span(from,to)>=SALES_STOP_MAX_DAYS)throw new FlowError('INVALID_INPUT',422);
  const reason=v.reason.trim();
  return this.ctx.transaction('INVENTORY_EDIT',chosen,'SALES_STOP',async c=>this.ctx.idempotent(c,requestKey,{stores:chosen,from,to,stop:v.stop,reason},async()=>{
   const changed=Number((await c.query<{n:number}>('SELECT store_sales_stop_set($1::text[],$2::date,$3::date,$4,$5) AS n',[chosen,from,to,v.stop,reason])).rows[0]!.n);
   return {changed,stores:chosen,from,to,stop:v.stop as boolean};
  }));
 }
}
