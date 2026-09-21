import {FlowError} from '../../../contracts/src/rental-flow';
import type {BookingNotificationDelivery} from './contracts';
/** Integration port only: the Owner selects a provider later. No SDK, environment
 * discovery, credential persistence, network call or automatic provider fallback. */
export type ProductionNotificationBinding={
 environment:'PRODUCTION';providerId:string;
 credentials:()=>Promise<{secret:string;revoked:boolean}>;
 delivery:BookingNotificationDelivery;
};
export async function productionNotificationDelivery(binding:ProductionNotificationBinding|undefined):Promise<BookingNotificationDelivery>{
 const denied=()=>new FlowError('BOOKING_RECOVERY_DELIVERY_UNCONNECTED',503);
 if(!binding||binding.environment!=='PRODUCTION'||!/^[-A-Z0-9_]{1,64}$/.test(binding.providerId)||typeof binding.credentials!=='function'||typeof binding.delivery?.send!=='function'||typeof binding.delivery?.lookup!=='function')throw denied();
 const validate=async()=>{try{const c=await binding.credentials();if(!c||c.revoked||typeof c.secret!=='string'||c.secret.length<16)throw Error();}catch{throw denied();}};
 await validate();return {async send(message,signal){await validate();return binding.delivery.send(message,signal);},async lookup(key,signal){await validate();return binding.delivery.lookup(key,signal);}};
}
