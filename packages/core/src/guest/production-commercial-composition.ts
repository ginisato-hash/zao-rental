// Commercial Production hosting composition — the reviewed installer that production-hosting-
// composition.ts (the R3 dark profile) explicitly left for "a later, separately-reviewed change".
// It is a sibling, not a modification: the dark profile keeps its own token and stays exactly as
// it was. instrumentation.ts invokes both installers; each returns NOT_ACTIVATED unless
// ZAO_PRODUCTION_HOSTING_ACTIVATION equals its own token, so at most one can install the bootstrap.
//
// Startup performs no provider request: Square/Resend are bound as in-memory functions around
// the platform fetch and are only invoked later by the existing booking/refund/notification code.
// Database pools are opened and role-verified by composeProductionRuntime itself.
import {installProductionBootstrap} from './production-bootstrap';
import {productionConfiguration,productionServices,type ProductionConfiguration,type ProductionService} from '../../../auth/src/production-config';
import {productionConfigurationDigest,type ProductionRuntimeInput} from './production-runtime';
import {productionGuestConfiguration,guestConfigurationHash} from '../../../contracts/src/production-guest';
import {issueExactProductionIdentity,type ExactProductionIdentity} from '../../../auth/src/production-identity';
import {PUBLICATION_ORIGIN,type PublicationApproval} from '../../../auth/src/publication-authority';
import type {ProductionDatabaseCredential} from '../../../db/src/production-connection';
import {FetchSquareProductionTransport,type ProductionSquareCredential,type SquareFetch} from '../payment/square-transport';
import {RoutedSquareProductionGateway,RoutedSquareProductionRefundGateway,type ProductionStoreRoutes} from '../payment/square-production-routing';
import {vercelProductionPeer} from './vercel-production-peer';
import approvedGuestPolicy from '../../../../config/production/guest.p4-approved-policy.json';
import type {HostingCompositionResult} from './production-hosting-composition';

export const COMMERCIAL_ACTIVATION_TOKEN='R5_COMMERCIAL_PRODUCTION_COMPOSITION';
/** Explicit reviewed flag choice. Media/Avatar stay off: no Production R2 binding is part of this profile. */
export const COMMERCIAL_FLAGS=Object.freeze({booking:true,guestRecovery:true,payment:true,media:false,avatar:false,staffOperations:true});
/** Exactly the services composeProductionRuntime opens for COMMERCIAL_FLAGS; no other password is read. */
export const COMMERCIAL_DB_SERVICES=Object.freeze(['auth','ledger','hold','transfer','pricing','recommendation','operations','guest','content_read','booking_access'] as const satisfies readonly ProductionService[]);
export const COMMERCIAL_INGRESS_ADAPTER_ID='vercel-production-direct';
const STORES=['MOUNTAIN_BASE','ONSEN_BASE'] as const;

const roleKey=(s:ProductionService)=>`PRODUCTION_DB_ROLE_${s.toUpperCase()}`;
const passwordKey=(s:ProductionService)=>`PRODUCTION_DB_PASSWORD_${s.toUpperCase()}`;
const locationKey=(s:typeof STORES[number])=>`PRODUCTION_SQUARE_LOCATION_${s}`;
/** The complete, fixed set of environment names this module ever reads (never an env scan). */
export const COMMERCIAL_ALLOWLISTED_KEYS=Object.freeze([
 'ZAO_PRODUCTION_HOSTING_ACTIVATION','VERCEL_ENV','VERCEL_PROJECT_ID','VERCEL_GIT_COMMIT_SHA',
 'PRODUCTION_RELEASE_ID','PRODUCTION_PUBLIC_ORIGIN','PRODUCTION_DB_HOST','PRODUCTION_DB_NAME','PRODUCTION_GUEST_POLICY_SHA256',
 'PRODUCTION_GUEST_KEY','PRODUCTION_STAFF_KEY','PRODUCTION_ACCESS_KEY','PRODUCTION_RECOVERY_KEY','PRODUCTION_ACCESS_KEY_VERSION','PRODUCTION_RECOVERY_KEY_VERSION',
 ...productionServices.map(roleKey),...COMMERCIAL_DB_SERVICES.map(passwordKey),
 'PRODUCTION_SQUARE_APPLICATION_ID','PRODUCTION_SQUARE_MERCHANT_ID',...STORES.map(locationKey),'PRODUCTION_SQUARE_ACCESS_TOKEN','PRODUCTION_SQUARE_ACCESS_TOKEN_EXPIRES_AT','PRODUCTION_SQUARE_WEBHOOK_NOTIFICATION_URL',
 'PRODUCTION_RESEND_API_KEY','PRODUCTION_PUBLICATION_APPROVAL',
]);
/** Names whose values are secret. Used by the operator plan to list names only, never values. */
export const COMMERCIAL_SECRET_KEYS=Object.freeze(['PRODUCTION_GUEST_KEY','PRODUCTION_STAFF_KEY','PRODUCTION_ACCESS_KEY','PRODUCTION_RECOVERY_KEY',...COMMERCIAL_DB_SERVICES.map(passwordKey),'PRODUCTION_SQUARE_ACCESS_TOKEN','PRODUCTION_RESEND_API_KEY']);

