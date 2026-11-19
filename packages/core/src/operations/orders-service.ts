import {FlowError} from '../../../contracts/src/rental-flow';
import type {OperationsContext} from './context';

// Orders and Dashboard reads (Issue #47 §2B/§2C). Booqable's order list and dashboard structure, backed only by real
// rental data. Read-only; every store in a request must be in the signed-in staff member's scope (OperationsContext).
const STORES=['MOUNTAIN_BASE','ONSEN_BASE'] as const;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
export type OrderStatus='DRAFT'|'PAYMENT_PENDING'|'PAYMENT_REVIEW'|'RESERVED'|'PICKED_UP'|'PARTIALLY_RETURNED'|'RETURNED'|'INSPECTION_PENDING'|'NO_PICKUP'|'COMPLETED'|'CANCELED';
export type OrderTab='all'|'upcoming'|'late';
export type OrderRow={id:string;ref:string;customer:string|null;email:string|null;state:string;status:OrderStatus;paymentStatus:string|null;
 pickupStore:string;returnStore:string;startDate:string;endDate:string;slot:string;people:number;totalJpy:number|null;createdAt:string;lateOut:boolean;lateBack:boolean;outItems:number};

// One derivation shared by every read. Late is judged against the JST business date passed in as $today.
const BASE=`WITH b AS (
 SELECT r.id,r.state,r.mode,r.contact,r.conditions,r.price_snapshot,r.created_at,
  r.conditions->>'pickupStore' pickup_store,r.conditions->>'returnStore' return_store,
  (r.conditions->'period'->>'startDate')::date start_date,(r.conditions->'period'->>'endDate')::date end_date,r.conditions->'period'->>'slot' slot,
  (SELECT count(*) FROM rental_loan_items l WHERE l.booking_id=r.id)+(SELECT count(*) FROM wear_loans w WHERE w.booking_id=r.id) loaned,
  (SELECT count(*) FROM rental_loan_items l WHERE l.booking_id=r.id AND l.state='OUT')+(SELECT count(*) FROM wear_loans w WHERE w.booking_id=r.id AND w.returned<w.quantity) out_items,
  (SELECT count(*) FROM rental_loan_items l WHERE l.booking_id=r.id AND l.state='RECEIVED' AND NOT EXISTS(SELECT 1 FROM rental_inspections i WHERE i.loan_item_id=l.id)) uninspected,
  EXISTS(SELECT 1 FROM rental_no_pickup_events n WHERE n.booking_id=r.id) no_pickup,
  (SELECT a.state FROM rental_payment_attempts a WHERE a.booking_id=r.id ORDER BY a.created_at DESC LIMIT 1) payment_status
 FROM rental_bookings r WHERE (r.conditions->>'pickupStore'=ANY($1::text[]) OR r.conditions->>'returnStore'=ANY($1::text[]))
), d AS (
 SELECT b.*,CASE
  WHEN b.state='CANCELLED' THEN 'CANCELED' WHEN b.state='DRAFT' THEN 'DRAFT' WHEN b.state='PAYMENT_PENDING' THEN 'PAYMENT_PENDING' WHEN b.state='PAYMENT_REVIEW' THEN 'PAYMENT_REVIEW'
  WHEN b.state IN ('COMPLETED','COMPLETED_DEV') THEN 'COMPLETED' WHEN b.no_pickup THEN 'NO_PICKUP'
  WHEN b.loaned=0 THEN 'RESERVED' WHEN b.out_items=b.loaned THEN 'PICKED_UP' WHEN b.out_items>0 THEN 'PARTIALLY_RETURNED'
  WHEN b.uninspected>0 THEN 'INSPECTION_PENDING' ELSE 'RETURNED' END status,
  (b.state IN ('CONFIRMED','CONFIRMED_DEV') AND b.loaned=0 AND NOT b.no_pickup AND b.start_date<$2::date) late_out,
  (b.out_items>0 AND b.end_date<$2::date) late_back
 FROM b)`;
