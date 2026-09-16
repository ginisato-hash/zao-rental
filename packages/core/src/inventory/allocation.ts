import {wearCapacity} from './wear-capacity';
import type {PoolClient} from 'pg';
import {HoldError,normalizePeriod,variantMatches,isWear,type HoldConditions,type Feasibility,type PaymentBoundary} from '../../../contracts/src/hold';
import {transferProjection,destinationFeasible,sourceReservations} from '../transfer/projection';
import {dependencyScope,type ScopeNode} from './dependency-scope';
import {matchPeriods,type Demand,type Placement} from './period-matching';
// Internal repository functions: caller must hold inventory lock and establish authorization.
// Shared by HOLD and authenticated booking operations; no HTTP or principal bypass API.
type Conn=Pick<PoolClient,'query'>;
type HoldRow={id:string;reservation_id:string;owner_id:string;pickup_store:string;return_store:string;conditions:HoldConditions;expires_at:Date;due_at:Date;state:'ACTIVE'|'EXPIRED'|'RELEASED';payment_state:PaymentBoundary;allocation_stage:string;version:number;transfer_attention:string|null;confirmed_at:Date|null};
type Unit={id:string;variant_id:string;family:string;age:string;tier:string;store_id:string;quantity:number;status:string;transfer_piece_id?:string;physical_pole_id?:string};
type Claim={transfer_piece_id:string|null;hold_id:string;requirement_key:string;asset_id:string|null;pole_id:string|null;pole_slot:number|null;day:string;start:string;end:string;pickup_store:string;return_store:string};
type Witness={transferPiece:string|null;holdId:string;key:string;asset:string|null;pole:string|null;slots:Record<string,number>};
export async function planAllocation(c:Conn,conditions:HoldConditions,now:Date,ignore:string|null=null,pin?:{requirementKey:string;assetId:string}|ReadonlyMap<string,string>):Promise<{result:Feasibility;witness:Witness[];replanned:string[]}>{
  if(new Date(normalizePeriod(conditions.period).dueAt)<=now)throw new HoldError('PERIOD_ENDED');
  // Bounded metadata scan, not a LIMIT that silently discards existing promises.
  const nodes=(await c.query<ScopeNode>(`SELECT id,occupancy_start::text AS start,CASE WHEN pickup_store<>return_store THEN '9999-12-31' ELSE occupancy_end::text END AS end,
   ARRAY(SELECT DISTINCT jsonb_array_elements_text(item->'variantIds') FROM jsonb_array_elements(conditions->'members') member CROSS JOIN LATERAL jsonb_array_elements(member->'items') item WHERE item->>'family' NOT IN ('WEAR_JACKET','WEAR_PANTS')) AS variants
   FROM inventory_holds WHERE state='ACTIVE' AND (expires_at>$1 OR payment_state IN ('PENDING','UNKNOWN','SUCCESS') OR allocation_stage<>'PROVISIONAL') AND ($2::uuid IS NULL OR id<>$2) ORDER BY id LIMIT 10001`,[now,ignore])).rows;
  if(nodes.length>10000)return {result:'INDETERMINATE',witness:[],replanned:[]};
  let scope:string[];try{scope=dependencyScope({id:'candidate',start:conditions.period.startDate,end:conditions.pickupStore===conditions.returnStore?conditions.period.endDate:'9999-12-31',variants:conditions.members.flatMap(m=>m.items.filter(i=>!isWear(i.family)).flatMap(i=>i.variantIds))},nodes);}catch(e){if(e instanceof HoldError&&e.code==='INDETERMINATE')return {result:'INDETERMINATE',witness:[],replanned:[]};throw e;}
  const live=(await c.query<HoldRow>('SELECT * FROM inventory_holds WHERE id=ANY($1::uuid[]) ORDER BY id',[scope])).rows;
  const pinned=(await c.query<{hold_id:string}>(`SELECT DISTINCT cl.hold_id FROM inventory_claims cl JOIN transfer_pieces p ON p.id=cl.transfer_piece_id JOIN transfer_batches b ON b.id=p.batch_id WHERE cl.active AND cl.hold_id=ANY($2::uuid[]) AND (p.state<>'PLANNED' OR b.issue IS NOT NULL OR b.planned_ready_at<$1)`,[now,scope])).rows.map(r=>r.hold_id);
  const mutable=live.filter(h=>h.due_at>now&&!h.transfer_attention&&!pinned.includes(h.id)&&h.allocation_stage==='PROVISIONAL'&&(['NONE','FAILURE'].includes(h.payment_state)||h.payment_state==='SUCCESS'&&h.confirmed_at instanceof Date));
  // All non-replanned live promises remain fixed, including outside the closure.
  const fixedIds=nodes.filter(h=>!mutable.some(m=>m.id===h.id)).map(h=>h.id);
  const jobs=[...mutable.map(h=>({id:h.id,c:h.conditions})),{id:'candidate',c:conditions}];
  const requirements=jobs.flatMap(j=>j.c.members.flatMap(m=>m.items.filter(i=>!isWear(i.family)).map(item=>({...item,member:m,key:j.id+'/'+m.key+':'+item.family,memberKey:m.key+':'+item.family,job:j}))));
  if(requirements.length>240)return {result:'INDETERMINATE',witness:[],replanned:[]};
  const checkedRequirements=[...requirements,...conditions.members.flatMap(m=>m.items.filter(i=>isWear(i.family)).map(item=>({...item,member:m})))];
  const variantIds=[...new Set(checkedRequirements.flatMap(r=>r.variantIds))];
  const transfers=await transferProjection(c,variantIds);if(transfers.length>3000)return {result:'INDETERMINATE',witness:[],replanned:[]};
  const variants=(await c.query<import('../../../contracts/src/hold').PromiseVariant>(`SELECT v.id,v.family,v.age,v.tier,v.model_id,to_jsonb(v)->'compatible_sports' AS compatible_sports,to_jsonb(m)->>'catalog_season' AS catalog_season FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id WHERE v.id=ANY($1::uuid[])`,[variantIds])).rows;
  for(const r of checkedRequirements)for(const variantId of r.variantIds){const v=variants.find(v=>v.id===variantId);if(!variantMatches(r.member,r,v))throw new HoldError('VARIANT_MISMATCH');}
  const wear=await wearCapacity(c,conditions,now,ignore);if(!wear.feasible)return {result:'INSUFFICIENT',witness:[],replanned:[]};
  const units=(await c.query<Unit>(`SELECT a.id,a.variant_id,a.family,v.age,v.tier,a.store_id,1 AS quantity,a.status FROM ledger_assets a JOIN ledger_variants v ON v.id=a.variant_id WHERE a.variant_id=ANY($1::uuid[]) UNION ALL SELECT p.id,p.variant_id,p.family,v.age,v.tier,p.store_id,p.quantity,p.status FROM ledger_poles p JOIN ledger_variants v ON v.id=p.variant_id WHERE p.variant_id=ANY($1::uuid[]) ORDER BY id LIMIT 3001`,[variantIds])).rows;
  for(const u of [...units])if(u.family==='POLE'){u.quantity-=transfers.filter(p=>p.destination_pole_id===u.id&&p.state==='READY').length;for(const p of transfers.filter(p=>p.destination_pole_id===u.id&&!['CANCELLED','CLOSED'].includes(p.state)))units.push({...u,id:p.id,quantity:1,transfer_piece_id:p.id,physical_pole_id:u.id});}
  if(units.length>3000)return {result:'INDETERMINATE',witness:[],replanned:[]};
  const fixedClaims=(await c.query<Claim>(`SELECT c.transfer_piece_id,c.hold_id,c.requirement_key,c.asset_id,c.pole_id,c.pole_slot,c.day::text,h.occupancy_start::text AS start,h.occupancy_end::text AS end,h.pickup_store,h.return_store FROM inventory_claims c JOIN inventory_holds h ON h.id=c.hold_id WHERE c.active AND h.id=ANY($1::uuid[]) AND (c.asset_id=ANY($2::uuid[]) OR c.pole_id=ANY($2::uuid[]) OR c.transfer_piece_id=ANY($2::uuid[])) LIMIT 100001`,[fixedIds,units.flatMap(u=>[u.id,...(u.physical_pole_id?[u.physical_pole_id]:[])])])).rows;
  const constraints=(await c.query<{asset_id:string|null;pole_id:string|null;kind:string;start:string;end:string}>(`SELECT asset_id,pole_id,kind,starts_on::text AS start,ends_on::text AS end FROM inventory_constraints x WHERE x.asset_id=ANY($1::uuid[]) OR x.pole_id=ANY($1::uuid[]) LIMIT 10001`,[units.flatMap(u=>[u.id,...(u.physical_pole_id?[u.physical_pole_id]:[])])])).rows;
  const custody=(await c.query<{id:string;asset_id:string|null;pole_id:string|null;start:string;end:string;hold_id:string;requirement_key:string}>(`SELECT x.id,x.asset_id,x.pole_id,x.starts_on::text AS start,x.ends_on::text AS end,b.hold_id,l.requirement_key FROM rental_inventory_blocks x JOIN rental_loan_items l ON l.id=x.id JOIN rental_bookings b ON b.id=l.booking_id WHERE x.asset_id=ANY($1::uuid[]) OR x.pole_id=ANY($1::uuid[]) LIMIT 10001`,[units.flatMap(u=>[u.id,...(u.physical_pole_id?[u.physical_pole_id]:[])])])).rows;
  if(custody.length>10000)return {result:'INDETERMINATE',witness:[],replanned:[]};
  constraints.push(...custody.filter(x=>x.asset_id).map(x=>({...x,kind:'CUSTODY_BLOCK'})));
  if(fixedClaims.length>100000||constraints.length>10000)return {result:'INDETERMINATE',witness:[],replanned:[]};
  const fixed:Placement[]=[...sourceReservations(transfers),...new Map(fixedClaims.filter(x=>x.pickup_store!==x.return_store||x.end>=requirements.reduce((min,r)=>r.job.c.period.startDate<min?r.job.c.period.startDate:min,'9999-12-31')).map(x=>[x.hold_id+'/'+x.requirement_key,{key:x.hold_id+'/'+x.requirement_key,unit:(x.asset_id??x.transfer_piece_id??x.pole_id)!,start:x.start,end:x.pickup_store===x.return_store?x.end:'9999-12-31'}])).values()];
  // CLOSED stops virtual projection, not the no-same-day-reuse promise of physical transport.
  const receivedDay=(await c.query<{id:string;unit:string;day:string}>(`SELECT p.id,coalesce(p.asset_id,p.destination_pole_id) AS unit,b.scheduled_date::text AS day FROM transfer_pieces p JOIN transfer_batches b ON b.id=p.batch_id WHERE p.state='CLOSED' AND coalesce(p.asset_id,p.destination_pole_id)=ANY($1::uuid[]) AND b.scheduled_date BETWEEN $2::date AND $3::date`,[units.map(u=>u.id),jobs.reduce((d,j)=>j.c.period.startDate<d?j.c.period.startDate:d,'9999-12-31'),jobs.reduce((d,j)=>j.c.period.endDate>d?j.c.period.endDate:d,'0001-01-01')])).rows;
  for(const x of custody.filter(x=>x.pole_id)){const old=fixed.find(p=>p.key===x.hold_id+'/'+x.requirement_key&&p.unit===x.pole_id);if(old){if(old.end<x.end)old.end=x.end;}else fixed.push({key:'custody/'+x.id,unit:x.pole_id!,start:x.start,end:x.end});}
  fixed.push(...receivedDay.map(p=>({key:'received/'+p.id,unit:p.unit,start:p.day,end:p.day})));
  // A second, diagnostic-only match relaxes custody/transfer constraints. It never creates claims.
  // Only report a transfer prerequisite if those constraints actually explain infeasibility.
  const demandsFor=(diagnostic:boolean):Demand[]=>requirements.filter(r=>!isWear(r.family)).map(r=>{
   const start=r.job.c.period.startDate,end=diagnostic||r.job.c.pickupStore===r.job.c.returnStore?r.job.c.period.endDate:'9999-12-31';
   const candidates=units.filter(u=>{
    const pinnedUnit=pin instanceof Map?pin.get(r.memberKey):pin&&'requirementKey' in pin&&r.memberKey===pin.requirementKey?pin.assetId:undefined;
    if(pinnedUnit&&r.job.id==='candidate'&&u.id!==pinnedUnit)return false;
    if(!r.variantIds.includes(u.variant_id)||u.status!=='AVAILABLE'||u.quantity<1)return false;
    if(!diagnostic){
     const movement=transfers.find(p=>u.family==='POLE'?p.id===u.transfer_piece_id:p.asset_id===u.id&&!['CANCELLED','CLOSED'].includes(p.state));
     if(movement){if(u.family==='POLE'){if(!destinationFeasible(movement,r.job.c,now))return false;}else if(!(movement.state==='PLANNED'&&r.job.c.pickupStore===movement.source_store&&r.job.c.period.endDate<=movement.scheduled_date)||r.job.c.pickupStore!==r.job.c.returnStore){if(!destinationFeasible(movement,r.job.c,now))return false;}}else if(u.store_id!==r.job.c.pickupStore)return false;
    }
    return !constraints.some(x=>(x.asset_id===u.id||x.pole_id===(u.physical_pole_id??u.id))&&x.start<=r.job.c.period.endDate&&x.end>=start&&(!diagnostic||x.kind!=='TRANSFER_UNVERIFIED'));
   }).map(u=>u.id);
   return {key:r.key,start,end,candidates};
  });
  try{
   const capacities=new Map(units.map(u=>[u.id,u.quantity]));
   const matching=matchPeriods(demandsFor(false),capacities,fixed);
   if(!matching){
    const diagnosticFixed=fixed.map(p=>({...p,end:fixedClaims.find(c=>c.hold_id+'/'+c.requirement_key===p.key)?.end??p.end}));
    const diagnostic=matchPeriods(demandsFor(true),capacities,diagnosticFixed);
    return {result:diagnostic?'TRANSFER_PLAN_REQUIRED':'INSUFFICIENT',witness:[],replanned:[]};
   }
   const used=new Map<string,Set<number>>();for(const x of fixedClaims)if(x.pole_id){const k=(x.transfer_piece_id??x.pole_id)+'/'+x.day;const slots=used.get(k)??new Set();slots.add(x.pole_slot!);used.set(k,slots);}
   const witness:Witness[]=matching.map(p=>{
    const r=requirements.find(r=>r.key===p.key)!,u=units.find(u=>u.id===p.unit)!,slots:Record<string,number>={};
    if(u.family==='POLE')for(const day of normalizePeriod(r.job.c.period).dates){const k=u.id+'/'+day,occupied=used.get(k)??new Set();let slot=1;while(occupied.has(slot))slot++;if(slot>u.quantity)throw new HoldError('INDETERMINATE',503);occupied.add(slot);used.set(k,occupied);slots[day]=slot;}
    const movement=transfers.find(p=>u.family==='POLE'?p.id===u.transfer_piece_id:p.asset_id===u.id&&destinationFeasible(p,r.job.c,now));
    return {transferPiece:movement?.id??null,holdId:r.job.id,key:r.memberKey,asset:u.family==='POLE'?null:u.id,pole:u.family==='POLE'?(u.physical_pole_id??u.id):null,slots};
   });
   return {result:'FEASIBLE',witness,replanned:mutable.map(h=>h.id)};
  }catch(e){if(e instanceof HoldError&&e.code==='INDETERMINATE')return {result:'INDETERMINATE',witness:[],replanned:[]};throw e;}
 }
export async function writeAllocationClaims(c:Conn,holdId:string,conditions:HoldConditions,witness:Witness[]){
  const rows=witness.flatMap(w=>normalizePeriod(conditions.period).dates.map(day=>({hold_id:holdId,requirement_key:w.key,asset_id:w.asset,pole_id:w.pole,pole_slot:w.slots[day]??null,transfer_piece_id:w.transferPiece,day})));
  await c.query(`INSERT INTO inventory_claims(hold_id,requirement_key,asset_id,pole_id,pole_slot,transfer_piece_id,day) SELECT hold_id,requirement_key,asset_id,pole_id,pole_slot,transfer_piece_id,day FROM jsonb_to_recordset($1::jsonb) AS x(hold_id uuid,requirement_key text,asset_id uuid,pole_id uuid,pole_slot integer,transfer_piece_id uuid,day date)`,[JSON.stringify(rows)]);
 }