type Env=Readonly<Record<string,string|undefined>>;
function read(env:Env){const out:Record<string,string>={};for(const k of COMMERCIAL_ALLOWLISTED_KEYS)if(typeof env[k]==='string')out[k]=env[k]!;return out;}
const fail=(code:string):never=>{throw new Error(code);};

/** Owner-approved guest security values (config/production/guest.p4-approved-policy.json), bound to
 * the Production Vercel direct-ingress adapter. The operator attests the resulting digest through
 * PRODUCTION_GUEST_POLICY_SHA256; any drift in the committed values fails startup. */
export function commercialGuestConfiguration(){
 return productionGuestConfiguration({schemaVersion:1,revision:approvedGuestPolicy.policy.version,ingressAdapterId:COMMERCIAL_INGRESS_ADAPTER_ID,policy:approvedGuestPolicy.policy});
}

/** Trusted deployment origin, declared explicitly (Host/X-Forwarded-Host/request URL are never
 * consulted). Only the public hostname or a Vercel-owned *.vercel.app hostname is accepted; the
 * latter is the pre-domain live-acceptance origin and can never satisfy PublicationAuthority,
 * which requires exactly PUBLICATION_ORIGIN. */
export function parseProductionPublicOrigin(raw:string|undefined):string{
 if(!raw||raw.length>200)return fail('PRODUCTION_COMMERCIAL_ORIGIN_INVALID');
 let u:URL;try{u=new URL(raw);}catch{return fail('PRODUCTION_COMMERCIAL_ORIGIN_INVALID');}
 if(u.protocol!=='https:'||u.origin!==raw||u.port||u.username||u.password||!(raw===PUBLICATION_ORIGIN||/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(raw)))return fail('PRODUCTION_COMMERCIAL_ORIGIN_INVALID');
 return raw;
}
/** Per-release owner approval, only ever passed through to issuePublicationAuthority (which still
 * requires exact identity, origin === PUBLICATION_ORIGIN and releaseId === this release). */
export function parsePublicationApproval(raw:string|undefined):PublicationApproval|undefined{
 if(raw===undefined)return undefined;
 let v:unknown;try{v=JSON.parse(raw);}catch{return fail('PRODUCTION_COMMERCIAL_PUBLICATION_APPROVAL_INVALID');}
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join()!=='approvedAt,approvedBy,origin,releaseId,state')return fail('PRODUCTION_COMMERCIAL_PUBLICATION_APPROVAL_INVALID');
 const a=v as Record<string,unknown>;
 if(a.state!=='PUBLICATION_APPROVED'||a.origin!==PUBLICATION_ORIGIN||typeof a.releaseId!=='string'||typeof a.approvedBy!=='string'||typeof a.approvedAt!=='string')return fail('PRODUCTION_COMMERCIAL_PUBLICATION_APPROVAL_INVALID');
 return Object.freeze({state:'PUBLICATION_APPROVED',origin:PUBLICATION_ORIGIN,releaseId:a.releaseId,approvedBy:a.approvedBy,approvedAt:a.approvedAt});
}

export type CommercialPlan=Readonly<{
 configuration:Readonly<ProductionConfiguration>;
 secrets:ProductionRuntimeInput['secrets'];
 square:Readonly<{applicationId:string;merchantId:string;locations:Readonly<Record<typeof STORES[number],string>>;accessToken:string;expiresAt:Date}>;
 resendApiKey:string;
 publication:PublicationApproval|undefined;
}>;

/** Pure: validates the allowlisted environment and derives the reviewed configuration. No I/O,
 * no identity issuance. Returns null only when this profile is not the selected activation. */
