import type {PoolConfig} from 'pg';
import {phase6NeonHostname} from '../../db/src/neon-tls';
export const phase6Resource='store_i5vh0ZEKo2ikcVo9';
export const phase6Database='zr_852b20c4d4b0';
export const phase6Branch='codex/avatar-phase6-hosted-preview';
// Dedicated Phase6 project; the historical zao-rental project remains forbidden.
export const phase6Project='prj_EonVxKra8p9txdZ7O2Ko6t1A8biW';
// Exact existing compute is verified through the resource's ordinary Neon console.
export const phase6Endpoint='ep-winter-lake-b3fd2qtp';
export const phase6R2Account='dce72332f2b04366335908cc383996d6';
export const phase6R2Bucket='zao-rental-avatar-p6';
export const phase6Services=['guest','hold','pricing','recommendation','content_read','avatar_read'] as const;
export type Phase6Service=typeof phase6Services[number];
export const phase6Role=(service:Phase6Service)=>phase6Database+'_p6_'+service;
export type HostedPreviewConfig={resourceId:string;hostname:string;database:string;guestKey:string;connections:Record<Phase6Service,PoolConfig>;r2:{accountId:string;bucket:string;accessKeyId:string;secretAccessKey:string;expiresAt:string;permission:'OBJECT_READ_ONLY'}};
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x:unknown,keys:string[])=>record(x)&&Object.keys(x).sort().join()===keys.sort().join();
export const hostedPreviewBoundaryStages=['PLATFORM_CONTRADICTION','CONFIG_MISSING','CONFIG_PARSE','CONFIG_FORBIDDEN','INGRESS_SCHEME','INGRESS_HOST','INGRESS_DEPLOYMENT_HEADER','INGRESS_HOST_PATTERN','INGRESS_PEER'] as const;
/** Never retain the rejected value, original exception, or its cause. */
export class HostedPreviewBoundaryError extends Error {
 constructor(readonly stage:typeof hostedPreviewBoundaryStages[number]){super(stage);}
}
export function phase6Requested(env:Readonly<Record<string,string|undefined>>=process.env){return !!env.ZAO_HOSTED_PREVIEW_RUNTIME?.trim();}
/** The Preview-only sensitive capability authorizes startup. Optional platform
 * metadata can veto it, never authorize it. NODE_ENV is only Next's build mode. */
export function assertNoHostedPlatformContradiction(env:Readonly<Record<string,string|undefined>>){
 for(const [key,expected]of Object.entries({VERCEL:'1',VERCEL_ENV:'preview',VERCEL_TARGET_ENV:'preview',VERCEL_PROJECT_ID:phase6Project})){
  if(env[key]!==undefined&&env[key]!==expected)throw new HostedPreviewBoundaryError('PLATFORM_CONTRADICTION');
 }
 if(env.VERCEL_GIT_COMMIT_REF&&env.VERCEL_GIT_COMMIT_REF!==phase6Branch)throw new HostedPreviewBoundaryError('PLATFORM_CONTRADICTION');
 if(Object.keys(env).some(k=>(/^(SQUARE_|PAYMENT_|REFUND_|WEBHOOK_|DATABASE_URL$|POSTGRES_URL$|PGPASSWORD$)/.test(k)||k.startsWith('ZAO_')&&!['ZAO_AVATAR_PHASE6','ZAO_HOSTED_PREVIEW_RUNTIME'].includes(k))))throw new HostedPreviewBoundaryError('CONFIG_FORBIDDEN');
}
/** Direct Vercel ingress only: no aliases, generic forwarded headers, or env URL. */
export function hostedPreviewRequestOrigin(request:Request){
 const url=new URL(request.url);
 if(url.protocol!=='https:')throw new HostedPreviewBoundaryError('INGRESS_SCHEME');
 if(request.headers.get('host')!==url.host)throw new HostedPreviewBoundaryError('INGRESS_HOST');
 if(request.headers.get('x-vercel-deployment-url')!==url.host)throw new HostedPreviewBoundaryError('INGRESS_DEPLOYMENT_HEADER');
 if(url.port||url.username||url.password||!/^zao-rental-avatar-preview-[a-z0-9]{9}-zao-food-map\.vercel\.app$/.test(url.hostname))throw new HostedPreviewBoundaryError('INGRESS_HOST_PATTERN');
 return url.origin;
}
export function parseHostedPreview(raw:string|undefined):HostedPreviewConfig{
 if(!raw?.trim())throw new HostedPreviewBoundaryError('CONFIG_MISSING');
 try{
  const c=JSON.parse(raw) as HostedPreviewConfig;
  if(!exact(c,['resourceId','hostname','database','guestKey','connections','r2'])||c.resourceId!==phase6Resource||c.database!==phase6Database||c.hostname!==phase6NeonHostname||typeof c.guestKey!=='string'||c.guestKey.length<32||!exact(c.connections,[...phase6Services]))throw 0;
  for(const service of phase6Services){const d=c.connections[service];if(!exact(d,['host','port','database','user','password','ssl'])||d.host!==c.hostname||d.port!==5432||d.database!==phase6Database||d.user!==phase6Role(service)||typeof d.password!=='string'||d.password.length<32||!exact(d.ssl,['rejectUnauthorized'])||typeof d.ssl!=='object'||!d.ssl||d.ssl.rejectUnauthorized!==true)throw 0;}
  const r=c.r2;if(!exact(r,['accountId','bucket','accessKeyId','secretAccessKey','expiresAt','permission'])||r.accountId!==phase6R2Account||r.bucket!==phase6R2Bucket||r.permission!=='OBJECT_READ_ONLY'||typeof r.accessKeyId!=='string'||!r.accessKeyId.trim()||typeof r.secretAccessKey!=='string'||!r.secretAccessKey.trim()||typeof r.expiresAt!=='string'||!Number.isFinite(Date.parse(r.expiresAt))||Date.parse(r.expiresAt)<=Date.now())throw 0;
  return c;
 }catch{throw new HostedPreviewBoundaryError('CONFIG_PARSE');}
}
