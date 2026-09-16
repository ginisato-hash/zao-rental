import type {PoolConfig} from 'pg';
export const phase6Resource='store_i5vh0ZEKo2ikcVo9';
export const phase6Database='zr_852b20c4d4b0';
export const phase6Branch='codex/avatar-phase6-hosted-preview';
export const phase6Project='prj_ehUMOzM77em9DVnHJBJffncD5hg7';
// Exact existing compute is verified through the resource's ordinary Neon console.
export const phase6Endpoint='ep-winter-lake-b3fd2qtp';
export const phase6Services=['guest','hold','pricing','recommendation','content_read','avatar_read'] as const;
export type Phase6Service=typeof phase6Services[number];
export const phase6Role=(service:Phase6Service)=>phase6Database+'_p6_'+service;
export type HostedPreviewConfig={resourceId:string;hostname:string;database:string;guestKey:string;connections:Record<Phase6Service,PoolConfig>;r2:{accountId:string;bucket:string;accessKeyId:string;secretAccessKey:string;expiresAt:string;permission:'OBJECT_READ_ONLY'}};
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x:unknown,keys:string[])=>record(x)&&Object.keys(x).sort().join()===keys.sort().join();
/** NODE_ENV=production is Next's build mode, not permission to access Production.
 * Platform environment, immutable deployment URL, project and branch must all agree. */
export function previewOrigin(env:Readonly<Record<string,string|undefined>>){
 const host=env.VERCEL_URL;
 if(env.VERCEL!=='1'||env.VERCEL_ENV!=='preview'||env.VERCEL_TARGET_ENV!=='preview'||env.ZAO_AVATAR_PHASE6!=='PROTECTED_PREVIEW_V1'||env.VERCEL_PROJECT_ID!==phase6Project||env.VERCEL_GIT_COMMIT_REF!==phase6Branch||!host||!/^zao-rental-[a-z0-9]{9}-zao-food-map\.vercel\.app$/.test(host))throw Error('PHASE6_PREVIEW_REQUIRED');
 if(Object.entries(env).some(([k,v])=>v&&(/^(SQUARE_|ZAO_DEVELOPMENT_RUNTIME$|ZAO_.*PAYMENT|ZAO_.*REFUND|DATABASE_URL$|POSTGRES_URL$|PGPASSWORD$)/.test(k))))throw Error('PHASE6_FORBIDDEN_CONFIGURATION');
 return 'https://'+host;
}
export function parseHostedPreview(raw:string|undefined,env:Readonly<Record<string,string|undefined>>):HostedPreviewConfig{
 try{
  previewOrigin(env);if(!raw)throw 0;const c=JSON.parse(raw) as HostedPreviewConfig;
  if(!exact(c,['resourceId','hostname','database','guestKey','connections','r2'])||c.resourceId!==phase6Resource||c.database!==phase6Database||!new RegExp('^'+phase6Endpoint+'(?:-pooler)?\\.[a-z0-9-]+\\.[a-z0-9-]+\\.neon\\.tech$').test(c.hostname)||typeof c.guestKey!=='string'||c.guestKey.length<32||!exact(c.connections,[...phase6Services]))throw 0;
  for(const service of phase6Services){const d=c.connections[service];if(!exact(d,['host','port','database','user','password','ssl'])||d.host!==c.hostname||d.port!==5432||d.database!==phase6Database||d.user!==phase6Role(service)||typeof d.password!=='string'||d.password.length<32||!exact(d.ssl,['rejectUnauthorized'])||typeof d.ssl!=='object'||!d.ssl||d.ssl.rejectUnauthorized!==true)throw 0;}
  const r=c.r2;if(!exact(r,['accountId','bucket','accessKeyId','secretAccessKey','expiresAt','permission'])||!/^[a-f0-9]{32}$/.test(r.accountId)||!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(r.bucket)||r.permission!=='OBJECT_READ_ONLY'||!r.accessKeyId||!r.secretAccessKey||!Number.isFinite(Date.parse(r.expiresAt))||Date.parse(r.expiresAt)<=Date.now())throw 0;
  return c;
 }catch{throw Error('PHASE6_CONFIGURATION_INVALID');}
}
