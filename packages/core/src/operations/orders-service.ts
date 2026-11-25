import {FlowError} from '../../../contracts/src/rental-flow';
import {utcDate} from '../../../contracts/src/hold';
import type {OperationsContext} from './context';
import {EXPORT_MAX,exportBound} from './exports';
import {evaluateShortage,SHORTAGE_BUDGET,SHORTAGE_COLUMNS_SQL,SHORTAGE_JOIN_SQL,SHORTAGE_STATUS_SQL,type ShortageCandidate,type ShortageState} from './shortage';

// Orders and Dashboard reads (Issue #47 §2B/§2C, consolidated order §3.1–3.2). Booqable order list and dashboard structure,
// backed only by real rental facts:
// * the CURRENT schedule comes from the live HOLD (amendments update it); the original booking terms stay readable;
// * status uses the current requirement keys (member:family, as ManifestService), the loans for those keys, inspections and
//   wear quantities/care — not a raw count of every historical loan row;
// * late pickup and late return are separate; counts and rows come from one READ ONLY snapshot.
const STORES=['MOUNTAIN_BASE','ONSEN_BASE'] as const;
export type OrderStatus='DRAFT'|'PAYMENT_PENDING'|'PAYMENT_REVIEW'|'RESERVED'|'PARTIALLY_PICKED_UP'|'PICKED_UP'|'PARTIALLY_RETURNED'|'RETURNED'|'INSPECTION_PENDING'|'NO_PICKUP'|'COMPLETED'|'CANCELED';
export const ORDER_STATUS_VALUES:OrderStatus[]=['DRAFT','PAYMENT_PENDING','PAYMENT_REVIEW','RESERVED','PARTIALLY_PICKED_UP','PICKED_UP','PARTIALLY_RETURNED','RETURNED','INSPECTION_PENDING','NO_PICKUP','COMPLETED','CANCELED'];
export type OrderTab='all'|'upcoming'|'late'|'shortage';
export type OrderRow={id:string;ref:string;customer:string|null;email:string|null;state:string;status:OrderStatus;paymentStatus:string|null;
 pickupStore:string;returnStore:string;startDate:string;endDate:string;slot:string;originalStartDate:string;originalEndDate:string;amended:boolean;
 people:number;totalJpy:number|null;createdAt:string;lateOut:boolean;lateBack:boolean;outItems:number;shortage?:ShortageState};

