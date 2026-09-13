import {HoldError} from './hold';
import {exact} from './pricing';
export type GuestSecurityPolicy={version:string;contextSeconds:number;absoluteSeconds:number;recoverySeconds:number;replaySeconds:number;retentionSeconds:number;windowSeconds:number;peerRequests:number;globalRequests:number};
export function guestSecurityPolicy(input:unknown):Readonly<GuestSecurityPolicy>{
 const p=exact(input,['version','contextSeconds','absoluteSeconds','recoverySeconds','replaySeconds','retentionSeconds','windowSeconds','peerRequests','globalRequests']);
 if(typeof p.version!=='string'||!/^[-a-zA-Z0-9_.]{1,64}$/.test(p.version))throw new HoldError('GUEST_POLICY_REQUIRED',503);
 for(const k of ['contextSeconds','absoluteSeconds','recoverySeconds','replaySeconds','retentionSeconds','windowSeconds','peerRequests','globalRequests'])if(!Number.isSafeInteger(p[k])||Number(p[k])<1||Number(p[k])>31_536_000)throw new HoldError('GUEST_POLICY_REQUIRED',503);
 const v=p as GuestSecurityPolicy;if(v.contextSeconds>v.absoluteSeconds||v.recoverySeconds>v.absoluteSeconds||v.replaySeconds>v.contextSeconds||v.globalRequests<v.peerRequests||v.windowSeconds>3600)throw new HoldError('GUEST_POLICY_REQUIRED',503);return Object.freeze({...v});
}
export const recoverySecret=(s:unknown):s is string=>typeof s==='string'&&/^[-_A-Za-z0-9]{43}$/.test(s);
