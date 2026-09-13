import {createHash} from 'node:crypto';
import {canonical,HoldError} from './hold';
import {exact} from './pricing';
import {guestSecurityPolicy,type GuestSecurityPolicy} from './guest-security';
export type ProductionGuestConfiguration={schemaVersion:1;revision:string;ingressAdapterId:string;policy:Readonly<GuestSecurityPolicy>};
/** Configuration is deployment-owned, never request JSON. Parsing confers no launch approval. */
export function productionGuestConfiguration(input:unknown):Readonly<ProductionGuestConfiguration>{
 try{const p=exact(input,['schemaVersion','revision','ingressAdapterId','policy']);
  if(p.schemaVersion!==1||typeof p.revision!=='string'||!/^[-A-Za-z0-9_.]{1,64}$/.test(p.revision)||typeof p.ingressAdapterId!=='string'||!/^[-A-Za-z0-9_.]{1,64}$/.test(p.ingressAdapterId))throw new Error();
  return Object.freeze({schemaVersion:1,revision:p.revision,ingressAdapterId:p.ingressAdapterId,policy:guestSecurityPolicy(p.policy)});
 }catch{throw new HoldError('PRODUCTION_GUEST_CONFIGURATION_INVALID',503);}
}
export const guestConfigurationHash=(c:ProductionGuestConfiguration)=>createHash('sha256').update(canonical(productionGuestConfiguration(c))).digest('hex');
/** The digest must come from separately approved deployment release evidence. No default values. */
export function approvedGuestConfiguration(input:unknown,approvedDigest:string|undefined){
 const c=productionGuestConfiguration(input);if(!approvedDigest||!/^[a-f0-9]{64}$/.test(approvedDigest)||guestConfigurationHash(c)!==approvedDigest)throw new HoldError('PRODUCTION_GUEST_POLICY_NOT_APPROVED',503);return c;
}

export function guestConfigurationFromEnvironment(env:Readonly<Record<string,string|undefined>>,approvedDigest:string|undefined){
 const raw=env.ZAO_PRODUCTION_GUEST_CONFIG;if(!raw||Buffer.byteLength(raw)>16384)throw new HoldError('PRODUCTION_GUEST_CONFIGURATION_INVALID',503);
 let value:unknown;try{value=JSON.parse(raw);}catch{throw new HoldError('PRODUCTION_GUEST_CONFIGURATION_INVALID',503);}return approvedGuestConfiguration(value,approvedDigest);
}