export const ORDER_BASE_SQL=`WITH b AS (
 SELECT r.id,r.state,r.mode,r.contact,r.price_snapshot,r.created_at,r.conditions original,coalesce(h.conditions,r.conditions) cond,
  coalesce(h.pickup_store,r.conditions->>'pickupStore') pickup_store,coalesce(h.return_store,r.conditions->>'returnStore') return_store
 FROM rental_bookings r LEFT JOIN inventory_holds h ON h.id=r.hold_id
), k AS (
 SELECT b.*,
  (b.cond->'period'->>'startDate')::date start_date,(b.cond->'period'->>'endDate')::date end_date,b.cond->'period'->>'slot' slot,
  ARRAY(SELECT DISTINCT (m->>'key')||':'||(i->>'family') FROM jsonb_array_elements(b.cond->'members') m,jsonb_array_elements(m->'items') i WHERE i->>'family' NOT IN ('WEAR_JACKET','WEAR_PANTS')) req,
  EXISTS(SELECT 1 FROM jsonb_array_elements(b.cond->'members') m,jsonb_array_elements(m->'items') i WHERE i->>'family' IN ('WEAR_JACKET','WEAR_PANTS')) wear_req
 FROM b WHERE b.pickup_store=ANY($1::text[]) OR b.return_store=ANY($1::text[])
), f AS (
 SELECT k.*,
  (SELECT count(DISTINCT l.requirement_key) FROM rental_loan_items l WHERE l.booking_id=k.id AND l.requirement_key=ANY(k.req)) eq_loaned,
  (SELECT count(*) FROM rental_loan_items l WHERE l.booking_id=k.id AND l.requirement_key=ANY(k.req) AND l.state='OUT') eq_out,
  (SELECT count(*) FROM rental_loan_items l WHERE l.booking_id=k.id AND l.state='RECEIVED' AND NOT EXISTS(SELECT 1 FROM rental_inspections i WHERE i.loan_item_id=l.id)) eq_uninspected,
  (SELECT count(*) FROM wear_loans w WHERE w.booking_id=k.id) wear_loans,
  (SELECT coalesce(sum(w.quantity-w.returned),0) FROM wear_loans w WHERE w.booking_id=k.id) wear_out,
  (SELECT coalesce(sum(w.returned),0) FROM wear_loans w WHERE w.booking_id=k.id) wear_returned,
  (SELECT coalesce(sum(x.quantity),0) FROM wear_receipts x JOIN wear_loans w ON w.id=x.loan_id WHERE w.booking_id=k.id AND x.state IN ('RETURNED_PENDING','CLEANING','TODAY_BLOCKED','UNAVAILABLE')) wear_care,
  EXISTS(SELECT 1 FROM rental_no_pickup_events n WHERE n.booking_id=k.id) no_pickup,
  (SELECT a.state FROM rental_payment_attempts a WHERE a.booking_id=k.id ORDER BY a.created_at DESC LIMIT 1) payment_status
 FROM k
), d AS (
 SELECT f.*,
  (cardinality(f.req)=0 OR f.eq_loaned=cardinality(f.req)) AND (NOT f.wear_req OR f.wear_loans>0) all_handed,
  (f.eq_loaned>0 OR f.wear_loans>0) any_handed,(f.eq_out>0 OR f.wear_out>0) any_out,
  (f.eq_loaned>f.eq_out OR f.wear_returned>0) any_back
 FROM f
), s AS (
 SELECT d.*,CASE
  WHEN d.state='CANCELLED' THEN 'CANCELED' WHEN d.state='DRAFT' THEN 'DRAFT' WHEN d.state='PAYMENT_PENDING' THEN 'PAYMENT_PENDING' WHEN d.state='PAYMENT_REVIEW' THEN 'PAYMENT_REVIEW'
  WHEN d.state IN ('COMPLETED','COMPLETED_DEV') THEN 'COMPLETED' WHEN d.no_pickup THEN 'NO_PICKUP'
  WHEN NOT d.any_handed THEN 'RESERVED'
  WHEN d.any_out AND NOT d.all_handed THEN 'PARTIALLY_PICKED_UP'
  WHEN d.any_out AND d.any_back THEN 'PARTIALLY_RETURNED'
  WHEN d.any_out THEN 'PICKED_UP'
  WHEN d.eq_uninspected>0 OR d.wear_care>0 THEN 'INSPECTION_PENDING'
  ELSE 'RETURNED' END status,
  (d.state IN ('CONFIRMED','CONFIRMED_DEV') AND NOT d.all_handed AND NOT d.no_pickup AND d.start_date<$2::date) late_out,
  (d.any_out AND d.end_date<$2::date) late_back
 FROM d)`;
export const ORDER_ROW_SQL=`json_build_object('id',s.id,'ref',upper(left(s.id::text,8)),'customer',s.contact->>'displayName','email',s.contact->>'email','state',s.state,'status',s.status,'paymentStatus',s.payment_status,
 'pickupStore',s.pickup_store,'returnStore',s.return_store,'startDate',s.start_date,'endDate',s.end_date,'slot',s.slot,
 'originalStartDate',s.original->'period'->>'startDate','originalEndDate',s.original->'period'->>'endDate','amended',(s.original->'period') IS DISTINCT FROM (s.cond->'period'),
 'people',jsonb_array_length(coalesce(s.cond->'members','[]'::jsonb)),'totalJpy',(s.price_snapshot->>'totalJpy')::bigint,'createdAt',s.created_at,
 'lateOut',s.late_out,'lateBack',s.late_back,'outItems',s.eq_out+s.wear_out)`;

