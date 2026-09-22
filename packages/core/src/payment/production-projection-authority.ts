import {flowId} from '../../../contracts/src/rental-flow';
import {exactProductionIdentityConfiguration,type ExactProductionIdentity} from '../../../auth/src/production-identity';
import type {ProductionConfiguration} from '../../../auth/src/production-config';
export type ProductionProjectionTarget={bookingId:string;attemptId:string;database:string;merchantId:string};
export type ProductionProjectionPermit=Readonly<{kind:'SQUARE_PRODUCTION_PROJECTION'}>;
const issued=new WeakMap<ProductionProjectionPermit,Readonly<ProductionProjectionTarget>>();

/** V4 (TD correction): pure — operates on a plain ProductionConfiguration directly, no
 * ExactProductionIdentity capability needed. Proves the validation rule itself (a Square
 * PRODUCTION payment binding with a database name) without needing a real, capability-minted
 * identity, which — with no test-only issuer anywhere — would otherwise be impossible to
 * construct in a test. Returns the target fields it would bind, or null if the config doesn't
 * qualify at all. */
export function deriveProductionProjectionTarget(config:Readonly<ProductionConfiguration>):{database:string;merchantId:string}|null{
 if(!config.payment||config.payment.provider!=='SQUARE'||config.payment.environment!=='PRODUCTION'||!config.database?.name)return null;
 return {database:config.database.name,merchantId:config.payment.merchantId};
}

/**
 * PROD-R6-C/F2 (integration-corrected): a merely-*validated* `ProductionConfiguration` is not
 * evidence of Production — a misconfigured-but-syntactically-valid other Neon/Vercel target would
 * pass `productionConfiguration()`'s own parsing too. This now requires an `ExactProductionIdentity`
 * — issued only after `packages/auth/src/production-identity.ts`'s `issueExactProductionIdentity`
 * additionally confirms the pinned Neon host fingerprint, the pinned database name, and the
 * pinned Vercel project fingerprint (a Preview `deployment.environment` or any other project/host/
 * database, even if otherwise well-formed, is rejected there before this function is ever
 * reached). There is no raw env record and no caller-supplied database string here at all: the
 * database identity and merchant come only from the configuration bound to that capability.
 * Request objects/flags/browser input are not inputs to this function.
 *
 * The DB-connection layer (packages/db/src/payment-projection.ts) separately still requires the
 * *connected* role/database to exactly equal what this permit was issued for — that remains the
 * final enforcement point regardless of what identity evidence was checked to get here.
 */
export function productionProjectionPermit(identity:ExactProductionIdentity,ref:{bookingId:string;attemptId:string}):ProductionProjectionPermit{
 const config=exactProductionIdentityConfiguration(identity);
 const derived=config&&deriveProductionProjectionTarget(config);
 if(!derived)throw new Error('PRODUCTION_PROJECTION_AUTHORITY_REQUIRED');
 flowId(ref.bookingId);flowId(ref.attemptId);
 const target:ProductionProjectionTarget={bookingId:ref.bookingId,attemptId:ref.attemptId,...derived};
 const permit=Object.freeze({kind:'SQUARE_PRODUCTION_PROJECTION' as const});issued.set(permit,Object.freeze(target));return permit;
}
export function productionProjectionTarget(permit?:ProductionProjectionPermit,ref?:{bookingId:string;attemptId:string}):Readonly<ProductionProjectionTarget>|null{
 const target=permit?issued.get(permit):undefined;
 return target&&(!ref||ref.bookingId===target.bookingId&&ref.attemptId===target.attemptId)?target:null;
}
