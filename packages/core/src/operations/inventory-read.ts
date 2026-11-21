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

 /** Per-size counts for one station from each family's own authority: individual items (ledger_assets), pole
  * quantities (ledger_poles) or wear pools (wear_pools). The product list sums exactly these rows, so a product's list
  * totals always equal the sum of its sizes on the detail screen. */
 private async variantCounts(c:{query:(sql:string,args?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>},store:string,modelFilter:string,args:unknown[]){
  const assets=(await c.query(`WITH s AS (${ASSET_STATE}) SELECT v.model_id,v.id,v.age,v.tier,v.size,v.size_key,${COUNTS}
    FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id LEFT JOIN s ON s.variant_id=v.id
    WHERE m.family IN ('SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT') AND ${modelFilter} GROUP BY v.id`,[store,...args])).rows;
  const poles=(await c.query(`SELECT v.model_id,v.id,v.age,v.tier,v.size,v.size_key,
    coalesce(sum(p.quantity) FILTER (WHERE p.status<>'RETIRED'),0)::int registered,
    greatest(0,coalesce(sum(p.quantity) FILTER (WHERE p.status<>'RETIRED'),0)-coalesce(sum(o.n),0))::int on_hand,
    greatest(0,coalesce(sum(p.quantity) FILTER (WHERE p.status='AVAILABLE'),0)-coalesce(sum(o.n) FILTER (WHERE p.status='AVAILABLE'),0))::int available_now,
    0 care,coalesce(sum(p.quantity) FILTER (WHERE p.status IN ('MAINTENANCE','UNVERIFIED')),0)::int maintenance,coalesce(sum(o.n),0)::int out_n,0 incoming
    FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id LEFT JOIN ledger_poles p ON p.variant_id=v.id AND p.store_id=$1
    LEFT JOIN LATERAL (SELECT count(*)::int n FROM rental_loan_items l WHERE l.pole_id=p.id AND l.state='OUT') o ON true
    WHERE m.family='POLE' AND ${modelFilter} GROUP BY v.id`,[store,...args])).rows;
  const wear=(await c.query(`SELECT v.model_id,v.id,v.age,v.tier,v.size,v.size_key,coalesce(sum(w.total),0)::int registered,
    coalesce(sum(w.ready+w.returned_pending+w.cleaning+w.today_blocked+w.unavailable),0)::int on_hand,coalesce(sum(w.ready),0)::int available_now,
    coalesce(sum(w.returned_pending+w.cleaning+w.today_blocked),0)::int care,coalesce(sum(w.unavailable),0)::int maintenance,coalesce(sum(w.on_loan),0)::int out_n,coalesce(sum(w.in_transit),0)::int incoming
    FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id LEFT JOIN wear_pools w ON w.variant_id=v.id AND w.store_id=$1
    WHERE m.family IN ('WEAR','WEAR_JACKET','WEAR_PANTS') AND ${modelFilter} GROUP BY v.id`,[store,...args])).rows;
  return [...assets,...poles,...wear].map(r=>({modelId:r.model_id as string,id:r.id as string,age:r.age as string,tier:r.tier as string,size:r.size as string,sizeKey:String(r.size_key??r.size),counts:counts(r as Record<string,number>)}));
 }

 /** Product list for one station: one row per model; counts are the sum of that model's per-size rows. */
 async list(q:{store:unknown;family?:unknown;search?:unknown}){
  const store=this.store(q.store),family=q.family===undefined||q.family===''?null:q.family;
  if(family!==null&&!(FAMILIES as readonly string[]).includes(family as string))throw new FlowError('INVALID_INPUT',422);
  const search=typeof q.search==='string'?q.search.trim().slice(0,60).replace(/[%_\\]/g,m=>'\\'+m):'';
  return this.ctx.snapshot('INVENTORY_VIEW',[store],async c=>{
   const models=(await c.query(`SELECT m.id,m.code,m.name,m.brand,m.family,(SELECT count(*)::int FROM ledger_variants v WHERE v.model_id=m.id) variants FROM ledger_models m
     WHERE ($1::text IS NULL OR m.family=$1 OR ($1='WEAR' AND m.family IN ('WEAR_JACKET','WEAR_PANTS'))) AND ($2='' OR m.name ILIKE '%'||$2||'%' OR m.brand ILIKE '%'||$2||'%' OR m.code ILIKE '%'||$2||'%') ORDER BY m.family,m.brand,m.name`,[family,search])).rows;
   const ids=models.map(m=>m.id as string);
   const sizes=ids.length?await this.variantCounts(c as never,store,'v.model_id=ANY($2::uuid[])',[ids]):[];
   const zero:StockCounts={registered:0,onHand:0,availableNow:0,care:0,maintenance:0,out:0,incoming:0};
   const rows=models.map(m=>{const t={...zero};for(const v of sizes)if(v.modelId===m.id)for(const k of Object.keys(t) as (keyof StockCounts)[])t[k]+=v.counts[k];
    return {id:m.id,code:m.code,name:m.name,brand:m.brand,family:m.family,variants:Number(m.variants),counts:t};});
   return {store,family,total:rows.length,rows};
  });
 }

 /** Scan: an individual item id → its product and current station. The station is read and the actor's live session,
  * INVENTORY_VIEW and CURRENT station access are checked in the same transaction (ops_assert_actor), never with a
  * principal loaded earlier. Anything the actor may not see — unknown, other station, revoked — is reported as not found. */
 async locate(id:unknown){
  if(typeof id!=='string'||!UUID.test(id))throw new FlowError('INVALID_INPUT',422);
  try{
   return await this.ctx.light('INVENTORY_VIEW',[],async c=>{
    const r=(await c.query('SELECT v.model_id "modelId",a.store_id store,a.family FROM ledger_assets a JOIN ledger_variants v ON v.id=a.variant_id WHERE a.id=$1',[id])).rows[0];
    if(!r)throw new FlowError('NOT_FOUND',404);
    await c.query("SELECT ops_assert_actor('INVENTORY_VIEW',ARRAY[$1]::text[],current_setting('zao.actor',true))",[r.store]);
    return {assetId:id,modelId:r.modelId as string,store:r.store as string,family:r.family as string};
   });
  }catch(e){if(e instanceof FlowError&&e.code==='FORBIDDEN')throw new FlowError('NOT_FOUND',404);throw e;}
 }

 /** Product detail: per-size counts (same source as the list), individual items with their current state, and the history
  * of this station only — events whose own record names this station (ledger_assets/ledger_poles snapshots). Catalog
  * events and anything whose station cannot be shown from its own record are left out rather than guessed. */
 async detail(id:unknown,storeValue:unknown){
  if(typeof id!=='string'||!UUID.test(id))throw new FlowError('INVALID_INPUT',422);const store=this.store(storeValue);
  return this.ctx.snapshot('INVENTORY_VIEW',[store],async c=>{
   const model=(await c.query('SELECT id,code,name,brand,family FROM ledger_models WHERE id=$1',[id])).rows[0];if(!model)throw new FlowError('NOT_FOUND',404);
   const variants=(await this.variantCounts(c as never,store,'v.model_id=$2',[id])).sort((a,b)=>a.age.localeCompare(b.age)||a.tier.localeCompare(b.tier)||a.sizeKey.localeCompare(b.sizeKey,undefined,{numeric:true}))
    .map(v=>({id:v.id,age:v.age,tier:v.tier,size:v.size,counts:v.counts}));
   const items=(await c.query(`WITH s AS (${ASSET_STATE}) SELECT s.id,v.size,s.origin,s.here,s.status,s.bsl_status "bslStatus",s.bsl_mm "bslMm",s.out_now "out",s.transit_to "transitTo",s.uninspected,s.transfer_not_ready "transferNotReady"
     FROM s JOIN ledger_variants v ON v.id=s.variant_id WHERE v.model_id=$2 AND (s.here=$1 OR s.transit_to=$1 OR s.out_from=$1) ORDER BY v.size_key,s.id LIMIT 500`,[store,id])).rows;
   const history=(await c.query(`SELECT h.event_id "eventId",h.occurred_at "at",h.resource,h.action,h.reason,h.entity_id "entityId" FROM ledger_history h
     WHERE h.resource IN ('assets','poles') AND (h.after_data->>'store_id'=$1 OR h.before_data->>'store_id'=$1)
      AND (h.entity_id IN (SELECT a.id FROM ledger_assets a JOIN ledger_variants v ON v.id=a.variant_id WHERE v.model_id=$2)
       OR h.entity_id IN (SELECT p.id FROM ledger_poles p JOIN ledger_variants v ON v.id=p.variant_id WHERE v.model_id=$2))
     ORDER BY h.occurred_at DESC LIMIT 100`,[store,id])).rows;
   return {store,model,variants,items,history};
  });
 }
}
