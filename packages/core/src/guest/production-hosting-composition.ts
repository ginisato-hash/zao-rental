// PROD-R3 (integration-corrected): the missing hosting-integration glue. Confirmed gap:
// apps/web/src/instrumentation.ts already calls bootstrapProductionRuntime() but nothing ever
// calls installProductionBootstrap(input) first — so the Production runtime can never actually
// reach READY through Vercel configuration alone, no matter what env vars are set. This module is
// that missing call, meant to be invoked once from instrumentation.ts's register(), never from
// an HTTP route (this file imports no request/response type and exports no route handler).
//
// Scope: this composes the "R3 dark profile" specifically — every business flag
// (booking/guestRecovery/payment/media/avatar/staffOperations) OFF. That is a deliberate,
// narrow target: proving the runtime's own DB-identity/activation machinery can reach READY
// with real (or disposable-test) Neon bindings, with zero Square calls, zero notifications, and
// zero guest/staff traffic accepted — not a general-purpose "turn on everything" composer. A
// later, separately-reviewed change turns specific flags on once their own secrets/paths exist.
import {installProductionBootstrap} from './production-bootstrap';
import {productionConfiguration,productionServices,type ProductionService} from '../../../auth/src/production-config';
import {productionConfigurationDigest,type ProductionRuntimeInput} from './production-runtime';
import {productionGuestConfiguration,guestConfigurationHash} from '../../../contracts/src/production-guest';
import {issueExactProductionIdentity} from '../../../auth/src/production-identity';

export const HOSTING_ACTIVATION_TOKEN='R3_DARK_PRODUCTION_COMPOSITION';

/** The fixed, explicit allowlist this module ever reads. No other env key is ever inspected —
 * there is no generic env dump anywhere in this file, so an unrelated secret sitting in the
 * process environment is never at risk of being picked up by accident.
 *
 * F1 (TD correction): this no longer reads any `PRODUCTION_DB_PASSWORD_*` key at all. With every
 * business flag hardcoded false, `composeProductionRuntime`'s `active` set stays empty and it
 * never opens a single database connection — so a real password for any of the 11 services was
 * always unused secret surface in the dark profile, not a real requirement. Only the 11 role
 * *names* remain (non-secret identifiers `productionConfiguration()`'s own parsing requires as
 * part of the config shape), and `secrets.database` is now supplied empty. DB connectivity is
 * proved by a wholly separate, explicit probe instead — see production-db-readiness.ts — never
 * by this dark composition reaching READY. */
const ALLOWLISTED_KEYS=[
 'ZAO_PRODUCTION_HOSTING_ACTIVATION','VERCEL_ENV','VERCEL_PROJECT_ID','VERCEL_DEPLOYMENT_ID','VERCEL_URL',
 'PRODUCTION_DB_HOST','PRODUCTION_DB_NAME',
 'PRODUCTION_GUEST_KEY','PRODUCTION_STAFF_KEY','PRODUCTION_ACCESS_KEY','PRODUCTION_RECOVERY_KEY','PRODUCTION_ACCESS_KEY_VERSION','PRODUCTION_RECOVERY_KEY_VERSION',
 ...productionServices.map(s=>roleKey(s)),
] as const;
function roleKey(s:ProductionService){return `PRODUCTION_DB_ROLE_${s.toUpperCase()}`;}
type AllowlistedEnv=Partial<Record<typeof ALLOWLISTED_KEYS[number],string>>;
function readAllowlistedEnv(env:Readonly<Record<string,string|undefined>>):AllowlistedEnv{
 const out:AllowlistedEnv={};
 for(const k of ALLOWLISTED_KEYS)if(typeof env[k]==='string')(out as Record<string,string>)[k]=env[k]!;
 return out;
}

/** The dark profile's guest policy is fixed, not sourced from env — with `booking:false` it is
 * parsed (productionConfiguration validates it unconditionally) but never actually used to admit
 * any guest request. A future profile that turns `booking` on must source a real, reviewed
 * policy instead of this placeholder — that is an explicit, separate later change. */
const DARK_GUEST_POLICY=productionGuestConfiguration({schemaVersion:1,revision:'R3-DARK-PROFILE-INERT',ingressAdapterId:'r3-dark-profile-inert',policy:{version:'R3-DARK-PROFILE-INERT',contextSeconds:3600,absoluteSeconds:7200,recoverySeconds:3600,replaySeconds:30,retentionSeconds:60,windowSeconds:10,peerRequests:1,globalRequests:1}});

export type HostingCompositionResult={status:'INSTALLED'}|{status:'NOT_ACTIVATED'};

