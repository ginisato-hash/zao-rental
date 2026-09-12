import type {Pool,PoolClient} from 'pg';
import {LedgerError,type StoreId} from '../../contracts/src/ledger';
import {loadStaff} from './staff-auth';
export async function verifyLedgerWrite(ledger:Pick<PoolClient,'query'>,auth:Pool,identity:{subject:string;sessionId:string},storeIds:readonly StoreId[],global:boolean){
 // Acquired only AFTER inventory/target-row waits, released by the ledger COMMIT/ROLLBACK.
 // A failed auth connection therefore cannot release the ledger's ordering protection.
 await ledger.query('SELECT pg_advisory_xact_lock_shared(71820901,hashtext($1))',[identity.subject]);
 const c=await auth.connect();
 try{await c.query('BEGIN READ ONLY');await c.query("SET LOCAL lock_timeout='750ms'; SET LOCAL statement_timeout='1500ms'");
  const live=(await c.query('SELECT 1 FROM auth_session WHERE id=$1 AND "userId"=$2 AND "expiresAt">clock_timestamp()',[identity.sessionId,identity.subject])).rowCount;
  const p=live?await loadStaff(c,identity.subject):null;
  if(!p||!p.permissions.includes('INVENTORY_VIEW')||!p.permissions.includes('INVENTORY_EDIT')||global&&p.scope!=='ALL'||storeIds.some(s=>!p.storeIds.includes(s)))throw new LedgerError('FORBIDDEN',403);
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
