import type {PoolClient} from 'pg';
import {HoldError,isWear,normalizePeriod,type HoldConditions} from '../../../contracts/src/hold';
type Conn=Pick<PoolClient,'query'>;
// One row represents a store/size pool; no unit slots, serials, or per-garment matching.
export async function wearCapacity(c:Conn,conditions:HoldConditions,now:Date,ignore:string|null){
 const requirements=conditions.members.flatMap(m=>m.items.filter(i=>isWear(i.family)).map(i=>({key:m.key+':'+i.family,variant:i.variantIds[0]!})));
 if(!requirements.length)return {feasible:true,rows:[] as {key:string;pool:string;day:string}[]};
 const variants=[...new Set(requirements.map(r=>r.variant))],days=normalizePeriod(conditions.period).dates;
 const pools=(await c.query<{id:string;variant_id:string;ready:number}>(`SELECT p.id,p.variant_id,(p.ready-coalesce((SELECT sum(t.quantity) FROM wear_transfers t WHERE t.source_pool_id=p.id AND t.state='PLANNED'),0))::int AS ready FROM wear_pools p WHERE store_id=$1 AND variant_id=ANY($2::uuid[])`,[conditions.pickupStore,variants])).rows;
 const claims=(await c.query<{pool_id:string;day:string;quantity:number}>(`SELECT c.pool_id,c.day::text,sum(c.quantity)::int AS quantity FROM wear_claims c JOIN inventory_holds h ON h.id=c.hold_id WHERE c.active AND c.pool_id=ANY($1::uuid[]) AND c.day=ANY($2::date[]) AND ($3::uuid IS NULL OR h.id<>$3) AND h.state='ACTIVE' AND (h.expires_at>$4 OR h.payment_state IN ('PENDING','UNKNOWN','SUCCESS') OR h.allocation_stage<>'PROVISIONAL') AND NOT EXISTS(SELECT 1 FROM wear_loans l WHERE l.booking_id=h.reservation_id) GROUP BY c.pool_id,c.day`,[pools.map(p=>p.id),days,ignore,now])).rows;
 const ownLoans=ignore?(await c.query<{requirement_key:string;pool_id:string}>(`SELECT l.requirement_key,l.pool_id FROM wear_loans l JOIN rental_bookings b ON b.id=l.booking_id WHERE b.hold_id=$1 AND l.quantity-l.returned=1`,[ignore])).rows:[];
 const counts=new Map<string,number>(),rows:{key:string;pool:string;day:string}[]=[];
 for(const r of requirements){const pool=pools.find(p=>p.variant_id===r.variant);if(!pool)return {feasible:false,rows:[]};for(const day of days){const key=pool.id+'/'+day,n=(counts.get(key)??0)+(ownLoans.some(l=>l.requirement_key===r.key&&l.pool_id===pool.id)?0:1);counts.set(key,n);if(n+(claims.find(x=>x.pool_id===pool.id&&x.day===day)?.quantity??0)>pool.ready)return {feasible:false,rows:[]};rows.push({key:r.key,pool:pool.id,day});}}
 return {feasible:true,rows};
}
export async function writeWearClaims(c:Conn,holdId:string,conditions:HoldConditions,now:Date){
 const plan=await wearCapacity(c,conditions,now,holdId);if(!plan.feasible)throw new HoldError('WEAR_CAPACITY_CHANGED',409);
 await c.query('UPDATE wear_claims SET active=false WHERE hold_id=$1 AND active',[holdId]);
 if(plan.rows.length)await c.query(`INSERT INTO wear_claims(hold_id,requirement_key,pool_id,day,quantity) SELECT $1,key,pool,day,1 FROM jsonb_to_recordset($2::jsonb) AS x(key text,pool uuid,day date)`,[holdId,JSON.stringify(plan.rows)]);
}