const ROW=`json_build_object('id',d.id,'ref',upper(left(d.id::text,8)),'customer',d.contact->>'displayName','email',d.contact->>'email','state',d.state,'status',d.status,'paymentStatus',d.payment_status,
 'pickupStore',d.pickup_store,'returnStore',d.return_store,'startDate',d.start_date,'endDate',d.end_date,'slot',d.slot,'people',jsonb_array_length(coalesce(d.conditions->'members','[]'::jsonb)),
 'totalJpy',(d.price_snapshot->>'totalJpy')::bigint,'createdAt',d.created_at,'lateOut',d.late_out,'lateBack',d.late_back,'outItems',d.out_items)`;

const jstToday=(now:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(now);
const addDays=(date:string,n:number)=>{const t=new Date(date+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};

export class OrdersService{
 constructor(private ctx:OperationsContext,private clock:()=>Date=()=>new Date()){}
 private stores(v:unknown){const list=(Array.isArray(v)?v:[v]).filter(s=>s!==''&&s!==undefined&&s!==null);
  if(!list.length||list.length>STORES.length||list.some(s=>typeof s!=='string'||!(STORES as readonly string[]).includes(s))||new Set(list).size!==list.length)throw new FlowError('INVALID_STORE',422);return list as string[];}
 private async today(c:{query:(sql:string)=>Promise<{rows:{now:Date}[]}>}){return jstToday((await c.query('SELECT inventory_clock() AS now')).rows[0]?.now??this.clock());}

 /** Booqable Orders: tabs All/Upcoming/Late, filters (status, payment, date range, store, search), server-side count and paging. */
 async list(q:{stores:unknown;tab?:unknown;status?:unknown;payment?:unknown;from?:unknown;to?:unknown;search?:unknown;page?:unknown;pageSize?:unknown}){
  const stores=this.stores(q.stores),tab=(q.tab??'all') as OrderTab;if(!['all','upcoming','late'].includes(tab))throw new FlowError('INVALID_INPUT',422);
  const statuses=q.status?String(q.status).split(',').filter(Boolean):[];const ALL:OrderStatus[]=['DRAFT','PAYMENT_PENDING','PAYMENT_REVIEW','RESERVED','PICKED_UP','PARTIALLY_RETURNED','RETURNED','INSPECTION_PENDING','NO_PICKUP','COMPLETED','CANCELED'];
  if(statuses.some(s=>!ALL.includes(s as OrderStatus)))throw new FlowError('INVALID_INPUT',422);
  const payments=q.payment?String(q.payment).split(',').filter(Boolean):[];if(payments.some(p=>!/^[A-Z_]{1,40}$/.test(p)))throw new FlowError('INVALID_INPUT',422);
  for(const d of [q.from,q.to])if(d!==undefined&&d!==null&&d!==''&&(typeof d!=='string'||!DATE.test(d)))throw new FlowError('INVALID_INPUT',422);
  const search=typeof q.search==='string'?q.search.trim().slice(0,80):'';
  const page=q.page===undefined?1:Number(q.page),size=q.pageSize===undefined?25:Number(q.pageSize);
  if(!Number.isInteger(page)||page<1||page>10000||!Number.isInteger(size)||size<1||size>100)throw new FlowError('INVALID_INPUT',422);
  return this.ctx.light('BOOKING_VIEW',stores,async c=>{
   const today=await this.today(c as never);
   const where=`WHERE ($3::text[] IS NULL OR d.status=ANY($3)) AND ($4::text[] IS NULL OR d.payment_status=ANY($4))
    AND ($5::date IS NULL OR d.start_date>=$5) AND ($6::date IS NULL OR d.start_date<=$6)
    AND ($7='' OR upper(d.id::text) LIKE upper($7)||'%' OR d.contact->>'displayName' ILIKE '%'||$7||'%' OR d.contact->>'email' ILIKE '%'||$7||'%')`;
   const tabSql={all:'TRUE',upcoming:"d.start_date>=$2::date AND d.status IN ('RESERVED','PAYMENT_PENDING','PAYMENT_REVIEW')",late:'(d.late_out OR d.late_back)'}[tab];
   const args=[stores,today,statuses.length?statuses:null,payments.length?payments:null,q.from||null,q.to||null,search.replace(/[%_\\]/g,m=>'\\'+m)];
   const counts=(await c.query(`${BASE} SELECT count(*) FILTER (WHERE TRUE)::int all_n,count(*) FILTER (WHERE d.start_date>=$2::date AND d.status IN ('RESERVED','PAYMENT_PENDING','PAYMENT_REVIEW'))::int upcoming_n,count(*) FILTER (WHERE d.late_out OR d.late_back)::int late_n FROM d ${where}`,args)).rows[0];
   const total=Number({all:counts.all_n,upcoming:counts.upcoming_n,late:counts.late_n}[tab]);
   const rows=(await c.query(`${BASE} SELECT ${ROW} v FROM d ${where} AND ${tabSql} ORDER BY ${tab==='upcoming'?'d.start_date ASC,d.id':'d.created_at DESC,d.id'} LIMIT ${size} OFFSET ${(page-1)*size}`,args)).rows.map(r=>r.v as OrderRow);
   const paymentOptions=(await c.query(`${BASE} SELECT DISTINCT d.payment_status p FROM d WHERE d.payment_status IS NOT NULL ORDER BY 1`,[stores,today])).rows.map(r=>r.p as string);
   return {today,tab,total,page,pageSize:size,counts:{all:counts.all_n,upcoming:counts.upcoming_n,late:counts.late_n},paymentOptions,rows};
  });
 }

 /** Booqable Dashboard: Going out (pickups in range at this store) / Coming back (returns in range at this store). */
 async dashboard(q:{store:unknown;range?:unknown;date?:unknown}){
  const store=this.stores(q.store)[0]!,range=(q.range??'today') as string;
  if(!['today','tomorrow','next7','nextWeek','nextMonth','date'].includes(range))throw new FlowError('INVALID_INPUT',422);
  if(range==='date'&&(typeof q.date!=='string'||!DATE.test(q.date)))throw new FlowError('INVALID_INPUT',422);
  return this.ctx.light('BOOKING_VIEW',[store],async c=>{
   const today=await this.today(c as never),dow=(new Date(today+'T00:00:00Z').getUTCDay()+6)%7;
   const [from,to]=range==='today'?[today,today]:range==='tomorrow'?[addDays(today,1),addDays(today,1)]:range==='next7'?[today,addDays(today,6)]
    :range==='nextWeek'?[addDays(today,7-dow),addDays(today,13-dow)]:range==='nextMonth'?(()=>{const t=new Date(today+'T00:00:00Z');const a=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth()+1,1)),b=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth()+2,0));return [a.toISOString().slice(0,10),b.toISOString().slice(0,10)];})()
    :[q.date as string,q.date as string];
   const live="d.status NOT IN ('DRAFT','CANCELED')";
   const out=(await c.query(`${BASE} SELECT ${ROW} v FROM d WHERE d.pickup_store=$3 AND ${live} AND d.start_date BETWEEN $4::date AND $5::date ORDER BY d.start_date,CASE d.slot WHEN 'PM' THEN 1 ELSE 0 END,d.created_at LIMIT 300`,[[store],today,store,from,to])).rows.map(r=>r.v as OrderRow);
   const back=(await c.query(`${BASE} SELECT ${ROW} v FROM d WHERE d.return_store=$3 AND ${live} AND d.end_date BETWEEN $4::date AND $5::date ORDER BY d.end_date,CASE d.slot WHEN 'AM' THEN 0 ELSE 1 END,d.created_at LIMIT 300`,[[store],today,store,from,to])).rows.map(r=>r.v as OrderRow);
   const late=(await c.query(`${BASE} SELECT count(*) FILTER (WHERE d.pickup_store=$3 AND d.late_out)::int late_out,count(*) FILTER (WHERE d.return_store=$3 AND d.late_back)::int late_back FROM d`,[[store],today,store])).rows[0];
   return {today,store,range,from,to,goingOut:out,comingBack:back,lateOut:Number(late.late_out),lateBack:Number(late.late_back)};
  });
 }
}
