import {previewOrigin} from '../../../auth/src/hosted-preview-config';
import {canonicalPeer} from './trusted-ingress';
import {guestPeerKey} from './security';
/** Vercel's direct ingress overwrites XFF to prevent spoofing; the Vercel-specific
 * header remains the edge peer even when a customer proxy changes generic XFF.
 * This adapter is usable only inside the exact platform-gated Phase6 Preview.
 * https://vercel.com/docs/headers/request-headers (verified2026-09-16).
 * No generic Forwarded/XFF/X-Real-IP fallback and no chain parsing. */
export function vercelPreviewPeer(request:Request,env:Readonly<Record<string,string|undefined>>,key:string){
 const origin=previewOrigin(env),url=new URL(request.url);
 if(url.origin!==origin||request.headers.get('host')!==url.host||request.headers.get('x-vercel-deployment-url')!==url.host)throw Error('PHASE6_INGRESS_REQUIRED');
 const peer=request.headers.get('x-vercel-forwarded-for');
 if(!peer||peer!==peer.trim()||peer.includes(','))throw Error('PHASE6_INGRESS_REQUIRED');
 return guestPeerKey(canonicalPeer(peer),key);
}
