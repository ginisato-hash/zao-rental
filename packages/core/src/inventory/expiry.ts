import type {PoolClient} from 'pg';
export async function expireInventoryHolds(c:Pick<PoolClient,'query'>,now:Date,ids?:string[]){
 const rows=(await c.query<{id:string}>("UPDATE inventory_holds SET state='EXPIRED',version=version+1 WHERE state='ACTIVE' AND allocation_stage='PROVISIONAL' AND expires_at<=$1 AND payment_state IN ('NONE','FAILURE') AND ($2::uuid[] IS NULL OR id=ANY($2)) RETURNING id",[now,ids??null])).rows;
 if(rows.length){
  const expired=rows.map(r=>r.id);
  await c.query('UPDATE inventory_claims SET active=false WHERE hold_id=ANY($1::uuid[]) AND active',[expired]);
  await c.query("UPDATE provisional_capacity_claims SET state='RELEASED',released_at=clock_timestamp() WHERE hold_id=ANY($1::uuid[]) AND state='ACTIVE'",[expired]);
 }
}
