import {HoldError} from '../../../contracts/src/hold';
import {canonicalPeer,type TrustedIngressAdapter} from './trusted-ingress';
/** Dispatcher composition helper, not proof that a provider has been verified.
 * bind must stay in the trusted dispatcher; it never accepts/reads request headers.
 * Normal Vercel runtime is still unconnected. A clone is a new untrusted Request
 * until that dispatcher explicitly supplies its independently verified metadata. */
export function createRequestPeerBoundary(id:string){
 if(!/^[A-Za-z0-9_-]{1,80}$/.test(id))throw new HoldError('TRUSTED_INGRESS_REQUIRED',503);
 const records=new WeakMap<Request,Readonly<{adapterId:string;address:string}>>();
 const adapter:TrustedIngressAdapter=Object.freeze({id,peer:(request:Request)=>records.get(request)});
 return Object.freeze({adapter,bind(request:Request,peer:{adapterId:string;address:string}){
  if(!(request instanceof Request)||peer.adapterId!==id)throw new HoldError('TRUSTED_INGRESS_REQUIRED',503);
  const address=canonicalPeer(peer.address),prior=records.get(request);
  if(prior&&prior.address!==address)throw new HoldError('TRUSTED_INGRESS_REBIND_REJECTED',503);
  records.set(request,Object.freeze({adapterId:id,address}));
 }});
}
