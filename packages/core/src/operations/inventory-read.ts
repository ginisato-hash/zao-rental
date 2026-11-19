import {FlowError} from '../../../contracts/src/rental-flow';
import type {OperationsContext} from './context';

// Booqable Inventory (Issue #47 consolidated order §4): product search / left filters / list → product detail → variants,
// individual items and history. Read-only. The counts keep distinct meanings and are never merged into one number:
//  registered   — ledger items currently assigned to this station in the ledger (台帳数); not all are physically here
//  onHand       — items physically here now: current location is this station, not out on rent, not in transit
//  availableNow — on hand, status AVAILABLE, inspected after their last return, and not a transfer still being readied
//  care         — on hand but returned and not yet inspected (or a received transfer not yet ready)
//  maintenance  — on hand with status MAINTENANCE or UNVERIFIED
//  out          — on rent, picked up at this station
//  incoming     — in transit to this station (planned arrival; not stock until received)
// Whether a size can be booked for a period is NOT derived from these: the detail screen asks the existing
// HoldService.availability (planMixedAllocation) instead.
const STORES=['MOUNTAIN_BASE','ONSEN_BASE'] as const;
const FAMILIES=['SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT','POLE','WEAR'] as const;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Per item: current station = the latest of (home registration, transfer received/ready at destination, custody return
// at an actual station); flags for out, in transit, awaiting inspection, transfer not yet ready.
// The ledger station (store_id) is the authoritative current location: custody receipts and transfer receipts move it.
// initial_store_id is where the item was first registered. Flags: out on rent, in transit, returned but not inspected.
const ASSET_STATE=`SELECT a.id,a.variant_id,a.family,a.initial_store_id origin,a.store_id here,a.store_id home,a.status,a.bsl_status,a.bsl_mm,a.version,
  EXISTS(SELECT 1 FROM rental_loan_items l WHERE l.asset_id=a.id AND l.state='OUT') out_now,
  (SELECT l.pickup_store FROM rental_loan_items l WHERE l.asset_id=a.id AND l.state='OUT' LIMIT 1) out_from,
  (SELECT b.destination_store FROM transfer_pieces p JOIN transfer_batches b ON b.id=p.batch_id WHERE p.asset_id=a.id AND p.state='IN_TRANSIT' LIMIT 1) transit_to,
  EXISTS(SELECT 1 FROM rental_loan_items l WHERE l.asset_id=a.id AND l.state='RECEIVED' AND NOT EXISTS(SELECT 1 FROM rental_inspections i WHERE i.loan_item_id=l.id)
   AND NOT EXISTS(SELECT 1 FROM rental_loan_items l2 WHERE l2.asset_id=a.id AND l2.checked_out_at>l.checked_out_at)) uninspected,
  EXISTS(SELECT 1 FROM transfer_pieces p WHERE p.asset_id=a.id AND p.state='RECEIVED') transfer_not_ready
 FROM ledger_assets a`;
const COUNTS=`count(*) FILTER (WHERE s.home=$1 AND s.status<>'RETIRED')::int registered,
  count(*) FILTER (WHERE s.here=$1 AND NOT s.out_now AND s.transit_to IS NULL AND s.status<>'RETIRED')::int on_hand,
  count(*) FILTER (WHERE s.here=$1 AND NOT s.out_now AND s.transit_to IS NULL AND s.status='AVAILABLE' AND NOT s.uninspected AND NOT s.transfer_not_ready)::int available_now,
  count(*) FILTER (WHERE s.here=$1 AND NOT s.out_now AND s.transit_to IS NULL AND s.status<>'RETIRED' AND (s.uninspected OR s.transfer_not_ready))::int care,
  count(*) FILTER (WHERE s.here=$1 AND NOT s.out_now AND s.transit_to IS NULL AND s.status IN ('MAINTENANCE','UNVERIFIED'))::int maintenance,
  count(*) FILTER (WHERE s.out_now AND s.out_from=$1)::int out_n,
  count(*) FILTER (WHERE s.transit_to=$1)::int incoming`;

export type StockCounts={registered:number;onHand:number;availableNow:number;care:number;maintenance:number;out:number;incoming:number};
const counts=(r:Record<string,number>):StockCounts=>({registered:r.registered??0,onHand:r.on_hand??0,availableNow:r.available_now??0,care:r.care??0,maintenance:r.maintenance??0,out:r.out_n??0,incoming:r.incoming??0});

export class InventoryRead{
 constructor(private ctx:OperationsContext){}
 private store(v:unknown){if(typeof v!=='string'||!(STORES as readonly string[]).includes(v))throw new FlowError('INVALID_STORE',422);return v;}

 /** Product list for one station: one row per model with the separated counts, filter by family, search by name/brand/code. */
 async list(q:{store:unknown;family?:unknown;search?:unknown}){
  const store=this.store(q.store),family=q.family===undefined||q.family===''?null:q.family;
  if(family!==null&&!(FAMILIES as readonly string[]).includes(family as string))throw new FlowError('INVALID_INPUT',422);
  const search=typeof q.search==='string'?q.search.trim().slice(0,60).replace(/[%_\\]/g,m=>'\\'+m):'';
  return this.ctx.snapshot('INVENTORY_VIEW',[store],async c=>{
   const assets=(await c.query(`WITH s AS (${ASSET_STATE}) SELECT m.id,m.code,m.name,m.brand,m.family,(SELECT count(*)::int FROM ledger_variants v WHERE v.model_id=m.id) variants,${COUNTS}
     FROM ledger_models m LEFT JOIN ledger_variants v ON v.model_id=m.id LEFT JOIN s ON s.variant_id=v.id
     WHERE m.family IN ('SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT') AND ($2::text IS NULL OR m.family=$2) AND ($3='' OR m.name ILIKE '%'||$3||'%' OR m.brand ILIKE '%'||$3||'%' OR m.code ILIKE '%'||$3||'%')
     GROUP BY m.id ORDER BY m.family,m.brand,m.name`,[store,family,search])).rows;
   const poles=(await c.query(`SELECT m.id,m.code,m.name,m.brand,m.family,(SELECT count(*)::int FROM ledger_variants v WHERE v.model_id=m.id) variants,
     coalesce(sum(p.quantity) FILTER (WHERE p.store_id=$1 AND p.status<>'RETIRED'),0)::int registered,
     coalesce(sum(p.quantity) FILTER (WHERE p.store_id=$1 AND p.status<>'RETIRED'),0)::int-coalesce(sum((SELECT count(*) FROM rental_loan_items l WHERE l.pole_id=p.id AND l.state='OUT')) FILTER (WHERE p.store_id=$1),0)::int on_hand,
     greatest(0,coalesce(sum(p.quantity) FILTER (WHERE p.store_id=$1 AND p.status='AVAILABLE'),0)-coalesce(sum((SELECT count(*) FROM rental_loan_items l WHERE l.pole_id=p.id AND l.state='OUT')) FILTER (WHERE p.store_id=$1 AND p.status='AVAILABLE'),0))::int available_now,
     0 care,coalesce(sum(p.quantity) FILTER (WHERE p.store_id=$1 AND p.status IN ('MAINTENANCE','UNVERIFIED')),0)::int maintenance,
     coalesce(sum((SELECT count(*) FROM rental_loan_items l WHERE l.pole_id=p.id AND l.state='OUT')) FILTER (WHERE p.store_id=$1),0)::int out_n,0 incoming
     FROM ledger_models m LEFT JOIN ledger_variants v ON v.model_id=m.id LEFT JOIN ledger_poles p ON p.variant_id=v.id
     WHERE m.family='POLE' AND ($2::text IS NULL OR $2='POLE') AND ($3='' OR m.name ILIKE '%'||$3||'%' OR m.brand ILIKE '%'||$3||'%' OR m.code ILIKE '%'||$3||'%') GROUP BY m.id ORDER BY m.brand,m.name`,[store,family,search])).rows;
   const wear=(await c.query(`SELECT m.id,m.code,m.name,m.brand,m.family,(SELECT count(*)::int FROM ledger_variants v WHERE v.model_id=m.id) variants,
     coalesce(sum(w.total),0)::int registered,coalesce(sum(w.ready+w.returned_pending+w.cleaning+w.today_blocked+w.unavailable),0)::int on_hand,coalesce(sum(w.ready),0)::int available_now,
     coalesce(sum(w.returned_pending+w.cleaning+w.today_blocked),0)::int care,coalesce(sum(w.unavailable),0)::int maintenance,coalesce(sum(w.on_loan),0)::int out_n,coalesce(sum(w.in_transit),0)::int incoming
     FROM ledger_models m JOIN ledger_variants v ON v.model_id=m.id LEFT JOIN wear_pools w ON w.variant_id=v.id AND w.store_id=$1
     WHERE m.family='WEAR' AND ($2::text IS NULL OR $2='WEAR') AND ($3='' OR m.name ILIKE '%'||$3||'%' OR m.brand ILIKE '%'||$3||'%' OR m.code ILIKE '%'||$3||'%') GROUP BY m.id ORDER BY m.brand,m.name`,[store,family,search])).rows;
   const rows=[...assets,...poles,...wear].map(r=>({id:r.id,code:r.code,name:r.name,brand:r.brand,family:r.family,variants:Number(r.variants),counts:counts(r)}));
   return {store,family,total:rows.length,rows};
  });
 }

 /** Product detail: variants with per-station counts, individual items with their current state, and recent history. */
 async detail(id:unknown,storeValue:unknown){
  if(typeof id!=='string'||!UUID.test(id))throw new FlowError('INVALID_INPUT',422);const store=this.store(storeValue);
  return this.ctx.snapshot('INVENTORY_VIEW',[store],async c=>{
   const model=(await c.query('SELECT id,code,name,brand,family FROM ledger_models WHERE id=$1',[id])).rows[0];if(!model)throw new FlowError('NOT_FOUND',404);
   const variants=(await c.query(`WITH s AS (${ASSET_STATE}) SELECT v.id,v.age,v.tier,v.size,${COUNTS} FROM ledger_variants v LEFT JOIN s ON s.variant_id=v.id WHERE v.model_id=$2 GROUP BY v.id ORDER BY v.age,v.tier,v.size_key`,[store,id])).rows
    .map(r=>({id:r.id,age:r.age,tier:r.tier,size:r.size,counts:counts(r)}));
   const items=(await c.query(`WITH s AS (${ASSET_STATE}) SELECT s.id,v.size,s.origin,s.here,s.status,s.bsl_status "bslStatus",s.bsl_mm "bslMm",s.out_now "out",s.transit_to "transitTo",s.uninspected,s.transfer_not_ready "transferNotReady"
     FROM s JOIN ledger_variants v ON v.id=s.variant_id WHERE v.model_id=$2 AND (s.here=$1 OR s.transit_to=$1 OR s.out_from=$1) ORDER BY v.size_key,s.id LIMIT 500`,[store,id])).rows;
   const history=(await c.query(`SELECT h.occurred_at "at",h.resource,h.action,h.reason,h.entity_id "entityId" FROM ledger_history h
     WHERE h.entity_id=$1 OR h.entity_id IN (SELECT id FROM ledger_variants WHERE model_id=$1) OR h.entity_id IN (SELECT a.id FROM ledger_assets a JOIN ledger_variants v ON v.id=a.variant_id WHERE v.model_id=$1)
     ORDER BY h.occurred_at DESC LIMIT 100`,[id])).rows;
   return {store,model,variants,items,history};
  });
 }
}
