import {isIP} from 'node:net';
import {HoldError} from '../../../contracts/src/hold';
import {guestPeerKey} from './security';
/** Implement only at the hosting dispatcher/socket boundary, using verified out-of-band
 * metadata. An adapter that copies request headers violates this interface's trust contract.
 * Request has no trusted peer field. No fallback to Forwarded/XFF/X-Real-IP is allowed. */
export interface TrustedIngressAdapter{readonly id:string;peer(request:Request):{adapterId:string;address:string}|undefined;}
export function canonicalPeer(address:string){
 if(address.includes('%'))throw new HoldError('TRUSTED_INGRESS_REQUIRED',503);
 if(isIP(address)===4)return address;
 if(isIP(address)!==6)throw new HoldError('TRUSTED_INGRESS_REQUIRED',503);
 const ip=new URL('http://['+address+']/').hostname.slice(1,-1);
 const mapped=/^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(ip);
 if(mapped){const a=parseInt(mapped[1]!,16),b=parseInt(mapped[2]!,16);return [a>>8,a&255,b>>8,b&255].join('.');}return ip;
}
export function trustedGuestPeer(adapter:TrustedIngressAdapter,expectedId:string,serverKey:string){
 if(!adapter||adapter.id!==expectedId||typeof adapter.peer!=='function'||serverKey.length<32)throw new HoldError('TRUSTED_INGRESS_REQUIRED',503);
 return(request:Request)=>{const p=adapter.peer(request);if(!p||p.adapterId!==expectedId)throw new HoldError('TRUSTED_INGRESS_REQUIRED',503);return guestPeerKey(canonicalPeer(p.address),serverKey);};
}
