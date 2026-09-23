import type {PoolClient} from 'pg';
import type {HoldConditions,PromiseVariant} from '../../../contracts/src/hold';
import type {ProjectionClaim} from '../payment/payment-projection';
/** Read all witnesses without deduplication. Caller owns inventory lock and authorization. */
export async function loadProtectionClaims(c:Pick<PoolClient,'query'>,holdId:string,conditions:HoldConditions):Promise<ProjectionClaim[]>{
  const claims=(await c.query<ProjectionClaim>(`SELECT c.requirement_key,c.day::text,'GEAR' AS kind,1 AS quantity,v.id,v.family,v.age,v.tier,v.model_id,m.catalog_season,v.compatible_sports,NULL::text AS booking_size,NULL::text AS store_id,NULL::uuid[] AS variant_ids
   FROM inventory_claims c LEFT JOIN ledger_assets a ON a.id=c.asset_id LEFT JOIN ledger_poles p ON p.id=c.pole_id
   LEFT JOIN ledger_variants v ON v.id=coalesce(a.variant_id,p.variant_id) LEFT JOIN ledger_models m ON m.id=v.model_id WHERE c.hold_id=$1 AND c.active
   UNION ALL SELECT c.requirement_key,c.day::text,'WEAR' AS kind,c.quantity,v.id,v.family,v.age,v.tier,v.model_id,m.catalog_season,v.compatible_sports,NULL::text AS booking_size,NULL::text AS store_id,NULL::uuid[] AS variant_ids
   FROM wear_claims c JOIN wear_pools p ON p.id=c.pool_id JOIN ledger_variants v ON v.id=p.variant_id JOIN ledger_models m ON m.id=v.model_id WHERE c.hold_id=$1 AND c.active
   UNION ALL SELECT c.requirement_key,c.day::text,'PROVISIONAL' AS kind,c.quantity,NULL::uuid,b.family,b.age,NULL::text,NULL::uuid,NULL::text,NULL::text[],b.booking_size,NULL::text,NULL::uuid[]
   FROM provisional_capacity_claims c JOIN provisional_capacity_buckets b ON b.id=c.bucket_id WHERE c.hold_id=$1 AND c.state='ACTIVE'
   UNION ALL SELECT requirement_key,day::text,'POLE_EXEMPT',1,NULL::uuid,NULL::text,NULL::text,NULL::text,NULL::uuid,NULL::text,NULL::text[],NULL::text,store_id,variant_ids FROM inventory_pole_exemptions WHERE hold_id=$1 AND active LIMIT 1401`,[holdId])).rows;
  const provisional=claims.filter(c=>c.kind==='PROVISIONAL');
  if(provisional.length){
   const items=conditions.members.flatMap(m=>m.items.map(i=>({key:m.key+':'+i.family,item:i})));
   const ids=items.filter(i=>provisional.some(c=>c.requirement_key===i.key)).flatMap(i=>i.item.variantIds);
   const variants=(await c.query<PromiseVariant&{size:string}>(`SELECT v.id,v.size,v.family,v.age,v.tier,v.model_id,m.catalog_season,v.compatible_sports FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id WHERE v.id=ANY($1::uuid[])`,[ids])).rows;
   for(const claim of provisional){const item=items.find(i=>i.key===claim.requirement_key)?.item;claim.requestedVariant=item?.variantIds.length===1?variants.find(v=>v.id===item.variantIds[0])??null:null;}
  }
  return claims;
}
