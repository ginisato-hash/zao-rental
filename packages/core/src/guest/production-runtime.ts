import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {exact} from '../../../contracts/src/pricing';
import {canonical} from '../../../contracts/src/hold';
import {productionConfiguration,productionServices,ProductionStartupError,type ProductionConfiguration,type ProductionService,type StartupStage} from '../../../auth/src/production-config';
import {connectProductionDatabase,validateProductionCredential,verifyProductionDatabase,type ProductionDatabaseCredential} from '../../../db/src/production-connection';
import {createStaffAuth} from '../../../auth/src/staff-auth';
import type {GuestActor} from '../../../auth/src/booking-actor';
import {BookingAccess} from './booking-access';
import {BookingRecovery} from './booking-recovery';
import {composeProductionGuestSecurity} from './production-composition';
import {productionIngress,type VerifiedProductionPeer} from './production-ingress';
import {GuestBookingService} from './service';
import {HoldService} from '../inventory/hold-service';
import {QuoteService} from '../pricing/quote-service';
import {RecommendationService} from '../recommendation/recommendation-service';
import {BookingService} from '../payment/booking-service';
import {guestCatalog,guestVariants} from '../content/public-catalog';
import {PostgresAvatarVisuals} from '../../../db/src/avatar-visuals';
import {avatarGuestSecurity} from '../avatar/guest-rate';
import {loadGuestAvatar} from '../avatar/guest';
import {R2MediaProvider,type R2Credential} from '../content/r2-media';
import type {PaymentGateway} from '../../../contracts/src/rental-flow';
export const productionConfigurationDigest=(c:ProductionConfiguration)=>createHash('sha256').update(canonical(c)).digest('hex');
export type ProductionSecretMaterial={
 database:Partial<Record<ProductionService,ProductionDatabaseCredential>>;
 guestKey:string;staffKey:string;accessKey:string;recoveryKey:string;accessKeyVersion:string;recoveryKeyVersion:string;
};
export type ProductionPaymentBinding={provider:'SQUARE';environment:'PRODUCTION';merchantId:string;credentials:()=>Promise<{environment:'PRODUCTION';merchantId:string;token:string;revoked:false}>;gateway:PaymentGateway};
export type ProductionRuntimeInput={configuration:unknown;approvedConfigurationSha256:string;
 deployment:{provider:'VERCEL';environment:'production';projectId:string;releaseId:string;origin:string};
 secrets:ProductionSecretMaterial;verifiedPeer:(request:Request)=>VerifiedProductionPeer|undefined;
 connect?:(c:ProductionConfiguration,service:ProductionService,credential:ProductionDatabaseCredential)=>Promise<Pool>;
 payment?:ProductionPaymentBinding;
 media?:{environment:'PRODUCTION';permission:'OBJECT_READ';credentials:()=>Promise<R2Credential>;requestHandler?:ConstructorParameters<typeof R2MediaProvider>[5]};
 audit:(stage:StartupStage)=>Promise<void>;
};
/** One server-owned composition, using existing domain services. There is no ambient
 * URL, NODE_ENV activation, provider fetch, owner connection, or request config. */
