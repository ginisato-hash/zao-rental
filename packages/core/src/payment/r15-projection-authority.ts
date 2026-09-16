import {flowId} from '../../../contracts/src/rental-flow';
export type R15ProjectionTarget={bookingId:string;attemptId:string;database:string};
export type R15ProjectionPermit=Readonly<{kind:'R15_HOSTED_SYNTHETIC_PROJECTION'}>;
const issued=new WeakMap<R15ProjectionPermit,Readonly<R15ProjectionTarget>>();
/** Only the private server composition may issue this capability. Request objects/flags are not inputs. */
export function r15ProjectionPermit(env:Readonly<Record<string,string|undefined>>,target:R15ProjectionTarget):R15ProjectionPermit{
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_PROJECT_ID!=='prj_ehUMOzM77em9DVnHJBJffncD5hg7'||env.R15_ACTIVATION_AUTHORITY!=='P6_R15'||env.SQUARE_ENVIRONMENT!=='SANDBOX'||!/^zr_[a-f0-9]{12}$/.test(target.database))throw new Error('R15_PREVIEW_AUTHORITY_REQUIRED');
 flowId(target.bookingId);flowId(target.attemptId);
 const permit=Object.freeze({kind:'R15_HOSTED_SYNTHETIC_PROJECTION' as const});issued.set(permit,Object.freeze({...target}));return permit;
}
export function r15ProjectionTarget(permit?:R15ProjectionPermit,ref?:{bookingId:string;attemptId:string}):Readonly<R15ProjectionTarget>|null{
 const target=permit?issued.get(permit):undefined;
 return target&&(!ref||ref.bookingId===target.bookingId&&ref.attemptId===target.attemptId)?target:null;
}
