import {hostedPreviewRequestOrigin,HostedPreviewBoundaryError} from '../../../auth/src/hosted-preview-config';
import {canonicalPeer} from './trusted-ingress';
import {guestPeerKey} from './security';
/** Vercel's direct ingress overwrites XFF to prevent spoofing; the Vercel-specific
 * header remains the edge peer even when a customer proxy changes generic XFF.
 * This adapter requires the dedicated immutable Preview request ingress.
 * https://vercel.com/docs/headers/request-headers (verified2026-09-16).
 * No generic Forwarded/XFF/X-Real-IP fallback and no chain parsing. */
export function vercelPreviewPeer(request:Request,key:string){
 hostedPreviewRequestOrigin(request);
 const peer=request.headers.get('x-vercel-forwarded-for');
 if(!peer||peer!==peer.trim()||peer.includes(','))throw new HostedPreviewBoundaryError('INGRESS_PEER');
 try{return guestPeerKey(canonicalPeer(peer),key);}catch{throw new HostedPreviewBoundaryError('INGRESS_PEER');}
}