const jstToday=(now:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(now);
const addDays=(date:string,n:number)=>{const t=new Date(date+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
/** Real calendar date (rejects 2035-02-30 etc.), using the hold contract's own date parser. */
/** Dashboard panels and the printable work list share these, so the two can never disagree about which orders belong to a
 * station and period ($3 station, $4/$5 first/last day; current period after amendments; DRAFT/CANCELED excluded). */
const LIVE_SQL="s.status NOT IN ('DRAFT','CANCELED')";
const PANEL_SQL={out:{where:`s.pickup_store=$3 AND ${LIVE_SQL} AND s.start_date BETWEEN $4::date AND $5::date`,order:"s.start_date,CASE s.slot WHEN 'PM' THEN 1 ELSE 0 END,s.created_at,s.id"},
 back:{where:`s.return_store=$3 AND ${LIVE_SQL} AND s.end_date BETWEEN $4::date AND $5::date`,order:"s.end_date,CASE s.slot WHEN 'AM' THEN 0 ELSE 1 END,s.created_at,s.id"}} as const;
export const WORK_LIST_MAX=1000;
const calendarDate=(v:unknown)=>{if(typeof v!=='string')return false;try{utcDate(v);return true;}catch{return false;}};
const optionalDate=(v:unknown)=>{if(v===undefined||v===null||v==='')return null;if(!calendarDate(v))throw new FlowError('INVALID_INPUT',422);return v as string;};

export class OrdersService{
 constructor(private ctx:OperationsContext,private clock:()=>Date=()=>new Date(),private shortageBudget=SHORTAGE_BUDGET){}
 /** With shortage over the already-filtered candidate set `${where}` (same args), in the caller's snapshot. Returns the
  * judged orders in display order; the caller slices pages from this list so counts and rows always agree. */
 private async shortage(c:{query:(sql:string,args?:unknown[])=>Promise<{rows:unknown[]}>},where:string,args:unknown[],order:string){
  const now=((await c.query('SELECT inventory_clock() AS now')).rows[0] as {now:Date}).now;
  const rows=(await c.query(`${ORDER_BASE_SQL} SELECT ${SHORTAGE_COLUMNS_SQL} FROM s ${SHORTAGE_JOIN_SQL} ${where} AND ${SHORTAGE_STATUS_SQL} ORDER BY ${order}`,args)).rows as ShortageCandidate[];
  const judged=await evaluateShortage(c as never,rows,now,this.shortageBudget);
  return rows.filter(r=>judged.has(r.id)).map(r=>({id:r.id,state:judged.get(r.id)!}));
 }
 private stores(v:unknown){const list=(Array.isArray(v)?v:[v]).filter(s=>s!==''&&s!==undefined&&s!==null);
  if(!list.length||list.length>STORES.length||list.some(s=>typeof s!=='string'||!(STORES as readonly string[]).includes(s))||new Set(list).size!==list.length)throw new FlowError('INVALID_STORE',422);return list as string[];}
 private async today(c:{query:(sql:string)=>Promise<{rows:{now:Date}[]}>}){return jstToday((await c.query('SELECT inventory_clock() AS now')).rows[0]?.now??this.clock());}

 /** Booqable Orders. direction=out applies the date range and station to pickup, direction=back to return; without it the
  * range is on pickup and the station on either. late=out|back narrows the Late tab; without it Late lists both kinds. */
 async list(q:{stores:unknown;tab?:unknown;status?:unknown;payment?:unknown;from?:unknown;to?:unknown;direction?:unknown;late?:unknown;search?:unknown;page?:unknown;pageSize?:unknown},opts:{all?:boolean}={}){
  const stores=this.stores(q.stores),tab=(q.tab??'all') as OrderTab;if(!['all','upcoming','late','shortage'].includes(tab))throw new FlowError('INVALID_INPUT',422);
  const statuses=q.status?String(q.status).split(',').filter(Boolean):[];if(statuses.some(s=>!ORDER_STATUS_VALUES.includes(s as OrderStatus)))throw new FlowError('INVALID_INPUT',422);
  const payments=q.payment?String(q.payment).split(',').filter(Boolean):[];if(payments.some(p=>!/^[A-Z_]{1,40}$/.test(p)))throw new FlowError('INVALID_INPUT',422);
  const from=optionalDate(q.from),to=optionalDate(q.to);if(from&&to&&from>to)throw new FlowError('INVALID_INPUT',422);
  const direction=q.direction===undefined||q.direction===''?null:q.direction;if(direction!==null&&direction!=='out'&&direction!=='back')throw new FlowError('INVALID_INPUT',422);
  const late=q.late===undefined||q.late===''?null:q.late;if(late!==null&&late!=='out'&&late!=='back')throw new FlowError('INVALID_INPUT',422);
  const search=typeof q.search==='string'?q.search.trim().slice(0,80):'';
  // opts.all (CSV export): every row of these filters in one snapshot, no paging; over EXPORT_MAX the whole export is refused.
  const page=opts.all?1:q.page===undefined?1:Number(q.page),size=opts.all?EXPORT_MAX:q.pageSize===undefined?25:Number(q.pageSize);
  if(!opts.all&&(!Number.isInteger(page)||page<1||page>10000||!Number.isInteger(size)||size<1||size>100))throw new FlowError('INVALID_INPUT',422);
  return this.ctx.snapshot('BOOKING_VIEW',stores,async c=>{
   const today=await this.today(c as never);
   const dateCol=direction==='back'?'s.end_date':'s.start_date';
   const storeSql=direction==='out'?'s.pickup_store=ANY($1::text[])':direction==='back'?'s.return_store=ANY($1::text[])':'TRUE';
   const lateSql=late==='out'?'s.late_out':late==='back'?'s.late_back':'(s.late_out OR s.late_back)';
   const where=`WHERE ${storeSql} AND ($3::text[] IS NULL OR s.status=ANY($3)) AND ($4::text[] IS NULL OR s.payment_status=ANY($4))
    AND ($5::date IS NULL OR ${dateCol}>=$5) AND ($6::date IS NULL OR ${dateCol}<=$6)
    AND ($7='' OR upper(s.id::text) LIKE upper($7)||'%' OR s.contact->>'displayName' ILIKE '%'||$7||'%' OR s.contact->>'email' ILIKE '%'||$7||'%')`;
   const upcomingSql="s.start_date>=$2::date AND s.status IN ('RESERVED','PAYMENT_PENDING','PAYMENT_REVIEW')";
   const tabSql={all:'TRUE',upcoming:upcomingSql,late:lateSql,shortage:SHORTAGE_STATUS_SQL}[tab];
   const args=[stores,today,statuses.length?statuses:null,payments.length?payments:null,from,to,search.replace(/[%_\\]/g,m=>'\\'+m)];
   const counts=(await c.query(`${ORDER_BASE_SQL} SELECT count(*)::int all_n,count(*) FILTER (WHERE ${upcomingSql})::int upcoming_n,count(*) FILTER (WHERE ${lateSql})::int late_n,
     count(*) FILTER (WHERE s.late_out)::int late_out_n,count(*) FILTER (WHERE s.late_back)::int late_back_n FROM s ${where}`,args)).rows[0];
   // With shortage is judged only when asked for (it runs the allocation planner per order, within a fixed budget).
   const judged=tab==='shortage'?await this.shortage(c as never,where,args,'s.start_date ASC,s.id'):null;
   const shortageCounts=judged?{shortage:judged.filter(j=>j.state!=='INDETERMINATE').length,shortageIndeterminate:judged.filter(j=>j.state==='INDETERMINATE').length}:{shortage:null,shortageIndeterminate:null};
   const total=judged?judged.length:Number({all:counts.all_n,upcoming:counts.upcoming_n,late:counts.late_n}[tab as 'all'|'upcoming'|'late']);if(opts.all)exportBound(total);
   let rows:OrderRow[];
   if(judged){const slice=judged.slice((page-1)*size,page*size),byId=new Map(slice.map(j=>[j.id,j.state]));
    const found=(await c.query(`${ORDER_BASE_SQL} SELECT ${ORDER_ROW_SQL} v FROM s WHERE s.id=ANY($3::uuid[])`,[args[0],args[1],slice.map(j=>j.id)])).rows.map(r=>r.v as OrderRow);
    rows=slice.map(j=>found.find(o=>o.id===j.id)).filter((o):o is OrderRow=>!!o).map(o=>({...o,shortage:byId.get(o.id)!}));}
   else rows=(await c.query(`${ORDER_BASE_SQL} SELECT ${ORDER_ROW_SQL} v FROM s ${where} AND ${tabSql} ORDER BY ${tab==='upcoming'?'s.start_date ASC,s.id':tab==='late'?`${late==='back'?'s.end_date':'s.start_date'} ASC,s.id`:'s.created_at DESC,s.id'} LIMIT ${size} OFFSET ${(page-1)*size}`,args)).rows.map(r=>r.v as OrderRow);
   const paymentOptions=(await c.query(`${ORDER_BASE_SQL} SELECT DISTINCT s.payment_status p FROM s WHERE s.payment_status IS NOT NULL ORDER BY 1`,[stores,today])).rows.map(r=>r.p as string);
   return {today,tab,direction,late,from,to,total,page,pageSize:size,counts:{all:counts.all_n,upcoming:counts.upcoming_n,late:counts.late_n,lateOut:counts.late_out_n,lateBack:counts.late_back_n,...shortageCounts},paymentOptions,rows};
  });
 }

 /** Read-only order detail for BOOKING_VIEW (consolidated order §3.3). The booking must touch a station the actor can see;
  * otherwise it is reported as not found. Operations (prepare/checkout/return/amend) stay behind their own permissions. */
 async detail(id:unknown){
  if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))throw new FlowError('INVALID_INPUT',422);
  // light(), not snapshot(): the contract read re-checks the session with ops_assert_actor, whose FOR SHARE lock is not
  // permitted in a READ ONLY transaction. Nothing here writes. The station scope is the one light() authorized with, and the
  // detail is released only if that scope still holds afterwards (CAL-01 class).
  let disclosed:string[]=[];
  const detail=await this.ctx.light('BOOKING_VIEW',[],async(c,principal)=>{const visible=[...principal.storeIds] as string[];disclosed=visible;
   const today=await this.today(c as never);
   const row=(await c.query(`${ORDER_BASE_SQL} SELECT ${ORDER_ROW_SQL} v,s.cond,s.original FROM s WHERE s.id=$3`,[visible,today,id])).rows[0];
   if(!row)throw new FlowError('NOT_FOUND',404);
   const loans=(await c.query(`SELECT l.requirement_key "requirementKey",l.family,l.state,l.checked_out_at "checkedOutAt",l.due_at "dueAt",l.pickup_store "pickupStore",
     r.received_store "receivedStore",r.actual_received_at "receivedAt",i.inspected_at "inspectedAt"
    FROM rental_loan_items l LEFT JOIN rental_receipts r ON r.loan_item_id=l.id LEFT JOIN rental_inspections i ON i.loan_item_id=l.id WHERE l.booking_id=$1 ORDER BY l.requirement_key`,[id])).rows;
   const wear=(await c.query(`SELECT w.member_key "memberKey",w.requirement_key "requirementKey",w.quantity,w.returned,w.checked_out_at "checkedOutAt" FROM wear_loans w WHERE w.booking_id=$1 ORDER BY w.requirement_key`,[id])).rows;
   const payments=(await c.query(`SELECT a.state,a.amount_jpy "amountJpy",a.created_at "createdAt" FROM rental_payment_attempts a WHERE a.booking_id=$1 ORDER BY a.created_at`,[id])).rows;
   const contract=(await c.query('SELECT staff_order_contract($1) v',[id])).rows[0].v as {terms:{version:string;locale:string;acceptedAt:string}|null;cancellationPolicy:{policyVersion:string;freeCancellationUntil:string}|null};
   // Display names for the booked items: every variant id the booking names (equipment and wear) with its model and size. Read-only, ids only
   // from this booking's own conditions, bounded; an id that no longer resolves is simply absent and the screen falls back to the family name.
   const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
   const variantIds=[...new Set((row.cond.members as {items?:{variantIds?:unknown;modelPromise?:{variantId?:unknown}}[]}[]).flatMap(m=>(m.items??[]).flatMap(i=>[...(Array.isArray(i.variantIds)?i.variantIds:[]),i.modelPromise?.variantId])).filter((x):x is string=>typeof x==='string'&&UUID.test(x)))].slice(0,500);
   const variants=variantIds.length?(await c.query(`SELECT v.id,v.family,v.age,v.tier,v.size,m.name model FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id WHERE v.id=ANY($1::uuid[]) ORDER BY v.family,v.size,v.id`,[variantIds])).rows:[];
   return {order:row.v as OrderRow,current:{period:row.cond.period,members:row.cond.members},original:{period:row.original.period},loans,wear,variants,payments,terms:contract.terms,cancellationPolicy:contract.cancellationPolicy};
  });
  await this.ctx.confirmScope('BOOKING_VIEW',disclosed);return detail;
 }

 /** DASH-PRINT-01 / Booqable "Run report": the printable work list for one station and a period (at most 31 days), with
  * exactly the Dashboard panel rules (PANEL_SQL: same station attribution, live statuses, current period, time order) but
  * never silently cut. One REPEATABLE READ READ ONLY snapshot holds the true totals, the per-day counts and the rows, and the
  * session/store scope is re-authorized by snapshot() before anything is returned. If either panel has more than `max` rows
  * the rows are withheld (complete:false) and `days` gives the per-day counts from the same snapshot, so the page can offer
  * one complete list per day instead of a partial one. `max` below WORK_LIST_MAX is for tests only. */
 async workList(q:{store:unknown;from:unknown;to:unknown},max=WORK_LIST_MAX){
  const store=this.stores(q.store)[0]!;
  if(!calendarDate(q.from)||!calendarDate(q.to))throw new FlowError('INVALID_INPUT',422);const from=q.from as string,to=q.to as string;
  if(to<from||(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000>30)throw new FlowError('INVALID_INPUT',422);
  const bound=Math.max(1,Math.min(WORK_LIST_MAX,Math.trunc(max)));
  return this.ctx.snapshot('BOOKING_VIEW',[store],async c=>{
   const today=await this.today(c as never),args=[[store],today,store,from,to];
   const totals=(await c.query(`${ORDER_BASE_SQL} SELECT count(*) FILTER (WHERE ${PANEL_SQL.out.where})::int out_n,count(*) FILTER (WHERE ${PANEL_SQL.back.where})::int back_n FROM s`,args)).rows[0];
   const goingOutTotal=Number(totals.out_n),comingBackTotal=Number(totals.back_n),complete=goingOutTotal<=bound&&comingBackTotal<=bound;
   const perDay=(k:'out'|'back')=>PANEL_SQL[k].where.replace('BETWEEN $4::date AND $5::date','= wd.day');
   const days=(await c.query(`${ORDER_BASE_SQL},wd AS (SELECT g::date AS day FROM generate_series($4::date,$5::date,interval '1 day') g)
     SELECT to_char(wd.day,'YYYY-MM-DD') AS date,(SELECT count(*) FROM s WHERE ${perDay('out')})::int AS out,(SELECT count(*) FROM s WHERE ${perDay('back')})::int AS back FROM wd ORDER BY wd.day`,args)).rows as {date:string;out:number;back:number}[];
   const rows=async(k:'out'|'back')=>complete?(await c.query(`${ORDER_BASE_SQL} SELECT ${ORDER_ROW_SQL} v FROM s WHERE ${PANEL_SQL[k].where} ORDER BY ${PANEL_SQL[k].order} LIMIT ${bound+1}`,args)).rows.map(r=>r.v as OrderRow):[];
   const goingOut=await rows('out'),comingBack=await rows('back');
   // Same snapshot, so this cannot differ; if it ever did, fail closed rather than print a list that disagrees with its total.
   if(complete&&(goingOut.length!==goingOutTotal||comingBack.length!==comingBackTotal))throw new FlowError('SNAPSHOT_MISMATCH',503);
   return {today,store,from,to,goingOut,comingBack,goingOutTotal,comingBackTotal,max:bound,complete,
    days:days.map(d=>({date:d.date,goingOut:Number(d.out),comingBack:Number(d.back),complete:Number(d.out)<=bound&&Number(d.back)<=bound}))};
  });
 }
 /** Booqable Dashboard: Going out (current pickups in range at this station) / Coming back (current returns in range).
  * Each panel reports its true total; rows are capped for display only and the cap is reported. */
 async dashboard(q:{store:unknown;range?:unknown;date?:unknown}){
  const store=this.stores(q.store)[0]!,range=(q.range??'today') as string,CAP=300;
  if(!['today','tomorrow','next7','nextWeek','nextMonth','date'].includes(range))throw new FlowError('INVALID_INPUT',422);
  if(range==='date'&&!calendarDate(q.date))throw new FlowError('INVALID_INPUT',422);
  return this.ctx.snapshot('BOOKING_VIEW',[store],async c=>{
   const today=await this.today(c as never),dow=(new Date(today+'T00:00:00Z').getUTCDay()+6)%7;
   const [from,to]=range==='today'?[today,today]:range==='tomorrow'?[addDays(today,1),addDays(today,1)]:range==='next7'?[today,addDays(today,6)]
    :range==='nextWeek'?[addDays(today,7-dow),addDays(today,13-dow)]:range==='nextMonth'?(()=>{const t=new Date(today+'T00:00:00Z');const a=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth()+1,1)),b=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth()+2,0));return [a.toISOString().slice(0,10),b.toISOString().slice(0,10)];})()
    :[q.date as string,q.date as string];
   const outWhere=PANEL_SQL.out.where,backWhere=PANEL_SQL.back.where;
   const args=[[store],today,store,from,to];
   const totals=(await c.query(`${ORDER_BASE_SQL} SELECT count(*) FILTER (WHERE ${outWhere})::int out_n,count(*) FILTER (WHERE ${backWhere})::int back_n,
     count(*) FILTER (WHERE s.pickup_store=$3 AND s.late_out)::int late_out,count(*) FILTER (WHERE s.return_store=$3 AND s.late_back)::int late_back FROM s`,args)).rows[0];
   const out=(await c.query(`${ORDER_BASE_SQL} SELECT ${ORDER_ROW_SQL} v FROM s WHERE ${outWhere} ORDER BY ${PANEL_SQL.out.order} LIMIT ${CAP}`,args)).rows.map(r=>r.v as OrderRow);
   const back=(await c.query(`${ORDER_BASE_SQL} SELECT ${ORDER_ROW_SQL} v FROM s WHERE ${backWhere} ORDER BY ${PANEL_SQL.back.order} LIMIT ${CAP}`,args)).rows.map(r=>r.v as OrderRow);
   // Shortage among the orders going out in this range: the same candidate set Orders evaluates for
   // tab=shortage&stores=[store]&direction=out&from&to (same base, station, dates; the status set is a subset of `live`).
   const judged=await this.shortage(c as never,`WHERE s.pickup_store=ANY($1::text[]) AND s.start_date>=$3::date AND s.start_date<=$4::date`,[[store],today,from,to],'s.start_date ASC,s.id');
   return {today,store,range,from,to,goingOut:out,comingBack:back,goingOutTotal:Number(totals.out_n),comingBackTotal:Number(totals.back_n),cap:CAP,lateOut:Number(totals.late_out),lateBack:Number(totals.late_back),
    shortageOut:judged.filter(j=>j.state!=='INDETERMINATE').length,shortageOutIndeterminate:judged.filter(j=>j.state==='INDETERMINATE').length};
  });
 }
}
