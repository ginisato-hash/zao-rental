import {FlowError} from '../../../contracts/src/rental-flow';
import {utcDate} from '../../../contracts/src/hold';
import type {OperationsContext} from './context';

// Booqable Calendar (Issue #47 consolidated order, Calendar row): items as rows, the period as columns, bars for what
// holds each item. Read-only, one REPEATABLE READ READ ONLY snapshot, and only existing facts:
//   BOOKING / HOLD — active HOLD claims on the item (the CURRENT schedule: amendments move the HOLD); HOLD = no booking yet
//   OUT / OVERDUE / RETURNED — the actual loan (checked out → returned, or still out; overdue past its due time)
//   CARE  — returned but not yet inspected (the same block the allocation planner uses)
//   BLOCK — an inventory constraint (maintenance, unverified transfer, out)
//   TRANSFER — a scheduled station transfer of the item (planned vs. physical stay distinct)
// Planned (claims) and physical (loans) are never merged; once an item is handed out for an order, the loan replaces the
// planned bar for that order. Nothing can be dragged or changed here: changes stay in their own operations.
// A booking whose stations are both outside the viewer's scope is shown without its customer name.
const STORES=['MOUNTAIN_BASE','ONSEN_BASE'] as const;
const FAMILIES=['SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT'] as const;
const SPANS=[7,14,28] as const;
export type CalendarBar={kind:'BOOKING'|'HOLD'|'OUT'|'OVERDUE'|'RETURNED'|'CARE'|'BLOCK'|'TRANSFER';start:string;end:string;bookingId?:string|null;ref?:string|null;customer?:string|null;state?:string|null;detail?:string|null};
export type CalendarItem={id:string;ref:string;family:string;model:string;size:string;age:string;tier:string;status:string;station:string;bars:CalendarBar[]};
const addDays=(date:string,n:number)=>{const t=new Date(date+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
const jstToday=(now:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(now);
const clip=(s:string,e:string,from:string,to:string)=>({start:s<from?from:s,end:e>to?to:e});

export class CalendarService{
 constructor(private ctx:OperationsContext){}
 async view(q:{store:unknown;from?:unknown;days?:unknown;family?:unknown;page?:unknown;pageSize?:unknown}){
  if(typeof q.store!=='string'||!(STORES as readonly string[]).includes(q.store))throw new FlowError('INVALID_STORE',422);const store=q.store;
  const days=q.days===undefined||q.days===''?7:Number(q.days);if(!(SPANS as readonly number[]).includes(days))throw new FlowError('INVALID_INPUT',422);
  const family=q.family===undefined||q.family===''?null:q.family;if(family!==null&&!(FAMILIES as readonly unknown[]).includes(family))throw new FlowError('INVALID_INPUT',422);
  if(q.from!==undefined&&q.from!==''){if(typeof q.from!=='string')throw new FlowError('INVALID_INPUT',422);try{utcDate(q.from);}catch{throw new FlowError('INVALID_INPUT',422);}}
  const page=q.page===undefined?1:Number(q.page),size=q.pageSize===undefined?40:Number(q.pageSize);
  if(!Number.isInteger(page)||page<1||page>10000||!Number.isInteger(size)||size<1||size>100)throw new FlowError('INVALID_INPUT',422);
  const principal=await this.ctx.authorize('BOOKING_VIEW',[store]);const visible=principal.storeIds as string[];
  return this.ctx.snapshot('BOOKING_VIEW',[store],async c=>{
   const now=(await c.query<{now:Date}>('SELECT inventory_clock() AS now')).rows[0]!.now,today=jstToday(now);
   const from=typeof q.from==='string'&&q.from?q.from:today,to=addDays(from,days-1);
   // Items registered here now, plus items elsewhere that are promised to an order picking up here in the period.
   const itemWhere=`a.status<>'RETIRED' AND ($4::text IS NULL OR a.family=$4) AND (a.store_id=$1 OR EXISTS(SELECT 1 FROM inventory_claims c JOIN inventory_holds h ON h.id=c.hold_id
     WHERE c.asset_id=a.id AND c.active AND h.state='ACTIVE' AND h.pickup_store=$1 AND c.day BETWEEN $2::date AND $3::date))`;
   const args=[store,from,to,family];
   const total=Number((await c.query(`SELECT count(*)::int n FROM ledger_assets a WHERE ${itemWhere}`,args)).rows[0].n);
   const items=(await c.query<{id:string;family:string;status:string;station:string;size:string;age:string;tier:string;model:string}>(`SELECT a.id,a.family,a.status,a.store_id station,v.size,v.age,v.tier,m.name model
     FROM ledger_assets a JOIN ledger_variants v ON v.id=a.variant_id JOIN ledger_models m ON m.id=v.model_id WHERE ${itemWhere}
     ORDER BY array_position(ARRAY['SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT'],a.family),m.name,v.size_key,a.id LIMIT ${size} OFFSET ${(page-1)*size}`,args)).rows;
   const ids=items.map(i=>i.id),bars=new Map<string,CalendarBar[]>(ids.map(id=>[id,[]]));
   const push=(id:string,b:CalendarBar)=>bars.get(id)?.push(b);
   if(ids.length){
    const loans=(await c.query<{asset_id:string;booking_id:string;state:string;start:string;due:string;received:string|null;overdue:boolean;pickup_store:string;return_store:string|null;customer:string|null}>(`SELECT l.asset_id,l.booking_id,l.state,
      (l.checked_out_at AT TIME ZONE 'Asia/Tokyo')::date::text start,(l.due_at AT TIME ZONE 'Asia/Tokyo')::date::text due,(r.actual_received_at AT TIME ZONE 'Asia/Tokyo')::date::text received,
      (l.state='OUT' AND l.due_at<=$4) overdue,l.pickup_store,b.conditions->>'returnStore' return_store,
      CASE WHEN l.pickup_store=ANY($5::text[]) OR b.conditions->>'returnStore'=ANY($5::text[]) THEN b.contact->>'displayName' END customer
     FROM rental_loan_items l JOIN rental_bookings b ON b.id=l.booking_id LEFT JOIN rental_receipts r ON r.loan_item_id=l.id
     WHERE l.asset_id=ANY($1::uuid[]) AND (l.checked_out_at AT TIME ZONE 'Asia/Tokyo')::date<=$3::date
      AND coalesce((r.actual_received_at AT TIME ZONE 'Asia/Tokyo')::date,CASE WHEN l.state='OUT' THEN '9999-12-31'::date ELSE (l.due_at AT TIME ZONE 'Asia/Tokyo')::date END)>=$2::date`,[ids,from,to,now,visible])).rows;
    const handed=new Set(loans.map(l=>l.asset_id+'/'+l.booking_id));
    for(const l of loans){const end=l.received??(l.state==='OUT'&&l.overdue?to:l.due);
     push(l.asset_id,{kind:l.received?'RETURNED':l.overdue?'OVERDUE':'OUT',...clip(l.start,end<l.start?l.start:end,from,to),bookingId:l.booking_id,ref:l.booking_id.slice(0,8).toUpperCase(),customer:l.customer,state:l.state,detail:l.due});}
    const claims=(await c.query<{asset_id:string;hold_id:string;start:string;end:string;booking_id:string|null;state:string|null;customer:string|null}>(`SELECT c.asset_id,c.hold_id,min(c.day)::text start,max(c.day)::text "end",b.id booking_id,b.state,
      CASE WHEN b.id IS NOT NULL AND (h.pickup_store=ANY($4::text[]) OR h.return_store=ANY($4::text[])) THEN b.contact->>'displayName' END customer
     FROM inventory_claims c JOIN inventory_holds h ON h.id=c.hold_id LEFT JOIN rental_bookings b ON b.hold_id=h.id
     WHERE c.active AND h.state='ACTIVE' AND c.asset_id=ANY($1::uuid[]) AND c.day BETWEEN $2::date AND $3::date AND (b.id IS NULL OR b.state<>'CANCELLED')
     GROUP BY c.asset_id,c.hold_id,h.pickup_store,h.return_store,b.id,b.state,b.contact`,[ids,from,to,visible])).rows;
    for(const k of claims){if(k.booking_id&&handed.has(k.asset_id+'/'+k.booking_id))continue;
     push(k.asset_id,{kind:k.booking_id?'BOOKING':'HOLD',start:k.start,end:k.end,bookingId:k.booking_id,ref:k.booking_id?k.booking_id.slice(0,8).toUpperCase():null,customer:k.customer,state:k.state});}
    const blocks=(await c.query<{asset_id:string;start:string;end:string;kind:string}>(`SELECT asset_id,starts_on::text start,ends_on::text "end",reason kind FROM rental_inventory_blocks WHERE asset_id=ANY($1::uuid[]) AND reason='INSPECTION_PENDING' AND starts_on<=$3::date AND ends_on>=$2::date
     UNION ALL SELECT asset_id,starts_on::text,ends_on::text,kind FROM inventory_constraints WHERE asset_id=ANY($1::uuid[]) AND starts_on<=$3::date AND ends_on>=$2::date`,[ids,from,to])).rows;
    for(const b of blocks)push(b.asset_id,{kind:b.kind==='INSPECTION_PENDING'?'CARE':'BLOCK',...clip(b.start,b.end,from,to),detail:b.kind});
    const moves=(await c.query<{asset_id:string;day:string;source:string;destination:string;state:string}>(`SELECT p.asset_id,t.scheduled_date::text "day",t.source_store source,t.destination_store destination,p.state
     FROM transfer_pieces p JOIN transfer_batches t ON t.id=p.batch_id WHERE p.asset_id=ANY($1::uuid[]) AND p.state NOT IN ('CANCELLED','CLOSED') AND t.state<>'CANCELLED' AND t.scheduled_date BETWEEN $2::date AND $3::date`,[ids,from,to])).rows;
    for(const m of moves)push(m.asset_id,{kind:'TRANSFER',start:m.day,end:m.day,state:m.state,detail:m.source+'>'+m.destination});
   }
   const order=['OVERDUE','OUT','RETURNED','BOOKING','HOLD','CARE','BLOCK','TRANSFER'];
   const rows:CalendarItem[]=items.map(i=>({id:i.id,ref:i.id.slice(0,8).toUpperCase(),family:i.family,model:i.model,size:i.size,age:i.age,tier:i.tier,status:i.status,station:i.station,
    bars:(bars.get(i.id)??[]).sort((a,b)=>a.start.localeCompare(b.start)||order.indexOf(a.kind)-order.indexOf(b.kind))}));
   return {store,today,from,to,days,family,total,page,pageSize:size,items:rows};
  });
 }
}
