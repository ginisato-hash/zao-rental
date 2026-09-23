import type {VerifiedProductionPeer} from './production-ingress';
/** Production counterpart of vercel-preview-peer.ts, with the same trust basis: Vercel's direct
 * ingress sets x-vercel-forwarded-for to the edge peer and overwrites client-supplied values
 * (https://vercel.com/docs/headers/request-headers). Only that single header is read; no generic
 * Forwarded/XFF/X-Real-IP fallback and no chain parsing. Every other field comes from the validated
 * deployment configuration, never from the request. productionIngress() canonicalises the address. */
export function vercelProductionPeer(deployment:Readonly<Omit<VerifiedProductionPeer,'address'>>){
 const bound=Object.freeze({provider:deployment.provider,environment:deployment.environment,projectId:deployment.projectId,releaseId:deployment.releaseId,origin:deployment.origin});
 return (request:Request):VerifiedProductionPeer|undefined=>{
  const peer=request.headers.get('x-vercel-forwarded-for');
  if(!peer||peer!==peer.trim()||peer.includes(','))return undefined;
  return {...bound,address:peer};
 };
}
