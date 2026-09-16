import type {StaffState} from '../../../../packages/auth/src/staff-auth';
import {avatarDerivative,avatarUuid,avatarDigest,type AvatarMediaReader} from '../../../../packages/core/src/avatar/media';
const safeHeaders={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex','Content-Security-Policy':"default-src 'none'; sandbox"};
const allowed=(s:StaffState)=>s.status==='authorized'&&['BOOKING_VIEW','HOLD_VIEW','QUOTE_VIEW'].every(p=>s.principal.permissions.includes(p as never));
/** Phase4 is staff-only, including bytes. Client release/rights claims are never read. */
export function avatarMediaHandler(state:(headers:Headers)=>Promise<StaffState>,reader:(visualId:string)=>AvatarMediaReader|null,clock:()=>Date=()=>new Date()){
 return async(req:Request)=>{
  const empty=()=>new Response(null,{status:404,headers:safeHeaders});
  if(req.method!=='GET')return new Response(null,{status:405,headers:{...safeHeaders,Allow:'GET'}});
  try{
   const url=new URL(req.url),parts=url.pathname.split('/');
   if(url.search||parts.length!==4||parts[1]!=='avatar-media'||!avatarUuid.test(parts[2]!)||!avatarDigest.test(parts[3]!))return empty();
   const before=await state(req.headers);if(!allowed(before))return empty();
   const r=reader(parts[2]!);if(!r)return empty();const bytes=await avatarDerivative(r,parts[2]!,parts[3]!,clock);if(!bytes)return empty();
   const after=await state(req.headers);if(!allowed(after)||after.stamp!==before.stamp)return empty();
   return new Response(new Uint8Array(bytes),{headers:{...safeHeaders,'Content-Type':'image/webp','Content-Length':String(bytes.length)}});
  }catch{return empty();}
 };
}
