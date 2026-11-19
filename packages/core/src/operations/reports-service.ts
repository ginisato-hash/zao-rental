import {FlowError} from '../../../contracts/src/rental-flow';
import {utcDate} from '../../../contracts/src/hold';
import type {OperationsContext} from './context';

// Booqable Reports (Issue #47 consolidated order, Reports row): choose a report, a period and stations, then view or
// export. Read-only, one REPEATABLE READ READ ONLY snapshot, real rows only. Each fact is attributed to exactly one
// station so totals across stations never double count:
//   bookings — created bookings by creation date (JST) at their current pickup station; booked amount is the price
//              snapshot of bookings that are confirmed or completed, never money received
//   pickups  — hand-outs by checkout date at the actual pickup station (orders, gear items, wear pieces)
//   returns  — receipts by actual receipt date at the receiving station (gear items, wear pieces)
//   money    — money that actually moved, kept apart from booking totals: collected payments (original + additional,
//              COMPLETED) by completion date, and refunds by request date split into completed / in progress / failed
//              (customer cancellations and staff exception refunds), at the booking's pickup station
//   care     — the current state (not a period): items awaiting inspection and wear in care, by station
// CSV export uses the same query, permission and full row set as the screen.
const STORES=['MOUNTAIN_BASE','ONSEN_BASE'] as const;
export const REPORT_TYPES=['bookings','pickups','returns','money','care'] as const;
export type ReportType=typeof REPORT_TYPES[number];
const MAX_DAYS=92;
const jstToday=(now:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(now);
const addDays=(date:string,n:number)=>{const t=new Date(date+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
const days=(a:string,b:string)=>Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000)+1;
const date=(v:unknown)=>{if(typeof v!=='string')throw new FlowError('INVALID_INPUT',422);try{utcDate(v);}catch{throw new FlowError('INVALID_INPUT',422);}return v;};
const JST=(col:string)=>`(${col} AT TIME ZONE 'Asia/Tokyo')::date`;
const STATION=`coalesce(h.pickup_store,b.conditions->>'pickupStore')`;

export type ReportColumn={key:string;kind:'date'|'station'|'count'|'jpy'};
export type ReportResult={type:ReportType;from:string|null;to:string|null;stores:string[];asOf:string;columns:ReportColumn[];rows:Record<string,string|number>[];totals:Record<string,number>};

export class ReportsService{
 constructor(private ctx:OperationsContext){}
 async run(q:{type:unknown;stores:unknown;from?:unknown;to?:unknown}):Promise<ReportResult>{
  if(typeof q.type!=='string'||!(REPORT_TYPES as readonly string[]).includes(q.type))throw new FlowError('INVALID_INPUT',422);const type=q.type as ReportType;
  const list=(Array.isArray(q.stores)?q.stores:String(q.stores??'').split(',')).filter(Boolean);
  if(!list.length||list.length>STORES.length||list.some(s=>!(STORES as readonly string[]).includes(s))||new Set(list).size!==list.length)throw new FlowError('INVALID_STORE',422);
  return this.ctx.snapshot('BOOKING_VIEW',list,async c=>{
   const now=(await c.query('SELECT inventory_clock() AS now')).rows[0]!.now as Date,today=jstToday(now);
   let from:string|null=null,to:string|null=null;
   if(type!=='care'){from=q.from===undefined||q.from===''?addDays(today,-29):date(q.from);to=q.to===undefined||q.to===''?today:date(q.to);if(from>to||days(from,to)>MAX_DAYS)throw new FlowError('INVALID_INPUT',422);}
   const a=[list,from,to];
   let columns:ReportColumn[],rows:Record<string,string|number>[];
   if(type==='bookings'){
    columns=[{key:'date',kind:'date'},{key:'station',kind:'station'},{key:'created',kind:'count'},{key:'confirmed',kind:'count'},{key:'paymentPending',kind:'count'},{key:'cancelled',kind:'count'},{key:'bookedJpy',kind:'jpy'}];
    rows=(await c.query(`SELECT ${JST('b.created_at')}::text date,${STATION} station,count(*)::int created,
      count(*) FILTER (WHERE b.state IN ('CONFIRMED','CONFIRMED_DEV','COMPLETED','COMPLETED_DEV'))::int confirmed,
      count(*) FILTER (WHERE b.state IN ('PAYMENT_PENDING','PAYMENT_REVIEW'))::int "paymentPending",
      count(*) FILTER (WHERE b.state='CANCELLED')::int cancelled,
      coalesce(sum((b.price_snapshot->>'totalJpy')::bigint) FILTER (WHERE b.state IN ('CONFIRMED','CONFIRMED_DEV','COMPLETED','COMPLETED_DEV')),0)::bigint "bookedJpy"
     FROM rental_bookings b LEFT JOIN inventory_holds h ON h.id=b.hold_id
     WHERE b.state<>'DRAFT' AND ${STATION}=ANY($1::text[]) AND ${JST('b.created_at')} BETWEEN $2::date AND $3::date GROUP BY 1,2 ORDER BY 1,2`,a)).rows;
   }else if(type==='pickups'){
    columns=[{key:'date',kind:'date'},{key:'station',kind:'station'},{key:'orders',kind:'count'},{key:'items',kind:'count'},{key:'wearPieces',kind:'count'}];
    rows=(await c.query(`WITH g AS (SELECT ${JST('l.checked_out_at')} d,l.pickup_store s,l.booking_id,1 items,0 wear FROM rental_loan_items l WHERE l.pickup_store=ANY($1::text[]) AND ${JST('l.checked_out_at')} BETWEEN $2::date AND $3::date
      UNION ALL SELECT ${JST('w.checked_out_at')},w.actual_pickup_store,w.booking_id,0,w.quantity FROM wear_loans w WHERE w.actual_pickup_store=ANY($1::text[]) AND ${JST('w.checked_out_at')} BETWEEN $2::date AND $3::date)
     SELECT d::text date,s station,count(DISTINCT booking_id)::int orders,sum(items)::int items,sum(wear)::int "wearPieces" FROM g GROUP BY 1,2 ORDER BY 1,2`,a)).rows;
   }else if(type==='returns'){
    columns=[{key:'date',kind:'date'},{key:'station',kind:'station'},{key:'items',kind:'count'},{key:'wearPieces',kind:'count'}];
    rows=(await c.query(`WITH g AS (SELECT ${JST('r.actual_received_at')} d,r.received_store s,1 items,0 wear FROM rental_receipts r WHERE r.received_store=ANY($1::text[]) AND ${JST('r.actual_received_at')} BETWEEN $2::date AND $3::date
      UNION ALL SELECT ${JST('x.received_at')},x.actual_store,0,x.quantity FROM wear_receipts x WHERE x.actual_store=ANY($1::text[]) AND ${JST('x.received_at')} BETWEEN $2::date AND $3::date)
     SELECT d::text date,s station,sum(items)::int items,sum(wear)::int "wearPieces" FROM g GROUP BY 1,2 ORDER BY 1,2`,a)).rows;
   }else if(type==='money'){
    columns=[{key:'date',kind:'date'},{key:'station',kind:'station'},{key:'collectedJpy',kind:'jpy'},{key:'refundedJpy',kind:'jpy'},{key:'refundInProgressJpy',kind:'jpy'},{key:'refundFailedJpy',kind:'jpy'}];
    rows=(await c.query(`WITH m AS (
      SELECT ${JST('p.completed_at')} d,${STATION} s,p.amount_jpy collected,0::bigint done,0::bigint busy,0::bigint failed FROM ops_collected_payments p JOIN rental_bookings b ON b.id=p.booking_id LEFT JOIN inventory_holds h ON h.id=b.hold_id WHERE p.completed_at IS NOT NULL
      UNION ALL SELECT ${JST('r.created_at')},${STATION},0,CASE WHEN r.state='COMPLETED' THEN r.amount_jpy ELSE 0 END,CASE WHEN r.state IN ('PENDING','UNKNOWN','REVIEW') THEN r.amount_jpy ELSE 0 END,CASE WHEN r.state='FAILED' THEN r.amount_jpy ELSE 0 END FROM booking_cancellation_refunds r JOIN rental_bookings b ON b.id=r.booking_id LEFT JOIN inventory_holds h ON h.id=b.hold_id
      UNION ALL SELECT ${JST('r.created_at')},${STATION},0,CASE WHEN r.state='COMPLETED' THEN r.amount_jpy ELSE 0 END,CASE WHEN r.state IN ('PENDING','UNKNOWN','REVIEW') THEN r.amount_jpy ELSE 0 END,CASE WHEN r.state='FAILED' THEN r.amount_jpy ELSE 0 END FROM ops_refund_requests r JOIN rental_bookings b ON b.id=r.booking_id LEFT JOIN inventory_holds h ON h.id=b.hold_id)
     SELECT d::text date,s station,sum(collected)::bigint "collectedJpy",sum(done)::bigint "refundedJpy",sum(busy)::bigint "refundInProgressJpy",sum(failed)::bigint "refundFailedJpy"
     FROM m WHERE s=ANY($1::text[]) AND d BETWEEN $2::date AND $3::date GROUP BY 1,2 ORDER BY 1,2`,a)).rows;
   }else{
    columns=[{key:'station',kind:'station'},{key:'awaitingInspection',kind:'count'},{key:'wearInCare',kind:'count'}];
    rows=(await c.query(`SELECT s station,
      (SELECT count(*) FROM rental_receipts r WHERE r.received_store=s AND NOT EXISTS(SELECT 1 FROM rental_inspections i WHERE i.loan_item_id=r.loan_item_id))::int "awaitingInspection",
      (SELECT coalesce(sum(x.quantity),0) FROM wear_receipts x WHERE x.actual_store=s AND x.state IN ('RETURNED_PENDING','CLEANING','TODAY_BLOCKED','UNAVAILABLE'))::int "wearInCare"
     FROM unnest($1::text[]) s ORDER BY 1`,[list])).rows;
   }
   rows=rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==='string'&&/^-?\d+$/.test(v)&&k!=='date'&&k!=='station'?Number(v):v])));
   const totals=Object.fromEntries(columns.filter(c=>c.kind==='count'||c.kind==='jpy').map(c=>[c.key,rows.reduce((n,r)=>n+Number(r[c.key]??0),0)]));
   return {type,from,to,stores:list,asOf:now.toISOString(),columns,rows,totals};
  });
 }
}
/** CSV (UTF-8 with BOM for spreadsheet apps) from exactly the rows the screen shows. Header names are stable keys. */
export function reportCsv(r:ReportResult):string{
 const esc=(v:unknown)=>{const s=String(v??'');return /[",\r\n]/.test(s)||/^[=+\-@]/.test(s)?'"'+(/^[=+\-@]/.test(s)?"'":'')+s.replace(/"/g,'""')+'"':s;};
 const head=r.columns.map(c=>c.key),lines=[head.join(','),...r.rows.map(row=>head.map(k=>esc(row[k])).join(','))];
 return '﻿'+lines.join('\r\n')+'\r\n';
}
