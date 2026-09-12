import type {Pool} from 'pg';
import {LedgerError} from '../../../contracts/src/ledger';
import {loadStaff} from '../../../auth/src/staff-auth';
import {verifyLedgerWrite} from '../../../auth/src/ledger-write-authority';
import {expireInventoryHolds} from '../inventory/expiry';
import {closeReadyTransfers} from '../transfer/completion';
// Internal only: uses the existing transfer role's narrow lifecycle rights, not ledger privileges.
// Reconciliation is its own committed transaction. The following ledger write re-locks/re-authorizes;
// an intervening valid HOLD is still protected by the unchanged database stock guard.
export async function reconcileLedgerProtection(pool:Pool,auth:Pool,identity:{subject:string;sessionId:string},resource:'assets'|'poles',id:string,version:number){
 const table=resource==='assets'?'ledger_assets':'ledger_poles';
 const allowed=async(c:Pick<Pool,'query'>)=>{const p=await loadStaff(c,identity.subject);const row=(await c.query<{store_id:string;version:number}>(`SELECT store_id,version FROM ${table} WHERE id=$1`,[id])).rows[0];
  if(!p||!p.permissions.includes('INVENTORY_VIEW')||!p.permissions.includes('INVENTORY_EDIT')||!row||!p.storeIds.includes(row.store_id as never))throw new LedgerError('FORBIDDEN',403);if(row.version!==version)throw new LedgerError('STALE_VERSION',409);return row;};
 await allowed(pool);const c=await pool.connect();
 try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='5000ms';SET LOCAL idle_in_transaction_session_timeout='10000ms'");await c.query('SELECT pg_advisory_xact_lock(71820600)');const row=await allowed(c);
  await verifyLedgerWrite(c,auth,identity,[row.store_id as 'MOUNTAIN_BASE'|'ONSEN_BASE'],false);
  await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','Ledger protection reconciliation',true)",[identity.subject]);
  const now=(await c.query<{now:Date}>('SELECT inventory_clock() AS now')).rows[0]!.now;
  // Release the entire eligible expired group, but only when it touches this target.
  // Physical preparation/dispatch witnesses remain protected even when a provisional lease elapsed.
  const ids=(await c.query<{id:string}>(`SELECT DISTINCT h.id FROM inventory_holds h JOIN inventory_claims cl ON cl.hold_id=h.id AND cl.active
   LEFT JOIN transfer_pieces tp ON tp.id=cl.transfer_piece_id
   WHERE h.state='ACTIVE' AND h.allocation_stage='PROVISIONAL' AND h.payment_state IN ('NONE','FAILURE') AND h.expires_at<=$1
   AND (cl.asset_id=$2::uuid OR cl.pole_id=$3::uuid OR $3::uuid IN (tp.source_pole_id,tp.destination_pole_id,tp.receipt_pole_id))
   AND NOT EXISTS(SELECT 1 FROM inventory_claims pinned JOIN transfer_pieces pp ON pp.id=pinned.transfer_piece_id WHERE pinned.hold_id=h.id AND pinned.active AND pp.state IN ('IN_TRANSIT','RECEIVED','READY'))`,[now,resource==='assets'?id:null,resource==='poles'?id:null])).rows.map(h=>h.id);
  await expireInventoryHolds(c,now,ids);await closeReadyTransfers(c,resource==='assets'?{assetId:id}:{poleId:id});await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK').catch(()=>{});if(e instanceof LedgerError)throw e;throw new LedgerError('PROTECTION_RECONCILIATION_REQUIRED',409);}finally{c.release();}
}
