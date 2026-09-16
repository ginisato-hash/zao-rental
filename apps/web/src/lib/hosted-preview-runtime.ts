import 'server-only';
import {Pool} from 'pg';
import {proveNeonClientTls} from '../../../../packages/db/src/neon-tls';
import {parseHostedPreview,previewOrigin,phase6Services,phase6Database,phase6Role,type Phase6Service} from '../../../../packages/auth/src/hosted-preview-config';
import {GuestContexts} from '../../../../packages/core/src/guest/context';
import {GuestSecurity} from '../../../../packages/core/src/guest/security';
import {vercelPreviewPeer} from '../../../../packages/core/src/guest/vercel-preview-peer';
import {avatarGuestSecurity} from '../../../../packages/core/src/avatar/guest-rate';
import {GuestBookingService} from '../../../../packages/core/src/guest/service';
import {RecommendationService} from '../../../../packages/core/src/recommendation/recommendation-service';
import {HoldService} from '../../../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../../../packages/core/src/pricing/quote-service';
import {guestCatalog,guestVariants} from '../../../../packages/core/src/content/public-catalog';
import {PostgresAvatarVisuals} from '../../../../packages/db/src/avatar-visuals';
import {loadGuestAvatar} from '../../../../packages/core/src/avatar/guest';
import {R2MediaProvider} from '../../../../packages/core/src/content/r2-media';
import {mediaObjectKey} from '../../../../packages/core/src/content/provider-media';
import type {GuestActor} from '../../../../packages/auth/src/booking-actor';
import type {GuestAvatarBoundary} from './guest-avatar-http';
import guestPolicy from '../../../../config/production/guest.p4-approved-policy.json';
import approvedArtwork from '../../../../docs/execution/avatar-artwork-activation/artwork/manifest.json';
let instance:Promise<Awaited<ReturnType<typeof createHostedPreview>>>|undefined;
export function phase6Requested(){return process.env.ZAO_AVATAR_PHASE6!==undefined||process.env.ZAO_HOSTED_PREVIEW_RUNTIME!==undefined;}
/** No local/owner fallback. A rejected startup remains rejected for this process. */
export async function hostedPreviewRuntime(){if(!phase6Requested())return null;return instance??=createHostedPreview();}
async function createHostedPreview(){
 const c=parseHostedPreview(process.env.ZAO_HOSTED_PREVIEW_RUNTIME,process.env),origin=previewOrigin(process.env);
 const pools={} as Record<Phase6Service,Pool>;
 try{
  for(const service of phase6Services){const pool=new Pool({...c.connections[service],enableChannelBinding:true,max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,statement_timeout:5000,application_name:'zao_avatar_phase6_'+service});pool.on('error',()=>{});pools[service]=pool;
   const client=await pool.connect();try{
   proveNeonClientTls(client,c.connections[service]);
   const a=(await client.query(`SELECT current_database() db,current_user role,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolinherit,r.rolreplication,r.rolbypassrls,
    EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) membership
    FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
   if(!a||a.db!==phase6Database||a.role!==phase6Role(service)||['rolsuper','rolcreatedb','rolcreaterole','rolinherit','rolreplication','rolbypassrls','membership'].some(k=>a[k]!==false))throw Error('PHASE6_DATABASE_IDENTITY_INVALID');
   }finally{client.release();}
  }
  const contexts=new GuestContexts(pools.guest),security=new GuestSecurity(pools.guest,contexts,guestPolicy.policy,c.guestKey),avatarSecurity=avatarGuestSecurity(pools.guest,contexts,c.guestKey);
  await security.transaction(async()=>{});await avatarSecurity.transaction(async()=>{});
  const visuals=new PostgresAvatarVisuals(pools.avatar_read),peer=(r:Request)=>vercelPreviewPeer(r,process.env,c.guestKey);
  const r2=new R2MediaProvider(c.r2.accountId,c.r2.bucket,async()=>({...c.r2,expiresAt:new Date(c.r2.expiresAt),revoked:false}),async()=>{throw Error('PHASE6_READ_ONLY');});
  const service=(actor:GuestActor)=>{const holds=new HoldService(pools.hold,actor),quotes=new QuoteService(pools.pricing,actor),recs=new RecommendationService(pools.recommendation,actor,holds,quotes,async variants=>guestVariants(await guestCatalog(pools.content_read,variants),variants));return new GuestBookingService(contexts,actor,recs,null,async()=>guestCatalog(pools.content_read,await holds.recommendationCatalog()));};
  const avatar:GuestAvatarBoundary={guard:r=>avatarSecurity.guard(peer(r)),load:(headers,scope)=>loadGuestAvatar(contexts,pools.recommendation,visuals,headers,scope),reader:()=>({findForDelivery:(id,hash,now)=>visuals.findForDelivery(id,hash,now),readBytes:async hash=>{
   // avatarDerivative checks eligibility before and after this private provider IO.
   const entry=approvedArtwork.files.find(x=>x.sha256===hash);if(!entry)return null;
   const bytes=await r2.readPrivate(mediaObjectKey({kind:'DERIVATIVE',sha256:hash,bytes:entry.bytes,mime:'image/webp'}));return bytes?.byteLength===entry.bytes?Buffer.from(bytes):null;
  }})};
  return {origin,contexts,service,security:{service:security,peer},avatar};
 }catch{await Promise.all(Object.values(pools).map(p=>p.end().catch(()=>{})));throw Error('PHASE6_RUNTIME_UNAVAILABLE');}
}