export async function composeProductionRuntime(input:ProductionRuntimeInput){
 let stage:StartupStage='FEATURE_FLAGS';const pools:Partial<Record<ProductionService,Pool>>={};let r2:R2MediaProvider|undefined;let validatedPayment:PaymentGateway|null=null;
 try{
  const c=productionConfiguration(input.configuration);
  if(!/^[a-f0-9]{64}$/.test(input.approvedConfigurationSha256)||productionConfigurationDigest(c)!==input.approvedConfigurationSha256||canonical(c.deployment)!==canonical(input.deployment))throw Error();
  const secrets=exact(input.secrets,['database','guestKey','staffKey','accessKey','recoveryKey','accessKeyVersion','recoveryKeyVersion']) as unknown as ProductionSecretMaterial;
  stage='GUEST_SECURITY';const roots=[secrets.guestKey,secrets.staffKey,secrets.accessKey,secrets.recoveryKey];if(roots.some(k=>typeof k!=='string'||! /^[a-f0-9]{64}$/.test(k))||new Set(roots).size!==roots.length)throw Error();
  stage='BOOKING_ACCESS';for(const v of [secrets.accessKeyVersion,secrets.recoveryKeyVersion])if(typeof v!=='string'||!/^[-A-Za-z0-9_]{1,64}$/.test(v))throw Error();
  stage='INGRESS';if(typeof input.verifiedPeer!=='function')throw Error();const ingress=productionIngress(c,input.verifiedPeer);
  stage='PAYMENT';if(c.flags.payment){const p=input.payment;if(!p||p.provider!=='SQUARE'||p.environment!=='PRODUCTION'||typeof p.credentials!=='function'||p.merchantId!==c.payment?.merchantId||p.gateway.kind!=='SQUARE_PRODUCTION'||typeof p.gateway.create!=='function'||typeof p.gateway.lookup!=='function')throw Error();const credential=exact(await p.credentials(),['environment','merchantId','token','revoked']);if(credential.environment!=='PRODUCTION'||credential.merchantId!==c.payment.merchantId||credential.revoked!==false||typeof credential.token!=='string'||credential.token.length<16)throw Error();validatedPayment=p.gateway;}
  stage='MEDIA';if(c.flags.media){const m=input.media;if(!m||m.environment!=='PRODUCTION'||m.permission!=='OBJECT_READ')throw Error();const credentials=async()=>{const v=await m.credentials();if(!c.media||v.accountId!==c.media.accountId||v.bucket!==c.media.bucket||v.revoked||v.expiresAt.toISOString()!==c.media.credentialExpiresAt||v.expiresAt<=new Date()||!v.accessKeyId||!v.secretAccessKey)throw new ProductionStartupError('MEDIA');return v;};await credentials();r2=new R2MediaProvider(c.media!.accountId,c.media!.bucket,credentials,async()=>{throw new ProductionStartupError('MEDIA');},()=>new Date(),m.requestHandler);}
  stage='DB_CONFIG';if(!secrets.database||Object.keys(secrets.database).some(k=>!productionServices.includes(k as ProductionService)))throw Error();
  const active=new Set<ProductionService>();if(c.flags.booking)for(const s of ['auth','guest','hold','pricing','recommendation','content_read','booking_access','operations'] as const)active.add(s);
  if(c.flags.staffOperations)for(const s of ['auth','ledger','hold','transfer','pricing','recommendation','operations'] as const)active.add(s);if(c.flags.avatar)active.add('avatar_read');if(c.flags.media)active.add('content_read');
  // Validate every supplied binding before opening even the first connection.
  for(const s of productionServices)if(active.has(s)||secrets.database[s])validateProductionCredential(c,s,secrets.database[s]);
  for(const s of active){const pool=await (input.connect??connectProductionDatabase)(c,s,secrets.database[s]!);pools[s]=pool;pool.on('error',()=>{});await verifyProductionDatabase(pool,c,s);}
  const required=(s:ProductionService)=>{const p=pools[s];if(!p)throw new ProductionStartupError('DB_CONFIG');return p;};
  const base=(c.flags.booking||c.flags.staffOperations)?{
   config:{origin:c.deployment.origin,namespace:c.database.name,authSecret:secrets.guestKey,authDb:{port:5432}},
   auth:createStaffAuth(required('auth'),{origin:c.deployment.origin,secret:secrets.staffKey}),authPool:required('auth'),loginPool:required('auth'),
   holdPool:required('hold'),pricingPool:required('pricing'),recommendationPool:required('recommendation'),operationsPool:required('operations')
  }:null;
  const staff=c.flags.staffOperations?{...base!,ledgerPool:required('ledger'),transferPool:required('transfer')}:null;
  stage='GUEST_SECURITY';const guest=c.flags.booking?await composeProductionGuestSecurity({pool:required('guest'),configuration:c.guest,approvedConfigurationSha256:c.approvedGuestSha256,serverKey:secrets.guestKey,ingress,audit:async()=>input.audit('GUEST_SECURITY')}):null;
  const service=(actor:GuestActor)=>{if(!guest)throw new ProductionStartupError('FEATURE_FLAGS');const holds=new HoldService(required('hold'),actor),quotes=new QuoteService(required('pricing'),actor),recommendations=new RecommendationService(required('recommendation'),actor,holds,quotes,async variants=>guestVariants(await guestCatalog(required('content_read'),variants),variants));
   // Read existing canonical payment/booking state even with Avatar/media absent.
   // Commercial create authority remains the existing payment activation boundary.
   const bookings=new BookingService(required('operations'),required('guest'),actor);return new GuestBookingService(guest.contexts,actor,recommendations,bookings,async()=>guestCatalog(required('content_read'),await holds.recommendationCatalog()));};
  stage='BOOKING_ACCESS';const access=guest?new BookingAccess(required('booking_access'),Buffer.from(secrets.accessKey,'hex'),secrets.accessKeyVersion):null;
  const recovery=guest&&c.flags.guestRecovery?new BookingRecovery(required('booking_access'),Buffer.from(secrets.recoveryKey,'hex'),secrets.recoveryKeyVersion,undefined,5000,true):null;
  const readDerivative=async(digest:string)=>{if(!r2||! /^[a-f0-9]{64}$/.test(digest))return null;return r2.readPrivate('private/derivative/sha256/'+digest);};
  stage='MEDIA';let avatar=null;
  if(guest&&c.flags.avatar){const visuals=new PostgresAvatarVisuals(required('avatar_read')),rate=avatarGuestSecurity(required('guest'),guest.contexts,secrets.guestKey);await rate.transaction(async()=>{});
   avatar={guard:(request:Request)=>rate.guard(guest.security.peer(request)),load:(headers:Headers,scope:Parameters<typeof loadGuestAvatar>[4])=>loadGuestAvatar(guest.contexts,required('recommendation'),visuals,headers,scope),reader:()=>({findForDelivery:(id:string,hash:string,now:Date)=>visuals.findForDelivery(id,hash,now),readBytes:async(hash:string)=>{const bytes=await readDerivative(hash);return bytes?Buffer.from(bytes):null;}})};
  }
  stage='READY';await input.audit(stage);let closed=false;
  return Object.freeze({configuration:c,staff,guest,service,access,recovery,avatar,readDerivative,payment:validatedPayment,contentReadPool:pools.content_read??null,
   public:guest?{r:base!,guestPool:required('guest'),readPool:required('content_read'),contexts:guest.contexts}:null,
   // F1 (TD correction): DB must never report READY without at least one actually-open pool —
   // a dark profile with every flag false opens zero connections (`active` stays empty, `pools`
   // stays `{}`), and previously reported READY anyway just because the runtime object existed
   // and wasn't closed. 'OFF' matches the same semantics PAYMENT_ADAPTER/MEDIA already use for
   // "this capability was never turned on," not a fabricated connectivity claim.
   safeStatus:()=>({APP:closed?'UNAVAILABLE':'READY',DB:closed?'UNAVAILABLE':Object.keys(pools).length>0?'READY':'OFF',GUEST:guest?'READY':'OFF',PAYMENT_ADAPTER:c.flags.payment?'CONFIGURED_ACTIVATION_PENDING':'OFF',WEBHOOK:!c.flags.payment?'OFF':c.payment?.webhookNotificationUrl?'CONFIGURED_ACTIVATION_PENDING':'UNCONNECTED',MEDIA:c.flags.media?'CONFIGURED':'OFF',NOTIFICATION:'UNCONNECTED'} as const),
   async close(){if(closed)return;closed=true;r2?.close();await Promise.all(Object.values(pools).map(p=>p.end().catch(()=>{})));}
  });
 }catch(error){r2?.close();await Promise.all(Object.values(pools).map(p=>p.end().catch(()=>{})));throw error instanceof ProductionStartupError?error:new ProductionStartupError(stage);}
}
export type ProductionRuntime=Awaited<ReturnType<typeof composeProductionRuntime>>;
