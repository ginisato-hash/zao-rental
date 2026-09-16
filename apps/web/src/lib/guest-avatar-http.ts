import {guestAvatarScope,type GuestAvatarScope} from '../../../../packages/contracts/src/guest-avatar';
import {HoldError,canonical} from '../../../../packages/contracts/src/hold';
import {avatarDerivative,avatarUuid,avatarDigest,type AvatarMediaReader} from '../../../../packages/core/src/avatar/media';
import {offeredAvatarVisual} from '../../../../packages/core/src/avatar/guest';
import type {AvatarPreviewPayloads} from '../../../../packages/core/src/avatar/preview';
const privateHeaders={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'};
type Loaded={payloads:AvatarPreviewPayloads;previewId:string};
export type GuestAvatarBoundary={guard:(request:Request)=>Promise<void>;load:(headers:Headers,scope:GuestAvatarScope)=>Promise<Loaded>;reader:(id:string)=>AvatarMediaReader};
/** Next normalizes loopback Request URLs to localhost; bind the actual Host and
 * port to the validated local runtime without trusting forwarding headers. */
export function assertLocalAvatarOrigin(request:Request,origin:string){
 const url=new URL(request.url),expected=new URL(origin);
 if(expected.protocol!=='http:'||expected.hostname!=='127.0.0.1'||url.protocol!==expected.protocol||url.port!==expected.port||!['127.0.0.1','localhost'].includes(url.hostname)||request.headers.get('host')!==expected.host)throw Error('LOCAL_ORIGIN_REQUIRED');
}
export function guestAvatarHandler(boundary:()=>GuestAvatarBoundary|null|Promise<GuestAvatarBoundary|null>,media:boolean){return async(req:Request)=>{
 const empty=()=>new Response(null,{status:404,headers:privateHeaders});
 if(req.method!=='GET')return new Response(null,{status:405,headers:{...privateHeaders,Allow:'GET'}});
 try{
  const url=new URL(req.url),prefix=media?'/guest-avatar-media/':'/api/guest/avatar/';
  if(url.search||!url.pathname.startsWith(prefix)||req.headers.get('sec-fetch-site')==='cross-site')return empty();
  const parts=url.pathname.slice(prefix.length).split('/');if(parts.length!==(media?5:3))return empty();
  const scope=guestAvatarScope(parts[0]!,parts[1]!,parts[2]!);if(!scope)return empty();
  if(media&&(!avatarUuid.test(parts[3]!)||!avatarDigest.test(parts[4]!)))return empty();
  const b=await boundary();if(!b)return empty();await b.guard(req);const before=await b.load(req.headers,scope);
  if(!media)return Response.json(before.payloads,{headers:privateHeaders});
  const ref=offeredAvatarVisual(before.payloads,parts[3]!,parts[4]!);if(!ref)return empty();
  const bytes=await avatarDerivative(b.reader(parts[3]!),parts[3]!,parts[4]!);if(!bytes)return empty();
  const after=await b.load(req.headers,scope),current=offeredAvatarVisual(after.payloads,parts[3]!,parts[4]!);
  if(after.previewId!==before.previewId||!current||canonical(current)!==canonical(ref))return empty();
  return new Response(new Uint8Array(bytes),{headers:{...privateHeaders,'Content-Type':'image/webp','Content-Length':String(bytes.length),'Content-Security-Policy':"default-src 'none'; sandbox"}});
 }catch(e){if(e instanceof HoldError&&e.code==='GUEST_RATE_LIMITED')return new Response(null,{status:429,headers:{...privateHeaders,'Retry-After':'60'}});return empty();}
};}
