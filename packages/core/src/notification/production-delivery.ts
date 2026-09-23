import {exactProductionIdentityConfiguration,type ExactProductionIdentity} from '../../../auth/src/production-identity';
import {FlowError} from '../../../contracts/src/rental-flow';
import {ResendDelivery} from './resend';
import type {BookingNotificationDelivery} from './contracts';
/** Owner-selected Resend binding, installed only with registered Production identity. No SDK, environment
 * discovery, credential persistence, network call or automatic provider fallback. */
export type ProductionNotificationBinding={
 environment:'PRODUCTION';providerId:string;
 credentials:()=>Promise<{secret:string;revoked:boolean}>;
 fetch:(url:string,init:RequestInit)=>Promise<Response>;
};
export async function productionNotificationDelivery(binding:ProductionNotificationBinding|undefined,identity?:ExactProductionIdentity):Promise<BookingNotificationDelivery>{
 const denied=()=>new FlowError('BOOKING_RECOVERY_DELIVERY_UNCONNECTED',503);
 if(!exactProductionIdentityConfiguration(identity)||!binding||binding.environment!=='PRODUCTION'||binding.providerId!=='RESEND'||typeof binding.credentials!=='function'||typeof binding.fetch!=='function')throw denied();
 const validate=async()=>{try{const c=await binding.credentials();if(!c||c.revoked||typeof c.secret!=='string'||!/^re_[-A-Za-z0-9_]{16,200}$/.test(c.secret))throw Error();return c;}catch{throw denied();}};
 await validate();return new ResendDelivery(validate,binding.fetch);
}
