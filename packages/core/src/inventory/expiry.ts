import type {PoolClient} from 'pg';
export async function expireInventoryHolds(c:Pick<PoolClient,'query'>,now:Date){
 const rows=(await c.query<{id:string}>("UPDATE inventory_holds SET state='EXPIRED',version=version+1 WHERE state='ACTIVE' AND allocation_stage='PROVISIONAL' AND expires_at<=$1 AND payment_state IN ('NONE','FAILURE') RETURNING id",[now])).rows;
 if(rows.length)await c.query('UPDATE inventory_claims SET active=false WHERE hold_id=ANY($1::uuid[]) AND active',[rows.map(r=>r.id)]);
}
