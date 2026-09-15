import type {InboxPool} from './square-webhook-inbox';
export type R15Operation={manifestSha256:string;action:'CREATE_PAYMENT'|'GET_PAYMENT';bookingId:string;attemptId:string;idempotencyKey:string;locationId:string;paymentId:string|null};
/** COMMIT of an irreversible reservation precedes send. No lease/TTL, reset, retry,
 * default transport or secret reader. Reconstructing the process cannot reset it.
 * An uncertain commit consumes the budget conservatively and NEVER dispatches.
 * Only the migration owner may install the exact Git read-back manifest, separately. */
export async function dispatchR15Once<T>(pool:InboxPool,op:R15Operation,send:()=>Promise<T>):Promise<T>{
 if(!/^[a-f0-9]{64}$/.test(op.manifestSha256))throw new Error('R15_MANIFEST_REQUIRED');
 const c=await pool.connect().catch(()=>{throw new Error('R15_GUARD_UNAVAILABLE_DO_NOT_RETRY');});let broken=false;
 try{
  await c.query('BEGIN');
  await c.query("SET LOCAL synchronous_commit=on; SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='2500ms'; SET LOCAL idle_in_transaction_session_timeout='5000ms'");
  const r=await c.query<{acquired:boolean}>('SELECT r15_activation.reserve($1,$2,$3,$4,$5,$6,$7) AS acquired',[op.manifestSha256,op.action,op.bookingId,op.attemptId,op.idempotencyKey,op.locationId,op.paymentId]);
  if(r.rows[0]?.acquired!==true)throw new Error('R15_OPERATION_NOT_ACQUIRED');
  await c.query('COMMIT');
 }catch{broken=true;await c.query('ROLLBACK').catch(()=>{});throw new Error('R15_GUARD_NOT_ACQUIRED_DO_NOT_RETRY');}
 finally{c.release(broken);}
 // Deliberately OUTSIDE the transaction: failure never removes the reservation.
 return send();
}
