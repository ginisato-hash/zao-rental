import {exact} from '../../contracts/src/pricing';
import {productionGuestConfiguration,guestConfigurationHash,type ProductionGuestConfiguration} from '../../contracts/src/production-guest';
export const productionServices=['auth','ledger','hold','transfer','pricing','recommendation','operations','guest','content_read','avatar_read','booking_access'] as const;
export type ProductionService=typeof productionServices[number];
export const startupStages=['DB_CONFIG','INGRESS','PAYMENT','MEDIA','GUEST_SECURITY','BOOKING_ACCESS','FEATURE_FLAGS','READY'] as const;
export type StartupStage=typeof startupStages[number];
export class ProductionStartupError extends Error{constructor(readonly stage:StartupStage){super(stage);}}
export type ProductionFlags={booking:boolean;guestRecovery:boolean;payment:boolean;media:boolean;avatar:boolean;staffOperations:boolean};
export type ProductionConfiguration={
 schemaVersion:1;capability:'ZAO_PRODUCTION_RUNTIME_V1';
 deployment:{provider:'VERCEL';environment:'production';projectId:string;releaseId:string;origin:string};
 database:{provider:'NEON';environment:'production';host:string;name:string;roles:Record<ProductionService,string>};
 flags:ProductionFlags;guest:Readonly<ProductionGuestConfiguration>;approvedGuestSha256:string;
 payment:null|{provider:'SQUARE';environment:'PRODUCTION';merchantId:string;locations:Record<'MOUNTAIN_BASE'|'ONSEN_BASE',string>;webhookNotificationUrl:string|null};
 media:null|{provider:'CLOUDFLARE_R2';environment:'PRODUCTION';accountId:string;bucket:string;visibility:'PRIVATE';r2DevEnabled:false;publicDomains:[];credentialExpiresAt:string};
};
const text=(v:unknown,pattern:RegExp)=>{if(typeof v!=='string'||!pattern.test(v))throw Error();return v;};
const id=(v:unknown)=>text(v,/^[-A-Za-z0-9_]{1,100}$/);
/** Strict deployment-owned configuration, never HTTP input. No credentials, defaults,
 * ambient environment or provider IO. Parsing alone does not grant startup authority. */
