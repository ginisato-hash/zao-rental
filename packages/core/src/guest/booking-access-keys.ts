import {createHmac} from 'node:crypto';
import {FlowError} from '../../../contracts/src/rental-flow';
/** Server composition only. The existing P4 access root stays byte-for-byte stable.
 * This module never reads env or provides a credential default. */
export function deriveBookingAccessKeys(master:string|Uint8Array){
 if(Buffer.byteLength(master)<32)throw new FlowError('BOOKING_ACCESS_UNCONFIGURED',503);
 const accessKey=createHmac('sha256',master).update('zao-owned-development-booking-access-v1').digest();
 return {accessKey,recoveryKey:createHmac('sha256',master).update('zao-owned-development-booking-recovery-root-v1').digest()};
}
