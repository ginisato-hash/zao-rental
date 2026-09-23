import {r15ProjectionTarget,type R15ProjectionPermit} from '../../core/src/payment/r15-projection-authority';
import {productionProjectionTarget,type ProductionProjectionPermit} from '../../core/src/payment/production-projection-authority';
import type {InboxPool,InboxConnection} from './square-webhook-inbox';
import {ProjectionError,type PaymentProjectionRepository,type PaymentProjectionTransaction,type ProjectionReference,type ProjectionSource} from '../../core/src/payment/payment-projection';
import {PgProjectionTransaction} from './internal/payment-projection';
const ZR_PATTERN=/^zr_[a-f0-9]{12}$/;
/** No instantiated Pool, credential, HTTP or runtime. Only an explicitly injected local test repository. */
export class PgPaymentProjection implements PaymentProjectionRepository{
 constructor(private pool:InboxPool,private sourceReader?:(c:InboxConnection,ref:ProjectionReference)=>Promise<ProjectionSource|null>,private permit?:R15ProjectionPermit,private productionPermit?:ProductionProjectionPermit){}
 async transaction<T>(ref:ProjectionReference,run:(tx:PaymentProjectionTransaction)=>Promise<T>):Promise<T>{
  const target=r15ProjectionTarget(this.permit,ref);
  const productionTarget=productionProjectionTarget(this.productionPermit,ref);
  if((process.env.NODE_ENV==='production'||this.permit||this.productionPermit)&&!target&&!productionTarget)throw new ProjectionError('PROJECTION_NOT_ACTIVATED');
  const c=await this.pool.connect().catch(()=>{throw new ProjectionError('PROJECTION_STORAGE_UNAVAILABLE');});let broken=false;
  try{
   await c.query('BEGIN');await c.query("SET LOCAL synchronous_commit=on; SET LOCAL lock_timeout='1500ms'; SET LOCAL statement_timeout='5000ms'; SET LOCAL idle_in_transaction_session_timeout='10000ms'");
   const identity=(await c.query<{name:string;role:string}>('SELECT current_database() AS name,current_user AS role')).rows[0];const db=identity?.name;
   if(target&&(db!==target.database||identity?.role!==target.database+'_pay_projection'))throw new ProjectionError('PROJECTION_DEVELOPMENT_DB_ONLY');
   if(productionTarget){
    // Converse of the zr_* floor below: an explicitly Production-permitted call requires the
    // exact non-disposable database/role its permit was issued for — never any other identity,
    // and never a zr_* one (that would collapse to the ordinary dev floor, not a Production one).
    if(!db||ZR_PATTERN.test(db)||db!==productionTarget.database||identity?.role!==productionTarget.database+'_pay_projection')throw new ProjectionError('PROJECTION_PRODUCTION_DB_ONLY');
   }else if(!db||!ZR_PATTERN.test(db))throw new ProjectionError('PROJECTION_DEVELOPMENT_DB_ONLY');
   // Existing BookingService + stock writers acquire this BEFORE row locks. Not a new global lock.
   await c.query('SELECT pg_advisory_xact_lock(71820600)');
   const result=await run(new PgProjectionTransaction(c,ref,this.sourceReader));await c.query('COMMIT');return result;
  }catch(error){broken=true;await c.query('ROLLBACK').catch(()=>{});if(error instanceof ProjectionError)throw error;throw new ProjectionError('PROJECTION_STORAGE_UNAVAILABLE');}
  finally{c.release(broken);}
 }
}
