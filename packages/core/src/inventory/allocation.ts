import {wearCapacity,wearCapacityDetailed} from './wear-capacity';
import type {PoolClient} from 'pg';
import {HoldError,normalizePeriod,variantMatches,isWear,isPole,type HoldConditions,type Feasibility,type PaymentBoundary} from '../../../contracts/src/hold';
import {transferProjection,destinationFeasible,sourceReservations} from '../transfer/projection';
import {dependencyScope,type ScopeNode} from './dependency-scope';
import {matchPeriods,type Demand,type Placement} from './period-matching';
import {provisionalCapacity,type ProvisionalRequirement} from './provisional-capacity';
import type {ProvisionalFamily} from '../operations/provisional-capacity-source';
// Internal repository functions: caller must hold inventory lock and establish authorization.
// Shared by HOLD and authenticated booking operations; no HTTP or principal bypass API.
type Conn=Pick<PoolClient,'query'>;
type HoldRow={id:string;reservation_id:string;owner_id:string;pickup_store:string;return_store:string;conditions:HoldConditions;expires_at:Date;due_at:Date;state:'ACTIVE'|'EXPIRED'|'RELEASED';payment_state:PaymentBoundary;allocation_stage:string;version:number;transfer_attention:string|null;confirmed_at:Date|null;buffer_override:boolean};
type Unit={id:string;variant_id:string;family:string;age:string;tier:string;store_id:string;quantity:number;status:string;transfer_piece_id?:string;physical_pole_id?:string};
type Claim={transfer_piece_id:string|null;hold_id:string;requirement_key:string;asset_id:string|null;pole_id:string|null;pole_slot:number|null;day:string;start:string;end:string;pickup_store:string;return_store:string;buffer_override:boolean};
type Witness={transferPiece:string|null;holdId:string;key:string;asset:string|null;pole:string|null;slots:Record<string,number>};
export async function planAllocation(c:Conn,conditions:HoldConditions,now:Date,ignore:string|null=null,pin?:{requirementKey:string;assetId:string}|ReadonlyMap<string,string>,excludeKeys?:ReadonlySet<string>,wearFeasible?:boolean,bufferOverride=false):Promise<{result:Feasibility;witness:Witness[];replanned:string[]}>{
  if(new Date(normalizePeriod(conditions.period).dueAt)<=now)throw new HoldError('PERIOD_ENDED');
  // Bounded metadata scan, not a LIMIT that silently discards existing promises.
  const nodes=(await c.query<ScopeNode>(`SELECT id,occupancy_start::text AS start,CASE WHEN pickup_store<>return_store THEN '9999-12-31' ELSE occupancy_end::text END AS end,
   ARRAY(SELECT DISTINCT jsonb_array_elements_text(item->'variantIds') FROM jsonb_array_elements(conditions->'members') member CROSS JOIN LATERAL jsonb_array_elements(member->'items') item WHERE item->>'family' NOT IN ('WEAR_JACKET','WEAR_PANTS')) AS variants
   FROM inventory_holds WHERE state='ACTIVE' AND (expires_at>$1 OR payment_state IN ('PENDING','UNKNOWN','SUCCESS') OR allocation_stage<>'PROVISIONAL') AND ($2::uuid IS NULL OR id<>$2) ORDER BY id LIMIT 10001`,[now,ignore])).rows;
  if(nodes.length>10000)return {result:'INDETERMINATE',witness:[],replanned:[]};
  let scope:string[];try{scope=dependencyScope({id:'candidate',start:conditions.period.startDate,end:conditions.pickupStore===conditions.returnStore?conditions.period.endDate:'9999-12-31',variants:conditions.members.flatMap(m=>m.items.filter(i=>!isWear(i.family)).flatMap(i=>i.variantIds))},nodes);}catch(e){if(e instanceof HoldError&&e.code==='INDETERMINATE')return {result:'INDETERMINATE',witness:[],replanned:[]};throw e;}
  const live=(await c.query<HoldRow>('SELECT * FROM inventory_holds WHERE id=ANY($1::uuid[]) ORDER BY id',[scope])).rows;
  const pinned=(await c.query<{hold_id:string}>(`SELECT DISTINCT cl.hold_id FROM inventory_claims cl JOIN transfer_pieces p ON p.id=cl.transfer_piece_id JOIN transfer_batches b ON b.id=p.batch_id WHERE cl.active AND cl.hold_id=ANY($2::uuid[]) AND (p.state<>'PLANNED' OR b.issue IS NOT NULL OR b.planned_ready_at<$1)`,[now,scope])).rows.map(r=>r.hold_id);
  // V3 (TD correction, P2): a live hold with any ACTIVE provisional_capacity_claims row is treated
  // as fixed for another candidate's automatic physical replan — exactly like a pinned in-flight
  // transfer above — never silently given a NEW physical claim by someone else's replan while its
  // own provisional claim stays active (which would leave two witnesses, one physical one
  // provisional, for the same requirement). That hold may move from provisional to physical only
  // via its own explicit amend/reassign command, which replans through this same function for
  // itself as the candidate, not as another hold's automatic replan target.
  const provisionalBacked=(await c.query<{hold_id:string}>(`SELECT DISTINCT hold_id FROM provisional_capacity_claims WHERE state='ACTIVE' AND hold_id=ANY($1::uuid[])`,[scope])).rows.map(r=>r.hold_id);
  const mutable=live.filter(h=>h.due_at>now&&!h.transfer_attention&&!pinned.includes(h.id)&&!provisionalBacked.includes(h.id)&&h.allocation_stage==='PROVISIONAL'&&(['NONE','FAILURE'].includes(h.payment_state)||h.payment_state==='SUCCESS'&&h.confirmed_at instanceof Date));
  // All non-replanned live promises remain fixed, including outside the closure.
  const fixedIds=nodes.filter(h=>!mutable.some(m=>m.id===h.id)).map(h=>h.id);
  const jobs=[...mutable.map(h=>({id:h.id,c:h.conditions})),{id:'candidate',c:conditions}];
  const requirements=jobs.flatMap(j=>j.c.members.flatMap(m=>m.items.filter(i=>!isWear(i.family)).map(item=>({...item,member:m,key:j.id+'/'+m.key+':'+item.family,memberKey:m.key+':'+item.family,job:j}))))
   // Provisional-capacity fallback (candidate side only): a requirement here is entirely removed
   // from the physical bipartite match — never merely deprioritized — so planMixedAllocation's
   // physical retry genuinely solves only for what remains, and the excluded requirement's own
   // period is satisfied exclusively from the separate provisional pool, never double-claimed.
   .filter(r=>!excludeKeys?.has(r.key));
  if(requirements.length>240)return {result:'INDETERMINATE',witness:[],replanned:[]};
  const checkedRequirements=[...requirements,...conditions.members.flatMap(m=>m.items.filter(i=>isWear(i.family)).map(item=>({...item,member:m})))];
  const variantIds=[...new Set(checkedRequirements.flatMap(r=>r.variantIds))];
  const transfers=await transferProjection(c,variantIds);if(transfers.length>3000)return {result:'INDETERMINATE',witness:[],replanned:[]};
  const variants=(await c.query<import('../../../contracts/src/hold').PromiseVariant&{size:string}>(`SELECT v.id,v.family,v.age,v.tier,v.size,v.model_id,to_jsonb(v)->'compatible_sports' AS compatible_sports,to_jsonb(m)->>'catalog_season' AS catalog_season FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id WHERE v.id=ANY($1::uuid[])`,[variantIds])).rows;
  for(const r of checkedRequirements)for(const variantId of r.variantIds){const v=variants.find(v=>v.id===variantId);if(!variantMatches(r.member,r,v))throw new HoldError('VARIANT_MISMATCH');}
  // wearFeasible===undefined (every existing caller): computed here exactly as before, unchanged
  // behavior. planMixedAllocation passes an already-computed value instead, since it resolves wear
  // feasibility itself (with its own provisional-capacity fallback) before calling this function.
  // `bufferOverride` must still be threaded through this internal recompute — otherwise a caller
  // that itself received bufferOverride=true would silently have it discarded here, re-deriving
  // wear feasibility under the strict public ceiling regardless.
  const wear=wearFeasible===undefined?await wearCapacity(c,conditions,now,ignore,bufferOverride):{feasible:wearFeasible};
  if(!wear.feasible)return {result:'INSUFFICIENT',witness:[],replanned:[]};
  const units=(await c.query<Unit>(`SELECT a.id,a.variant_id,a.family,v.age,v.tier,a.store_id,1 AS quantity,a.status FROM ledger_assets a JOIN ledger_variants v ON v.id=a.variant_id WHERE a.variant_id=ANY($1::uuid[]) UNION ALL SELECT p.id,p.variant_id,p.family,v.age,v.tier,p.store_id,p.quantity,p.status FROM ledger_poles p JOIN ledger_variants v ON v.id=p.variant_id WHERE p.variant_id=ANY($1::uuid[]) ORDER BY id LIMIT 3001`,[variantIds])).rows;
  for(const u of [...units])if(u.family==='POLE'){u.quantity-=transfers.filter(p=>p.destination_pole_id===u.id&&p.state==='READY').length;for(const p of transfers.filter(p=>p.destination_pole_id===u.id&&!['CANCELLED','CLOSED'].includes(p.state)))units.push({...u,id:p.id,quantity:1,transfer_piece_id:p.id,physical_pole_id:u.id});}
  if(units.length>3000)return {result:'INDETERMINATE',witness:[],replanned:[]};
  // POLE feasibility (Owner decision, see isPole()'s own comment): a POLE requirement is exempt
  // from the demand set — trivially satisfied, no claim ever written — only when zero pole units
  // of a matching variant are registered anywhere in the ledger (checked here, after `units`,
  // system-wide, not merely "none available today"). When real pole stock does exist, it stays
  // a normal demand and is matched/conflict-checked exactly like any other family, so genuine
  // same-unit double-booking prevention is unaffected once inventory is eventually registered.
  const poleExempt=new Set(requirements.filter(r=>isPole(r.family)&&!units.some(u=>u.family==='POLE'&&r.variantIds.includes(u.variant_id))).map(r=>r.key));
  const fixedClaims=(await c.query<Claim>(`SELECT c.transfer_piece_id,c.hold_id,c.requirement_key,c.asset_id,c.pole_id,c.pole_slot,c.day::text,h.occupancy_start::text AS start,h.occupancy_end::text AS end,h.pickup_store,h.return_store,h.buffer_override FROM inventory_claims c JOIN inventory_holds h ON h.id=c.hold_id WHERE c.active AND h.id=ANY($1::uuid[]) AND (c.asset_id=ANY($2::uuid[]) OR c.pole_id=ANY($2::uuid[]) OR c.transfer_piece_id=ANY($2::uuid[])) LIMIT 100001`,[fixedIds,units.flatMap(u=>[u.id,...(u.physical_pole_id?[u.physical_pole_id]:[])])])).rows;
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
  const demandsFor=(diagnostic:boolean):Demand[]=>requirements.filter(r=>!isWear(r.family)&&!poleExempt.has(r.key)).map(r=>{
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
   // 95% public / staff INVENTORY_BUFFER_OVERRIDE (release-code-closure): unlike wear/provisional's
   // simple quantity pools, physical inventory is matched per discrete unit — the public ceiling is
   // therefore an aggregate check on the RESULTING claim set (fixed + freshly matched), never a
   // restriction on which units may be matched (Owner decision: no reserved unit identity, no
   // buffer_reserved flag). For every (variant,day) touched by a PUBLIC claim, existing fixed public
   // claims for that variant/day plus the newly written public claims must never exceed
   // floor(trueUnitCount*0.95); a replanned other hold's own buffer_override status (not the
   // candidate's) governs whether its own claims count toward the public total.
   // `u.quantity`, not a per-row +1: a `ledger_assets` row is always exactly 1 physical unit (its
   // own SELECT hardcodes `1 AS quantity`), but a `ledger_poles` row is a quantity-pool row (up to
   // 1,000,000 per variant/store/status, migration 0002) — counting rows instead of summing
   // quantity would undercount true pole operational capacity down to "row count", collapsing the
   // public ceiling to floor(rowCount*0.95) instead of floor(trueUnitCount*0.95).
   const operationalTotal=new Map<string,number>();
   for(const u of units)if(!u.transfer_piece_id)operationalTotal.set(u.variant_id,(operationalTotal.get(u.variant_id)??0)+u.quantity);
   const publicUsage=new Map<string,{variantId:string;count:number}>();
   const bump=(variantId:string,day:string)=>{const key=variantId+'|'+day;const cur=publicUsage.get(key)??{variantId,count:0};cur.count++;publicUsage.set(key,cur);};
   // `fixedClaims` spans every currently-active claim on the relevant units, across whatever dates
   // those OTHER holds happen to occupy — including dates having nothing to do with this candidate
   // or any replanned job. Bounding to `relevantDays` (the union of every job's own period in THIS
   // planning pass) keeps the ceiling scoped to the (variant,day) pairs actually being decided here,
   // never an unrelated pre-existing booking on some other day incidentally tipping this one over.
   const relevantDays=new Set(jobs.flatMap(j=>normalizePeriod(j.c.period).dates));
   for(const x of fixedClaims){
    if(x.buffer_override||!relevantDays.has(x.day))continue;
    const unitId=x.asset_id??x.transfer_piece_id??x.pole_id,variantId=unitId?units.find(u=>u.id===unitId)?.variant_id:undefined;
    if(variantId)bump(variantId,x.day);
   }
   for(const p of matching){
    const r=requirements.find(r=>r.key===p.key)!,u=units.find(u=>u.id===p.unit)!;
    const jobOverride=r.job.id==='candidate'?bufferOverride:(live.find(h=>h.id===r.job.id)?.buffer_override??false);
    if(jobOverride)continue;
    for(const day of normalizePeriod(r.job.c.period).dates)bump(u.variant_id,day);
   }
   for(const {variantId,count} of publicUsage.values())if(count>Math.floor((operationalTotal.get(variantId)??0)*0.95))return {result:'INSUFFICIENT',witness:[],replanned:[]};
   return {result:'FEASIBLE',witness,replanned:mutable.map(h=>h.id)};
  }catch(e){if(e instanceof HoldError&&e.code==='INDETERMINATE')return {result:'INDETERMINATE',witness:[],replanned:[]};throw e;}
 }
export async function writeAllocationClaims(c:Conn,holdId:string,conditions:HoldConditions,witness:Witness[]){
  const rows=witness.flatMap(w=>normalizePeriod(conditions.period).dates.map(day=>({hold_id:holdId,requirement_key:w.key,asset_id:w.asset,pole_id:w.pole,pole_slot:w.slots[day]??null,transfer_piece_id:w.transferPiece,day})));
  await c.query(`INSERT INTO inventory_claims(hold_id,requirement_key,asset_id,pole_id,pole_slot,transfer_piece_id,day) SELECT hold_id,requirement_key,asset_id,pole_id,pole_slot,transfer_piece_id,day FROM jsonb_to_recordset($1::jsonb) AS x(hold_id uuid,requirement_key text,asset_id uuid,pole_id uuid,pole_slot integer,transfer_piece_id uuid,day date)`,[JSON.stringify(rows)]);
 }

const PROVISIONAL_FAMILIES:readonly ProvisionalFamily[]=['SKI','SNOWBOARD','SKI_BOOT','SNOWBOARD_BOOT','WEAR_JACKET','WEAR_PANTS'];
type MixedResult={result:Feasibility;witness:Witness[];replanned:string[];provisional:ProvisionalRequirement[];wearExcludeKeys:ReadonlySet<string>};
const NONE:MixedResult['provisional']=[],NO_KEYS:ReadonlySet<string>=new Set();

/** Candidate-side only (never retroactively reallocates another hold's own physical claims to
 * provisional capacity): physical inventory is attempted first, in full, exactly as
 * `planAllocation` already does — a request that is fully satisfiable physically never touches
 * provisional capacity at all ("physical preferred"). Only when that full attempt is
 * `INSUFFICIENT` do the candidate's *eligible* requirements (ordinary tier, no modelPromise,
 * exactly one requested variant, a family the provisional pool actually covers — POLE and any
 * PREMIUM/modelPromise item are structurally never eligible) become candidates for the fallback.
 * Structural eligibility alone does not mean an item is *moved* to provisional: every eligible item
 * is first excluded (proving the remainder is physically feasible without it), then greedily
 * re-included one at a time — if the physical retry stays FEASIBLE with an item back in, it keeps
 * its real physical claim; only items that genuinely cannot be re-included stay routed to
 * provisional. This is what keeps "physical preferred" true even in a mixed request (e.g. a
 * SKI_SET member whose SKI has real stock but whose SKI_BOOT does not) instead of gratuitously
 * routing every eligible item to provisional the moment any one of them is short. This remains a
 * disclosed simplification, not a fully joint physical+provisional optimizer: the greedy
 * re-inclusion order can matter when several eligible items genuinely compete for the same scarce
 * unit (see RESULT.md) — but whenever provisional is not needed at all, the first full physical
 * attempt already succeeds, so the common case is unaffected. */
export async function planMixedAllocation(c:Conn,conditions:HoldConditions,now:Date,ignore:string|null=null,pin?:{requirementKey:string;assetId:string}|ReadonlyMap<string,string>,bufferOverride=false):Promise<MixedResult>{
 const wear=await wearCapacityDetailed(c,conditions,now,ignore,undefined,bufferOverride);
 const primary=await planAllocation(c,conditions,now,ignore,pin,undefined,wear.feasible?undefined:false,bufferOverride);
 if(primary.result!=='INSUFFICIENT')return {...primary,provisional:NONE,wearExcludeKeys:NO_KEYS};
 const eligiblePhysical=conditions.members.flatMap(m=>m.items.filter(i=>!isWear(i.family)&&m.tier!=='PREMIUM'&&!i.modelPromise&&PROVISIONAL_FAMILIES.includes(i.family as ProvisionalFamily)&&i.variantIds.length===1).map(i=>({memberKey:m.key+':'+i.family,age:m.age,family:i.family as ProvisionalFamily,variantId:i.variantIds[0]!})));
 const eligibleWear=wear.infeasible.map(w=>({memberKey:w.key,age:w.age,family:w.family as ProvisionalFamily,variantId:w.variant}));
 const eligible=[...eligiblePhysical,...eligibleWear];
 if(!eligible.length)return {...primary,provisional:NONE,wearExcludeKeys:NO_KEYS};
 // Canonical booking size from the ledger variant itself, never the raw request string.
 const variantRows=(await c.query<{id:string;size:string}>('SELECT id,size FROM ledger_variants WHERE id=ANY($1::uuid[])',[eligible.map(e=>e.variantId)])).rows;
 const withSize=eligible.map(e=>({...e,bookingSize:variantRows.find(v=>v.id===e.variantId)?.size})).filter((e):e is typeof e&{bookingSize:string}=>!!e.bookingSize);
 if(withSize.length!==eligible.length)return {...primary,provisional:NONE,wearExcludeKeys:NO_KEYS}; // an eligible item whose variant can't be resolved is not silently dropped from the demand — no fallback, original INSUFFICIENT stands
 const excludeKeys=new Set(eligiblePhysical.map(e=>'candidate/'+e.memberKey));
 let retry=await planAllocation(c,conditions,now,ignore,pin,excludeKeys,true,bufferOverride);
 if(retry.result!=='FEASIBLE')return {...primary,provisional:NONE,wearExcludeKeys:NO_KEYS}; // even the physical items provisional could ever cover aren't enough — some other requirement is short
 // Greedy re-inclusion: prefer physical for every eligible item the remaining physical stock can
 // actually still cover, one at a time, so "physical preferred" holds per item, not just overall.
 for(const e of eligiblePhysical){
  const candidateExclude=new Set(excludeKeys);candidateExclude.delete('candidate/'+e.memberKey);
  const attempt=await planAllocation(c,conditions,now,ignore,pin,candidateExclude,true,bufferOverride);
  if(attempt.result==='FEASIBLE'){excludeKeys.delete('candidate/'+e.memberKey);retry=attempt;}
 }
 const stillProvisionalPhysical=eligiblePhysical.filter(e=>excludeKeys.has('candidate/'+e.memberKey));
 const requirements:ProvisionalRequirement[]=[...stillProvisionalPhysical,...eligibleWear].map(e=>({key:e.memberKey,family:e.family,age:e.age,bookingSize:withSize.find(w=>w.memberKey===e.memberKey)!.bookingSize}));
 const days=normalizePeriod(conditions.period).dates;
 const plan=await provisionalCapacity(c,requirements,days,now,ignore,bufferOverride);
 if(!plan.feasible)return {...primary,provisional:NONE,wearExcludeKeys:NO_KEYS};
 return {...retry,provisional:requirements,wearExcludeKeys:new Set(eligibleWear.map(e=>e.memberKey))};
}