/**
 * Idempotent-by-construction: `installProductionBootstrap` itself throws on a second call in the
 * same process (see production-bootstrap.ts), so calling this twice surfaces that existing
 * duplicate-installation guard rather than silently succeeding twice.
 *
 * V4 (TD correction): always calls the real, override-free `issueExactProductionIdentity`
 * directly — no injectable parameter of any kind. A test can only prove the reject paths (missing
 * activation/env fields, or a synthetic-but-wrong host/project reaching the identity gate and
 * being refused); the accept path is provable only in the real Production environment, the same
 * disclosed trade-off `issueExactProductionIdentity` itself carries.
 */
export function installProductionHostingComposition(env:Readonly<Record<string,string|undefined>> = process.env):HostingCompositionResult{
 const e=readAllowlistedEnv(env);
 if(e.ZAO_PRODUCTION_HOSTING_ACTIVATION!==HOSTING_ACTIVATION_TOKEN)return {status:'NOT_ACTIVATED'}; // default OFF; anything else is inert, not an error
 if(e.VERCEL_ENV!=='production')throw new Error('PRODUCTION_HOSTING_WRONG_VERCEL_ENVIRONMENT');
 if(!e.VERCEL_PROJECT_ID||!e.VERCEL_DEPLOYMENT_ID||!e.VERCEL_URL)throw new Error('PRODUCTION_HOSTING_DEPLOYMENT_IDENTITY_MISSING');
 if(!e.PRODUCTION_DB_HOST||!e.PRODUCTION_DB_NAME)throw new Error('PRODUCTION_HOSTING_DB_IDENTITY_MISSING');
 const roles={} as Record<ProductionService,string>;
 for(const s of productionServices){
  const role=e[roleKey(s)];
  if(!role)throw new Error('PRODUCTION_HOSTING_ROLE_NAME_MISSING');
  roles[s]=role;
 }
 for(const k of ['PRODUCTION_GUEST_KEY','PRODUCTION_STAFF_KEY','PRODUCTION_ACCESS_KEY','PRODUCTION_RECOVERY_KEY'] as const)if(!e[k]||!/^[a-f0-9]{64}$/.test(e[k]!))throw new Error('PRODUCTION_HOSTING_SIGNING_KEY_INVALID');
 for(const k of ['PRODUCTION_ACCESS_KEY_VERSION','PRODUCTION_RECOVERY_KEY_VERSION'] as const)if(!e[k]||!/^[-A-Za-z0-9_]{1,64}$/.test(e[k]!))throw new Error('PRODUCTION_HOSTING_KEY_VERSION_INVALID');

 const c=productionConfiguration({
  schemaVersion:1,capability:'ZAO_PRODUCTION_RUNTIME_V1',
  deployment:{provider:'VERCEL',environment:'production',projectId:e.VERCEL_PROJECT_ID,releaseId:e.VERCEL_DEPLOYMENT_ID,origin:'https://'+e.VERCEL_URL},
  database:{provider:'NEON',environment:'production',host:e.PRODUCTION_DB_HOST,name:e.PRODUCTION_DB_NAME,roles},
  flags:{booking:false,guestRecovery:false,payment:false,media:false,avatar:false,staffOperations:false},
  guest:DARK_GUEST_POLICY,approvedGuestSha256:guestConfigurationHash(DARK_GUEST_POLICY),
  payment:null,media:null,
 });
 // V3-B/V4 (TD correction): a syntactically-valid Production-shaped config is not proof it is
 // *the* real Production target (wrong Neon branch, wrong Vercel project, right-shaped-but-wrong
 // DB name all parse fine). This throws before any bootstrap install is attempted, exactly as
 // production-projection-authority.ts already requires for payment projection.
 issueExactProductionIdentity(c);
 const input:ProductionRuntimeInput={
  configuration:c,approvedConfigurationSha256:productionConfigurationDigest(c),deployment:c.deployment,
  secrets:{
   guestKey:e.PRODUCTION_GUEST_KEY!,staffKey:e.PRODUCTION_STAFF_KEY!,accessKey:e.PRODUCTION_ACCESS_KEY!,recoveryKey:e.PRODUCTION_RECOVERY_KEY!,
   accessKeyVersion:e.PRODUCTION_ACCESS_KEY_VERSION!,recoveryKeyVersion:e.PRODUCTION_RECOVERY_KEY_VERSION!,
   // Empty: no service is ever active with every flag false, so no password is ever needed —
   // composeProductionRuntime's own validateProductionCredential/connect loop only runs for a
   // service that is either active or has a credential supplied; neither is true for any service here.
   database:{},
  },
  // No guest traffic is ever admitted with flags.booking=false; this is never invoked.
  verifiedPeer:()=>undefined,
  audit:async()=>{},
 };
 installProductionBootstrap(input);
 return {status:'INSTALLED'};
}
