import type {PoolClient} from 'pg';
import {intakeWindow,type IntakeHold,type CandidateContext} from '../../../contracts/src/hold-intake';
import type {HoldConditions} from '../../../contracts/src/hold';
// Both domain roles already have SELECT on these E07 projections. No new grants,
// public route, client continuation flag or migration credential are required.
export async function heldIntake(c:Pick<PoolClient,'query'>,conditions:HoldConditions,now:Date,h:IntakeHold|null=null,context?:CandidateContext){
 if(h){const protectedTransfer=Boolean((await c.query(`SELECT 1 FROM inventory_claims cl JOIN transfer_pieces p ON p.id=cl.transfer_piece_id JOIN transfer_batches b ON b.id=p.batch_id WHERE cl.active AND cl.hold_id=$1 AND (p.state<>'PLANNED' OR b.issue IS NOT NULL OR b.planned_ready_at<$2) LIMIT 1`,[h.id,now])).rowCount);if(protectedTransfer)h={...h,transfer_attention:'TRANSFER_RECONCILIATION_REQUIRED'};}
 return intakeWindow(conditions,now,h,context);
}
