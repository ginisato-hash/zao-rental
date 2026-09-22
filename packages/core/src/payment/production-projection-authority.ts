import {flowId} from '../../../contracts/src/rental-flow';
import {isValidatedProductionConfiguration,type ProductionConfiguration} from '../../../auth/src/production-config';
export type ProductionProjectionTarget={bookingId:string;attemptId:string;database:string;merchantId:string};
export type ProductionProjectionPermit=Readonly<{kind:'SQUARE_PRODUCTION_PROJECTION'}>;
const issued=new WeakMap<ProductionProjectionPermit,Readonly<ProductionProjectionTarget>>();

/**
 * PROD-R6-C (integration-corrected): only the private server composition may issue this
 * capability, and only from a `ProductionConfiguration` that has already survived
 * `productionConfiguration()`'s own strict parsing (real `.neon.tech` host, deployment-owned
 * origin, digest-approved shape — see packages/auth/src/production-config.ts). There is no raw
 * env record and no caller-supplied database string here anymore: the database identity and
 * merchant come only from that validated object, never from an arbitrary object shaped like one.
 * Request objects/flags/browser input are not inputs to this function at all. This deliberately
 * does not itself reject a `zr_*`-shaped `config.database.name`: this project's own established
 * fully-local integration-test convention (tests/readiness/normal-production-fixture.ts) uses a
 * disposable cluster's own database name as the stand-in "Production" identity precisely so the
 * full runtime can be proven against a real PostgreSQL without live Neon credentials — the
 * evidence this function actually requires is a `ProductionConfiguration` that already passed
 * strict structural validation, not a naming convention on top of it. The DB-connection layer
 * (packages/db/src/payment-projection.ts) separately still requires the *connected* role/database
 * to exactly equal what this permit was issued for, which is the real enforcement point.
 */
export function productionProjectionPermit(config:Readonly<ProductionConfiguration>,ref:{bookingId:string;attemptId:string}):ProductionProjectionPermit{
 if(
  !isValidatedProductionConfiguration(config)||
  config.deployment.provider!=='VERCEL'||config.deployment.environment!=='production'||
  !config.payment||config.payment.provider!=='SQUARE'||config.payment.environment!=='PRODUCTION'||
  !config.database?.name
 )throw new Error('PRODUCTION_PROJECTION_AUTHORITY_REQUIRED');
 flowId(ref.bookingId);flowId(ref.attemptId);
 const target:ProductionProjectionTarget={bookingId:ref.bookingId,attemptId:ref.attemptId,database:config.database.name,merchantId:config.payment.merchantId};
 const permit=Object.freeze({kind:'SQUARE_PRODUCTION_PROJECTION' as const});issued.set(permit,Object.freeze(target));return permit;
}
export function productionProjectionTarget(permit?:ProductionProjectionPermit,ref?:{bookingId:string;attemptId:string}):Readonly<ProductionProjectionTarget>|null{
 const target=permit?issued.get(permit):undefined;
 return target&&(!ref||ref.bookingId===target.bookingId&&ref.attemptId===target.attemptId)?target:null;
}
