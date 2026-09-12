import type {PoolClient} from 'pg';
// Caller already owns the inventory lock and a trusted actor/audit context.
// This changes only projection lifecycle, never received quantity, custody or historical IDs.
export async function closeReadyTransfers(c:Pick<PoolClient,'query'>,target:{batchId?:string;assetId?:string;poleId?:string}){
 return (await c.query<{id:string}>(`UPDATE transfer_pieces p SET state='CLOSED'
 WHERE p.state='READY' AND ($1::uuid=p.batch_id OR $2::uuid=p.asset_id OR $3::uuid IN (p.source_pole_id,p.destination_pole_id,p.receipt_pole_id))
 AND NOT EXISTS(SELECT 1 FROM transfer_batches b WHERE b.id=p.batch_id AND b.issue IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM inventory_claims cl WHERE cl.active AND (cl.transfer_piece_id=p.id OR cl.asset_id=p.asset_id)) RETURNING p.id`,[target.batchId??null,target.assetId??null,target.poleId??null])).rows;
}
