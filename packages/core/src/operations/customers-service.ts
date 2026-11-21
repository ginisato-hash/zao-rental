import {FlowError,flowId} from '../../../contracts/src/rental-flow';
import type {OperationsContext} from './context';
import {EXPORT_MAX,exportBound} from './exports';
import {ORDER_BASE_SQL,ORDER_ROW_SQL,type OrderRow} from './orders-service';

// Customers (Issue #47 consolidated order §5): a read projection over VISIBLE bookings only, plus one explicit link
// operation for unlinked legacy bookings. A customer key is a profile id, or `legacy:<booking id>` for a booking created
// before 0061 that has never been linked. Names, contacts and counts come only from bookings this staff member can see,
// so another station's bookings never leak through a shared profile.
const LEGACY=/^legacy:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VISIBLE=`WITH v AS (
 SELECT r.id,r.contact,r.created_at,coalesce((h.conditions->'period'->>'startDate'),(r.conditions->'period'->>'startDate'))::date start_date,
  coalesce(l.customer_id::text,'legacy:'||r.id) key,l.customer_id
 FROM rental_bookings r LEFT JOIN inventory_holds h ON h.id=r.hold_id LEFT JOIN customer_booking_links l ON l.booking_id=r.id
 WHERE coalesce(h.pickup_store,r.conditions->>'pickupStore')=ANY($1::text[]) OR coalesce(h.return_store,r.conditions->>'returnStore')=ANY($1::text[]))`;
const jstToday=(now:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(now);

export class CustomersService{
 constructor(private ctx:OperationsContext){}

 /** Booqable Customers list: search, server total and paging. One row per customer key, built from visible bookings. */
 async list(q:{search?:unknown;page?:unknown;pageSize?:unknown},opts:{all?:boolean}={}){
  let disclosed:string[]=[];const search=typeof q.search==='string'?q.search.trim().slice(0,80).replace(/[%_\\]/g,m=>'\\'+m):'';
  // opts.all (CSV export): every customer matching the search in one snapshot; over EXPORT_MAX the export is refused.
  const page=opts.all?1:q.page===undefined?1:Number(q.page),size=opts.all?EXPORT_MAX:q.pageSize===undefined?25:Number(q.pageSize);
  if(!opts.all&&(!Number.isInteger(page)||page<1||page>10000||!Number.isInteger(size)||size<1||size>100))throw new FlowError('INVALID_INPUT',422);
  const out=await this.ctx.snapshot('BOOKING_VIEW',[],async(c,principal)=>{const stores=[...principal.storeIds] as string[];disclosed=stores;
   const grouped=`${VISIBLE}, g AS (SELECT v.key,(array_agg(v.contact->>'displayName' ORDER BY v.created_at DESC))[1] name,(array_agg(v.contact->>'email' ORDER BY v.created_at DESC))[1] email,
     count(*)::int bookings,max(v.start_date)::text last_start,bool_and(v.customer_id IS NULL) legacy FROM v GROUP BY v.key)`;
   const where=`WHERE $2='' OR g.name ILIKE '%'||$2||'%' OR g.email ILIKE '%'||$2||'%'`;
   const total=Number((await c.query(`${grouped} SELECT count(*)::int n FROM g ${where}`,[stores,search])).rows[0].n);if(opts.all)exportBound(total);
   const rows=(await c.query(`${grouped} SELECT g.key,g.name,g.email,g.bookings,g.last_start "lastStart",g.legacy FROM g ${where} ORDER BY g.last_start DESC NULLS LAST,g.key LIMIT ${size} OFFSET ${(page-1)*size}`,[stores,search])).rows;
   return {total,page,pageSize:size,rows};
  });
  await this.ctx.confirmScope('BOOKING_VIEW',disclosed);return out;
 }

 /** Customer detail: visible bookings of the profile (or the single legacy booking). A legacy key whose booking has since
  * been linked resolves to its current profile (still subject to visibility). */
 async detail(key:unknown){
  if(typeof key!=='string'||!(LEGACY.test(key)||UUID.test(key)))throw new FlowError('INVALID_INPUT',422);
  let disclosed:string[]=[];
  const out=await this.ctx.snapshot('BOOKING_VIEW',[],async(c,principal)=>{const stores=[...principal.storeIds] as string[];disclosed=stores;
   let resolved=key;const legacy=LEGACY.exec(key);
   if(legacy){const linked=(await c.query('SELECT customer_id FROM customer_booking_links WHERE booking_id=$1',[legacy[1]])).rows[0];if(linked)resolved=linked.customer_id;}
   const ids=(await c.query(`${VISIBLE} SELECT v.id FROM v WHERE v.key=$2 ORDER BY v.start_date DESC,v.id`,[stores,resolved])).rows.map(r=>r.id as string);
   if(!ids.length)throw new FlowError('NOT_FOUND',404);
   const today=jstToday((await c.query('SELECT inventory_clock() AS now')).rows[0].now);
   const orders=(await c.query(`${ORDER_BASE_SQL} SELECT ${ORDER_ROW_SQL} v FROM s WHERE s.id=ANY($3::uuid[]) ORDER BY s.start_date DESC,s.id`,[stores,today,ids])).rows.map(r=>r.v as OrderRow);
   const latest=orders.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]!;
   return {key:resolved,requestedKey:key,legacy:resolved.startsWith('legacy:'),name:latest.customer,email:latest.email,orders};
  });
  await this.ctx.confirmScope('BOOKING_VIEW',disclosed);return out;
 }

 /** Link an unlinked legacy booking to the customer of another visible booking or profile. Idempotent per request key. */
 async link(requestKey:unknown,input:{bookingId:unknown;target:unknown}){
  if(typeof requestKey!=='string')throw new FlowError('INVALID_INPUT',422);flowId(requestKey);
  if(typeof input.bookingId!=='string'||!UUID.test(input.bookingId))throw new FlowError('INVALID_INPUT',422);
  if(typeof input.target!=='string'||!(LEGACY.test(input.target)||UUID.test(input.target)))throw new FlowError('INVALID_INPUT',422);
  await this.ctx.authorize('BOOKING_VIEW');
  return this.ctx.light('BOOKING_CREATE',[],async c=>(await c.query('SELECT customer_link_legacy($1,$2,$3) v',[requestKey,input.bookingId,input.target])).rows[0].v as {customerId:string;bookingId:string});
 }
}