export function productionConfiguration(input:unknown,now=new Date()):Readonly<ProductionConfiguration>{
 let stage:StartupStage='FEATURE_FLAGS';
 try{
  const c=exact(input,['schemaVersion','capability','deployment','database','flags','guest','approvedGuestSha256','payment','media']);
  if(c.schemaVersion!==1||c.capability!=='ZAO_PRODUCTION_RUNTIME_V1')throw Error();
  const d=exact(c.deployment,['provider','environment','projectId','releaseId','origin']);
  const origin=new URL(String(d.origin));
  if(d.provider!=='VERCEL'||d.environment!=='production'||origin.protocol!=='https:'||origin.origin!==d.origin||origin.username||origin.password||origin.hostname==='localhost'||origin.hostname==='127.0.0.1')throw Error();
  const deployment={provider:'VERCEL' as const,environment:'production' as const,projectId:id(d.projectId),releaseId:id(d.releaseId),origin:origin.origin};
  const flagKeys=['booking','guestRecovery','payment','media','staffOperations'];if(c.flags&&typeof c.flags==='object'&&Object.hasOwn(c.flags,'avatar'))flagKeys.push('avatar');const f=exact(c.flags,flagKeys);
  if(Object.entries(f).some(([,v])=>typeof v!=='boolean'))throw Error();
  const flags={booking:f.booking as boolean,guestRecovery:f.guestRecovery as boolean,payment:f.payment as boolean,media:f.media as boolean,avatar:f.avatar===true,staffOperations:f.staffOperations as boolean};
  if((flags.guestRecovery||flags.payment)&&!flags.booking||flags.avatar&&(!flags.booking||!flags.media))throw Error();
  stage='DB_CONFIG';const db=exact(c.database,['provider','environment','host','name','roles']);
  if(db.provider!=='NEON'||db.environment!=='production')throw Error();
  const host=text(db.host,/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech$/),name=id(db.name),rs=exact(db.roles,[...productionServices]),roles={} as Record<ProductionService,string>;
  for(const service of productionServices){const role=text(rs[service],/^[a-z][a-z0-9_]{1,62}$/);if(/(?:^|_)(?:owner|admin|superuser|postgres|root)(?:_|$)/.test(role))throw Error();roles[service]=role;}
  if(new Set(Object.values(roles)).size!==productionServices.length)throw Error();
  stage='GUEST_SECURITY';const guest=productionGuestConfiguration(c.guest),approvedGuestSha256=text(c.approvedGuestSha256,/^[a-f0-9]{64}$/);if(guestConfigurationHash(guest)!==approvedGuestSha256)throw Error();
  stage='PAYMENT';let payment:ProductionConfiguration['payment']=null;
  if(c.payment!==null){
   // Webhook delivery is a separate connection from the payment adapter, so it is declared
   // separately and stays optional. It is an address, never a signing key.
   const paymentKeys=['provider','environment','merchantId','locations'];
   if(c.payment&&typeof c.payment==='object'&&Object.hasOwn(c.payment,'webhookNotificationUrl'))paymentKeys.push('webhookNotificationUrl');
   const p=exact(c.payment,paymentKeys),l=exact(p.locations,['MOUNTAIN_BASE','ONSEN_BASE']);if(p.provider!=='SQUARE'||p.environment!=='PRODUCTION')throw Error();
   let webhookNotificationUrl:string|null=null;
   if(p.webhookNotificationUrl!==undefined&&p.webhookNotificationUrl!==null){
    const raw=text(p.webhookNotificationUrl,/^https:\/\/[^\s?#]{1,200}$/);const u=new URL(raw);
    if(u.protocol!=='https:'||u.search||u.hash||u.username||u.password||['localhost','127.0.0.1','::1'].includes(u.hostname))throw Error();
    webhookNotificationUrl=raw;
   }
   payment={provider:'SQUARE',environment:'PRODUCTION',merchantId:id(p.merchantId),locations:Object.freeze({MOUNTAIN_BASE:id(l.MOUNTAIN_BASE),ONSEN_BASE:id(l.ONSEN_BASE)}),webhookNotificationUrl};}
  if(flags.payment&&!payment)throw Error();
  stage='MEDIA';let media:ProductionConfiguration['media']=null;
  if(c.media!==null){const m=exact(c.media,['provider','environment','accountId','bucket','visibility','r2DevEnabled','publicDomains','credentialExpiresAt']);if(m.provider!=='CLOUDFLARE_R2'||m.environment!=='PRODUCTION'||m.visibility!=='PRIVATE'||m.r2DevEnabled!==false||!Array.isArray(m.publicDomains)||m.publicDomains.length||typeof m.credentialExpiresAt!=='string'||!Number.isFinite(Date.parse(m.credentialExpiresAt))||Date.parse(m.credentialExpiresAt)<=now.getTime())throw Error();media={provider:'CLOUDFLARE_R2',environment:'PRODUCTION',accountId:text(m.accountId,/^[a-f0-9]{32}$/),bucket:text(m.bucket,/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),visibility:'PRIVATE',r2DevEnabled:false,publicDomains:[],credentialExpiresAt:new Date(m.credentialExpiresAt).toISOString()};}
  if(flags.media&&!media)throw Error();
  return Object.freeze({schemaVersion:1,capability:'ZAO_PRODUCTION_RUNTIME_V1',deployment:Object.freeze(deployment),database:Object.freeze({provider:'NEON',environment:'production',host,name,roles:Object.freeze(roles)}),flags:Object.freeze(flags),guest,approvedGuestSha256,payment:payment?Object.freeze(payment):null,media:media?Object.freeze(media):null});
 }catch{throw new ProductionStartupError(stage);}
}