export function commercialProductionPlan(env:Env,now=new Date()):CommercialPlan|null{
 const e=read(env);
 if(e.ZAO_PRODUCTION_HOSTING_ACTIVATION!==COMMERCIAL_ACTIVATION_TOKEN)return null;
 if(e.VERCEL_ENV!=='production')fail('PRODUCTION_COMMERCIAL_WRONG_VERCEL_ENVIRONMENT');
 if(!e.VERCEL_PROJECT_ID)fail('PRODUCTION_COMMERCIAL_DEPLOYMENT_IDENTITY_MISSING');
 // Release identity is the reviewed source commit, declared before deploy so a per-release
 // publication approval can name it; when Vercel reports the built commit it must agree.
 const releaseId=e.PRODUCTION_RELEASE_ID;
 if(!releaseId||!/^[a-f0-9]{40}$/.test(releaseId)||e.VERCEL_GIT_COMMIT_SHA!==undefined&&e.VERCEL_GIT_COMMIT_SHA!==releaseId)fail('PRODUCTION_COMMERCIAL_RELEASE_IDENTITY_INVALID');
 const origin=parseProductionPublicOrigin(e.PRODUCTION_PUBLIC_ORIGIN);
 if(!e.PRODUCTION_DB_HOST||!e.PRODUCTION_DB_NAME)fail('PRODUCTION_COMMERCIAL_DB_IDENTITY_MISSING');
 const roles={} as Record<ProductionService,string>;
 for(const s of productionServices){const role=e[roleKey(s)];if(!role)fail('PRODUCTION_COMMERCIAL_ROLE_NAME_MISSING');roles[s]=role!;}
 const keys=['PRODUCTION_GUEST_KEY','PRODUCTION_STAFF_KEY','PRODUCTION_ACCESS_KEY','PRODUCTION_RECOVERY_KEY'];
 for(const k of keys)if(!e[k]||!/^[a-f0-9]{64}$/.test(e[k]))fail('PRODUCTION_COMMERCIAL_SIGNING_KEY_INVALID');
 if(new Set(keys.map(k=>e[k])).size!==keys.length)fail('PRODUCTION_COMMERCIAL_SIGNING_KEY_INVALID');
 for(const k of ['PRODUCTION_ACCESS_KEY_VERSION','PRODUCTION_RECOVERY_KEY_VERSION'])if(!e[k]||!/^[-A-Za-z0-9_]{1,64}$/.test(e[k]))fail('PRODUCTION_COMMERCIAL_KEY_VERSION_INVALID');
 const guest=commercialGuestConfiguration();
 if(e.PRODUCTION_GUEST_POLICY_SHA256!==guestConfigurationHash(guest))fail('PRODUCTION_COMMERCIAL_GUEST_POLICY_NOT_APPROVED');

 const applicationId=e.PRODUCTION_SQUARE_APPLICATION_ID,merchantId=e.PRODUCTION_SQUARE_MERCHANT_ID,accessToken=e.PRODUCTION_SQUARE_ACCESS_TOKEN;
 if(!applicationId||!/^sq0idp-[-A-Za-z0-9_]{10,100}$/.test(applicationId)||!merchantId||!/^[A-Za-z0-9_-]{1,100}$/.test(merchantId))fail('PRODUCTION_COMMERCIAL_SQUARE_IDENTITY_INVALID');
 const locations={} as Record<typeof STORES[number],string>;
 for(const s of STORES){const l=e[locationKey(s)];if(!l||!/^[A-Za-z0-9_-]{1,100}$/.test(l))fail('PRODUCTION_COMMERCIAL_SQUARE_LOCATION_INVALID');locations[s]=l!;}
 if(locations.MOUNTAIN_BASE===locations.ONSEN_BASE)fail('PRODUCTION_COMMERCIAL_SQUARE_LOCATION_INVALID');
 if(!accessToken||accessToken.length<16||accessToken.length>4096||!/^[-A-Za-z0-9._~+/=]+$/.test(accessToken))fail('PRODUCTION_COMMERCIAL_SQUARE_CREDENTIAL_INVALID');
 const expiresRaw=e.PRODUCTION_SQUARE_ACCESS_TOKEN_EXPIRES_AT,expiresAt=new Date(expiresRaw??'');
 if(!expiresRaw||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiresRaw)||!Number.isFinite(expiresAt.getTime())||expiresAt<=now)fail('PRODUCTION_COMMERCIAL_SQUARE_CREDENTIAL_EXPIRED');
 const resendApiKey=e.PRODUCTION_RESEND_API_KEY;
 if(!resendApiKey||!/^re_[-A-Za-z0-9_]{16,200}$/.test(resendApiKey))fail('PRODUCTION_COMMERCIAL_RESEND_CREDENTIAL_INVALID');
 const database:Partial<Record<ProductionService,ProductionDatabaseCredential>>={};
 for(const s of COMMERCIAL_DB_SERVICES){const password=e[passwordKey(s)];if(!password||password.length<16)fail('PRODUCTION_COMMERCIAL_DB_CREDENTIAL_MISSING');database[s]={provider:'NEON',environment:'PRODUCTION',host:e.PRODUCTION_DB_HOST!,port:5432,database:e.PRODUCTION_DB_NAME!,user:roles[s],password:password!,revoked:false};}

 const configuration=productionConfiguration({
  schemaVersion:1,capability:'ZAO_PRODUCTION_RUNTIME_V1',
  deployment:{provider:'VERCEL',environment:'production',projectId:e.VERCEL_PROJECT_ID,releaseId,origin},
  database:{provider:'NEON',environment:'production',host:e.PRODUCTION_DB_HOST,name:e.PRODUCTION_DB_NAME,roles},
  flags:{...COMMERCIAL_FLAGS},guest,approvedGuestSha256:guestConfigurationHash(guest),
  payment:{provider:'SQUARE',environment:'PRODUCTION',merchantId,locations,webhookNotificationUrl:e.PRODUCTION_SQUARE_WEBHOOK_NOTIFICATION_URL??null},
  media:null,
 },now);
 return Object.freeze({
  configuration,
  secrets:{guestKey:e.PRODUCTION_GUEST_KEY!,staffKey:e.PRODUCTION_STAFF_KEY!,accessKey:e.PRODUCTION_ACCESS_KEY!,recoveryKey:e.PRODUCTION_RECOVERY_KEY!,accessKeyVersion:e.PRODUCTION_ACCESS_KEY_VERSION!,recoveryKeyVersion:e.PRODUCTION_RECOVERY_KEY_VERSION!,database},
  square:Object.freeze({applicationId:applicationId!,merchantId:merchantId!,locations:Object.freeze(locations),accessToken:accessToken!,expiresAt}),
  resendApiKey:resendApiKey!,
  publication:parsePublicationApproval(e.PRODUCTION_PUBLICATION_APPROVAL),
 });
}

