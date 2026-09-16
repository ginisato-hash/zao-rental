import {productionRequested,getProductionRuntime} from './production-runtime';
import {BookingRecovery} from '../../../../packages/core/src/guest/booking-recovery';
import 'server-only';
import {deriveBookingAccessKeys} from '../../../../packages/core/src/guest/booking-access-keys';
import {Pool} from 'pg';
import type {Connection} from '../../../../packages/auth/src/config';
import {BookingAccess} from '../../../../packages/core/src/guest/booking-access';
import {publicRuntime} from './public-runtime';
let pool:Pool|undefined;
/** Production uses the one verified server composition; local launcher stays isolated. */
export function bookingAccessRuntime(){
 if(productionRequested()){const r=getProductionRuntime();return r?.public&&r.guest&&r.access?{p:r.public,access:r.access,recovery:r.recovery??undefined,guard:(request:Request)=>r.guest!.security.service.guard(r.guest!.security.peer(request))}:null;}
 if(process.env.NODE_ENV==='production')return null;
 const p=publicRuntime(),raw=process.env.ZAO_BOOKING_ACCESS_RUNTIME;
 if(!p||!raw)return null;
 const c=JSON.parse(raw) as Connection;
 if(c.host!=='127.0.0.1'||c.database!==p.r.config.namespace||c.user!==p.r.config.namespace+'_booking_access'||c.port!==p.r.config.authDb.port||!c.password)throw new Error('BOOKING_ACCESS_RUNTIME_INVALID');
 if(!pool){pool=new Pool({...c,max:4});pool.on('error',()=>{});}
 const keys=deriveBookingAccessKeys(p.r.config.authSecret);
 return {p,guard:undefined,access:new BookingAccess(pool,keys.accessKey,'development-v1'),recovery:new BookingRecovery(pool,keys.recoveryKey,'development-recovery-v1')};
}
