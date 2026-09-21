import {flowId} from '../../../contracts/src/rental-flow';
export type ProductionProjectionTarget={bookingId:string;attemptId:string;database:string};
export type ProductionProjectionPermit=Readonly<{kind:'SQUARE_PRODUCTION_PROJECTION'}>;
const issued=new WeakMap<ProductionProjectionPermit,Readonly<ProductionProjectionTarget>>();
const ZR_PATTERN=/^zr_[a-f0-9]{12}$/;

/**
 * Only the private server composition may issue this capability, and only for a genuine
 * Production deployment. Mirrors r15ProjectionPermit's shape exactly, but every condition is
 * the converse: Production (never Preview), Production Square credentials (never Sandbox), and
 * a target database that is explicitly NOT the disposable `zr_<12hex>` local/dev pattern —
 * the Production database's real name is deployment-chosen and unknown to this module.
 * Request objects/flags are not inputs; nothing here is derived from an env var a caller controls.
 */
export function productionProjectionPermit(env:Readonly<Record<string,string|undefined>>,target:ProductionProjectionTarget):ProductionProjectionPermit{
 if(env.VERCEL_ENV!=='production'||env.SQUARE_ENVIRONMENT!=='PRODUCTION'||env.PRODUCTION_PAYMENT_ADMISSION_AUTHORITY!=='R6_PRODUCTION_ADMISSION'||ZR_PATTERN.test(target.database)||!target.database||!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(target.database))throw new Error('PRODUCTION_PROJECTION_AUTHORITY_REQUIRED');
 flowId(target.bookingId);flowId(target.attemptId);
 const permit=Object.freeze({kind:'SQUARE_PRODUCTION_PROJECTION' as const});issued.set(permit,Object.freeze({...target}));return permit;
}
export function productionProjectionTarget(permit?:ProductionProjectionPermit,ref?:{bookingId:string;attemptId:string}):Readonly<ProductionProjectionTarget>|null{
 const target=permit?issued.get(permit):undefined;
 return target&&(!ref||ref.bookingId===target.bookingId&&ref.attemptId===target.attemptId)?target:null;
}