/** Two strict single-location Square transports sharing one merchant credential, routed by the
 * durable attempt/refund location. Pure construction; no request is made here. */
export function commercialSquareRoutes(square:CommercialPlan['square'],fetch:SquareFetch):ProductionStoreRoutes{
 const transport=(locationId:string)=>new FetchSquareProductionTransport(square.merchantId,locationId,async():Promise<ProductionSquareCredential>=>({environment:'PRODUCTION',merchantId:square.merchantId,locationId,accessToken:square.accessToken,expiresAt:square.expiresAt,revoked:false}),fetch);
 return {MOUNTAIN_BASE:{locationId:square.locations.MOUNTAIN_BASE,transport:transport(square.locations.MOUNTAIN_BASE)},ONSEN_BASE:{locationId:square.locations.ONSEN_BASE,transport:transport(square.locations.ONSEN_BASE)}};
}

/** Pure runtime input for an already-issued exact identity (the identity itself is never forged here). */
export function commercialRuntimeInput(plan:CommercialPlan,identity:ExactProductionIdentity|undefined,fetch:SquareFetch):ProductionRuntimeInput{
 const c=plan.configuration,routes=commercialSquareRoutes(plan.square,fetch);
 return {
  ...(identity?{identity}:{}),configuration:c,approvedConfigurationSha256:productionConfigurationDigest(c),deployment:c.deployment,secrets:plan.secrets,
  verifiedPeer:vercelProductionPeer(c.deployment),
  payment:{provider:'SQUARE',environment:'PRODUCTION',merchantId:plan.square.merchantId,applicationId:plan.square.applicationId,credentials:async()=>({environment:'PRODUCTION',merchantId:plan.square.merchantId,token:plan.square.accessToken,revoked:false}),gateway:new RoutedSquareProductionGateway(plan.square.merchantId,routes)},
  refunds:new RoutedSquareProductionRefundGateway(plan.square.merchantId,routes),
  notification:{environment:'PRODUCTION',providerId:'RESEND',credentials:async()=>({secret:plan.resendApiKey,revoked:false}),fetch},
  ...(plan.publication?{publication:plan.publication}:{}),
  audit:async()=>{},
 };
}

/** Called once from instrumentation.ts register(), never from a route. The real override-free
 * issueExactProductionIdentity runs before any bootstrap is installed; its accept path is only
 * provable in the real Production environment (see production-identity.ts). */
export function installProductionCommercialComposition(env:Env=process.env,fetch:SquareFetch=(url,init)=>globalThis.fetch(url,init)):HostingCompositionResult{
 const plan=commercialProductionPlan(env);
 if(!plan)return {status:'NOT_ACTIVATED'};
 const identity=issueExactProductionIdentity(plan.configuration);
 installProductionBootstrap(commercialRuntimeInput(plan,identity,fetch));
 return {status:'INSTALLED'};
}
