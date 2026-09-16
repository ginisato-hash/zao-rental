import type {Pool,PoolClient} from 'pg';
import {loadStaff,type Permission} from '../../../auth/src/staff-auth';
import {FlowError,flowHash,flowId} from '../../../contracts/src/rental-flow';
import {ContentInputError} from '../content/bulk-plan';
import {HoldError} from '../../../contracts/src/hold';
export type OpsIdentity={subject:string;sessionId:string};
export type OpsConnection=Pick<PoolClient,'query'>;
export function operationalReason(value:unknown):string{if(typeof value!=='string'||!value.trim()||value.length>160)throw new FlowError('REASON_REQUIRED',422);return value.trim();}
// One owned local connection, the maintained staff session and the existing inventory
// serialization boundary. There is no owner connection or provider adapter here.
export class OperationsContext{
 constructor(readonly pool:Pool,readonly authPool:Pool,readonly identity:OpsIdentity){}
 async authorize(permission:Permission,stores:string[]=[]){
  const c=await this.authPool.connect();try{
   const live=(await c.query('SELECT 1 FROM auth_session WHERE id=$1 AND "userId"=$2 AND "expiresAt">clock_timestamp()',[this.identity.sessionId,this.identity.subject])).rowCount;
   const p=live?await loadStaff(c,this.identity.subject):null;if(!p)throw new FlowError('UNAUTHENTICATED',401);
   if(!p.permissions.includes(permission)||stores.some(s=>!p.storeIds.includes(s as never)))throw new FlowError('FORBIDDEN',403);return p;
  }finally{c.release();}
 }
 async transaction<T>(permission:Permission,stores:string[],reason:string,work:(c:PoolClient,now:Date)=>Promise<T>):Promise<T>{
  await this.authorize(permission,stores);const c=await this.pool.connect();try{
   await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='5000ms';SET LOCAL idle_in_transaction_session_timeout='10000ms'");
   await c.query('SELECT pg_advisory_xact_lock(71820600)');
   await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.session',$2,true),set_config('zao.reason',$3,true)",[this.identity.subject,this.identity.sessionId,reason]);
   await c.query('SELECT ops_assert_actor($1,$2::text[],$3)',[permission,stores,this.identity.subject]);
   const now=(await c.query<{now:Date}>('SELECT inventory_clock() AS now')).rows[0]!.now,result=await work(c,now);await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK');if(e instanceof FlowError||e instanceof HoldError||e instanceof ContentInputError)throw e;const code=(e as {code?:string}).code;
   if(code==='42501')throw new FlowError('FORBIDDEN',403);if(['23505','23503','23514','22P02'].includes(code??''))throw new FlowError('OPERATION_CONFLICT',409);
   if(['55P03','57014','40001','40P01'].includes(code??''))throw new FlowError('INDETERMINATE',503);throw new FlowError('OPERATION_FAILED',500);
  }finally{c.release();}
 }
 async idempotent<T>(c:PoolClient,key:string,input:unknown,work:()=>Promise<T>):Promise<T>{
  flowId(key);const fingerprint=flowHash(input),prior=(await c.query<{fingerprint:string;result:T}>('SELECT fingerprint,result FROM ops_requests WHERE actor=$1 AND request_key=$2',[this.identity.subject,key])).rows[0];
  if(prior){if(prior.fingerprint!==fingerprint)throw new FlowError('IDEMPOTENCY_MISMATCH',409);return prior.result;}
  const result=await work();await c.query('INSERT INTO ops_requests(actor,request_key,fingerprint,result) VALUES($1,$2,$3,$4)',[this.identity.subject,key,fingerprint,JSON.stringify(result)]);return result;
 }
}
