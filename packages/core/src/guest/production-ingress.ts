import {ProductionStartupError,type ProductionConfiguration} from '../../../auth/src/production-config';
import {canonicalPeer,type TrustedIngressAdapter} from './trusted-ingress';
export type VerifiedProductionPeer={provider:'VERCEL';environment:'production';projectId:string;releaseId:string;origin:string;address:string};
/** This callback belongs to the provider's verified dispatcher/socket integration.
 * It must not derive proof or the address from HTTP headers or user request data. */
export function productionIngress(c:ProductionConfiguration,verified:(request:Request)=>VerifiedProductionPeer|undefined):TrustedIngressAdapter{
 if(typeof verified!=='function')throw new ProductionStartupError('INGRESS');
 return Object.freeze({id:c.guest.ingressAdapterId,peer(request:Request){const p=verified(request),d=c.deployment;
  if(!p||p.provider!==d.provider||p.environment!==d.environment||p.projectId!==d.projectId||p.releaseId!==d.releaseId||p.origin!==d.origin)return undefined;
  try{return {adapterId:c.guest.ingressAdapterId,address:canonicalPeer(p.address)};}catch{return undefined;}
 }});
}
