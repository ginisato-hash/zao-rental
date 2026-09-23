import type {PoolClient} from 'pg';
import {HoldError,isWear,normalizePeriod,type HoldConditions} from '../../../contracts/src/hold';
type Conn=Pick<PoolClient,'query'>;

/** V2 (provisional-capacity correction): the per-requirement work, never short-circuiting on the
 * first shortfall — every requirement is checked, so a caller (HoldService) can identify exactly
 * which specific wear items are physically infeasible and route only those to the provisional
 * fallback, while every other, physically-satisfiable wear item still uses real wear_pools
 * capacity ("physical preferred", never gratuitously provisional). `wearCapacity()` below remains
 * the original all-or-nothing entry point, unchanged for every existing caller. */
// V5 (release-code-closure, 95% public / staff INVENTORY_BUFFER_OVERRIDE): `bufferOverride`
// (default false, so every existing caller keeps the strict public ceiling unless it explicitly
// opts in) — a non-override request may never push *public* usage of a pool past
// floor(ready*0.95) on any day, even though the pool's true operational capacity (`ready`) is
// higher; an override request may use up to the full `ready` ceiling, which the hard per-day
// check below always enforces regardless of override status, so public+override usage can never
// together exceed true capacity.
export async function wearCapacityDetailed(c:Conn,conditions:HoldConditions,now:Date,ignore:string|null,excludeKeys?:ReadonlySet<string>,bufferOverride=false){
 const requirements=conditions.members.flatMap(m=>m.items.filter(i=>isWear(i.family)).map(i=>({key:m.key+':'+i.family,age:m.age,family:i.family,variant:i.variantIds[0]!}))).filter(r=>!excludeKeys?.has(r.key));
 if(!requirements.length)return {feasible:true,rows:[] as {key:string;pool:string;day:string}[],infeasible:[] as {key:string;age:'ADULT'|'KIDS';family:string;variant:string}[]};
 const variants=[...new Set(requirements.map(r=>r.variant))],days=normalizePeriod(conditions.period).dates;
 const pools=(await c.query<{id:string;variant_id:string;ready:number}>(`SELECT p.id,p.variant_id,(p.ready-coalesce((SELECT sum(t.quantity) FROM wear_transfers t WHERE t.source_pool_id=p.id AND t.state='PLANNED'),0))::int AS ready FROM wear_pools p WHERE store_id=$1 AND variant_id=ANY($2::uuid[])`,[conditions.pickupStore,variants])).rows;
 const claims=(await c.query<{pool_id:string;day:string;quantity_all:number;quantity_public:number}>(`SELECT c.pool_id,c.day::text,sum(c.quantity)::int AS quantity_all,coalesce(sum(c.quantity) FILTER(WHERE NOT h.buffer_override),0)::int AS quantity_public FROM wear_claims c JOIN inventory_holds h ON h.id=c.hold_id WHERE c.active AND c.pool_id=ANY($1::uuid[]) AND c.day=ANY($2::date[]) AND ($3::uuid IS NULL OR h.id<>$3) AND h.state='ACTIVE' AND (h.expires_at>$4 OR h.payment_state IN ('PENDING','UNKNOWN','SUCCESS') OR h.allocation_stage<>'PROVISIONAL') AND NOT EXISTS(SELECT 1 FROM wear_loans l WHERE l.booking_id=h.reservation_id) GROUP BY c.pool_id,c.day`,[pools.map(p=>p.id),days,ignore,now])).rows;
 const ownLoans=ignore?(await c.query<{requirement_key:string;pool_id:string}>(`SELECT l.requirement_key,l.pool_id FROM wear_loans l JOIN rental_bookings b ON b.id=l.booking_id WHERE b.hold_id=$1 AND l.quantity-l.returned=1`,[ignore])).rows:[];
 // Check-then-commit per requirement (not optimistic-mutate-then-rollback): each day's increment
 // is 0 or 1 depending on ownLoans exclusion, so a naive "subtract 1 on rollback" would under/over
 // count that case. Checking every day first, only mutating `counts` once the whole requirement is
 // known feasible, is correct regardless of the increment value.
 const counts=new Map<string,number>(),rows:{key:string;pool:string;day:string}[]=[],infeasible:{key:string;age:'ADULT'|'KIDS';family:string;variant:string}[]=[];
 for(const r of requirements){
  const pool=pools.find(p=>p.variant_id===r.variant);
  if(!pool){infeasible.push({key:r.key,age:r.age,family:r.family,variant:r.variant});continue;}
  const publicCap=Math.floor(pool.ready*0.95);
  const increments=days.map(day=>{const key=pool.id+'/'+day,n=(counts.get(key)??0)+(ownLoans.some(l=>l.requirement_key===r.key&&l.pool_id===pool.id)?0:1);return {day,key,n};});
  const ok=increments.every(({day,n})=>{
   const claim=claims.find(x=>x.pool_id===pool.id&&x.day===day);
   if(n+(claim?.quantity_all??0)>pool.ready)return false;
   return bufferOverride||n+(claim?.quantity_public??0)<=publicCap;
  });
  if(ok){for(const {key,n} of increments)counts.set(key,n);rows.push(...increments.map(({day})=>({key:r.key,pool:pool.id,day})));}
  else infeasible.push({key:r.key,age:r.age,family:r.family,variant:r.variant});
 }
 return {feasible:infeasible.length===0,rows,infeasible};
}
// One row represents a store/size pool; no unit slots, serials, or per-garment matching.
export async function wearCapacity(c:Conn,conditions:HoldConditions,now:Date,ignore:string|null,bufferOverride=false){
 const d=await wearCapacityDetailed(c,conditions,now,ignore,undefined,bufferOverride);
 return d.feasible?{feasible:true as const,rows:d.rows}:{feasible:false as const,rows:[] as {key:string;pool:string;day:string}[]};
}
/** `excludeKeys` (provisional-capacity correction): the same item is never written to both
 * wear_claims and provisional_capacity_claims — items HoldService routed to the provisional
 * fallback are excluded here so this write-boundary recheck only re-verifies (and only ever
 * throws WEAR_CAPACITY_CHANGED for) the requirements actually meant to be satisfied physically. */
export async function writeWearClaims(c:Conn,holdId:string,conditions:HoldConditions,now:Date,excludeKeys?:ReadonlySet<string>,bufferOverride=false){
 const plan=await wearCapacityDetailed(c,conditions,now,holdId,excludeKeys,bufferOverride);if(!plan.feasible)throw new HoldError('WEAR_CAPACITY_CHANGED',409);
 await c.query('UPDATE wear_claims SET active=false WHERE hold_id=$1 AND active',[holdId]);
 if(plan.rows.length)await c.query(`INSERT INTO wear_claims(hold_id,requirement_key,pool_id,day,quantity) SELECT $1,key,pool,day,1 FROM jsonb_to_recordset($2::jsonb) AS x(key text,pool uuid,day date)`,[holdId,JSON.stringify(plan.rows)]);
}
