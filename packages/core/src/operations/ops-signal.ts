import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {operationalExceptionSignal,type ExceptionSignalCode} from '../../../contracts/src/production-operations';
/** Fixed operational vocabulary only. No Error, request, response or provider object can
 * enter this port, and failing to observe never rolls back the business work that failed. */
export async function observeOperationalFailure(pool:Pool,code:ExceptionSignalCode,store='SYSTEM',correlationId=randomUUID()){
 try{
  const signal=operationalExceptionSignal({eventType:code,correlationId,store});
  await pool.query('SELECT ops_observe_signal($1,$2,$3)',[signal.eventType,signal.correlationId,signal.store]);
  return true;
 }catch{return false;}
}
