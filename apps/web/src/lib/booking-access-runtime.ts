import {BookingRecovery} from '../../../../packages/core/src/guest/booking-recovery';
import 'server-only';
import {createHmac} from 'node:crypto';
import {Pool} from 'pg';
import type {Connection} from '../../../../packages/auth/src/config';
import {BookingAccess} from '../../../../packages/core/src/guest/booking-access';
import {publicRuntime} from './public-runtime';
let pool:Pool|undefined;
/** Owned development connection only. Production awaits secret store + verified ingress. */
export function bookingAccessRuntime(){
 if(process.env.NODE_ENV==='production')return null;
 const p=publicRuntime(),raw=process.env.ZAO_BOOKING_ACCESS_RUNTIME;
 if(!p||!raw)return null;
 const c=JSON.parse(raw) as Connection;
 if(c.host!=='127.0.0.1'||c.database!==p.r.config.namespace||c.user!==p.r.config.namespace+'_booking_access'||c.port!==p.r.config.authDb.port||!c.password)throw new Error('BOOKING_ACCESS_RUNTIME_INVALID');
 if(!pool){pool=new Pool({...c,max:4});pool.on('error',()=>{});}
 const key=createHmac('sha256',p.r.config.authSecret).update('zao-owned-development-booking-access-v1').digest();
 return {p,access:new BookingAccess(pool,key,'development-v1'),recovery:new BookingRecovery(pool,key,'development-v1')};
}
