import {HoldError} from './hold';
import {exact} from './pricing';
export const operationalCodes=['PAYMENT_UNKNOWN','WEBHOOK_FAILED','INVENTORY_INVARIANT_FAILED','GUEST_RECOVERY_ABUSE','RATE_LIMIT_SATURATED','MIGRATION_FAILED','BACKUP_FAILED','CUSTODY_INCONSISTENT','STORAGE_FAILED'] as const;
export type OperationalCode=typeof operationalCodes[number];
export function productionEvent(input:unknown){const e=exact(input,['schemaVersion','code','requestId','occurredAt','releaseSha','retryDisposition']);if(e.schemaVersion!==1||!operationalCodes.includes(e.code as OperationalCode)||typeof e.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(e.requestId)||typeof e.occurredAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.occurredAt)||!Number.isFinite(Date.parse(e.occurredAt))||typeof e.releaseSha!=='string'||!/^[a-f0-9]{40}$/.test(e.releaseSha)||!['STOP','RECONCILE_ONLY'].includes(String(e.retryDisposition)))throw new HoldError('OPERATIONAL_EVENT_REJECTED',422);return Object.freeze({...e,severity:e.code==='RATE_LIMIT_SATURATED'?'WARN':'ERROR'});}
export interface OperationalSink{write(event:ReturnType<typeof productionEvent>):Promise<void>;}
/** Explicit controlled boundary, never serialize Error, request, response or arbitrary fields. */
export async function reportProductionEvent(input:unknown,sink:OperationalSink){const e=productionEvent(input);try{await sink.write(e);}catch{throw new HoldError('OPERATIONAL_SINK_UNAVAILABLE',503);}return e;}
export const secretPurposes=['DATABASE','SQUARE_ACCESS','SQUARE_WEBHOOK','STORAGE','GUEST_RECOVERY'] as const;
export type SecretPurpose=typeof secretPurposes[number];
export type SecretMetadata={purpose:SecretPurpose;keyId:string;state:'ACTIVE'|'RETIRING'|'REVOKED';notBefore:string;expiresAt:string;graceUntil:string|null};
/** Metadata only. Secret values never belong in config/audit/fixtures. Actual providers
 * resolve opaque IDs at server startup; browser/public-prefixed environment is forbidden. */
export function secretMetadata(input:unknown,now:Date){const s=exact(input,['purpose','keyId','state','notBefore','expiresAt','graceUntil']);if(!secretPurposes.includes(s.purpose as SecretPurpose)||typeof s.keyId!=='string'||!/^[-a-zA-Z0-9_.]{1,100}$/.test(s.keyId)||!['ACTIVE','RETIRING','REVOKED'].includes(String(s.state))||typeof s.notBefore!=='string'||typeof s.expiresAt!=='string'||!Number.isFinite(Date.parse(s.notBefore))||!Number.isFinite(Date.parse(s.expiresAt))||!Number.isFinite(now.getTime())||Date.parse(s.notBefore)>=Date.parse(s.expiresAt)||s.graceUntil!==null&&(typeof s.graceUntil!=='string'||!Number.isFinite(Date.parse(s.graceUntil))||Date.parse(s.graceUntil)>Date.parse(s.expiresAt)||Date.parse(s.graceUntil)<Date.parse(s.notBefore)))throw new HoldError('SECRET_METADATA_INVALID',503);return s as SecretMetadata;}
export function activeSecretSet(input:unknown[],required:readonly SecretPurpose[],now:Date){const keys=input.map(v=>secretMetadata(v,now));if(new Set(keys.map(k=>k.keyId)).size!==keys.length)throw new HoldError('SECRET_METADATA_INVALID',503);for(const p of required){const active=keys.filter(k=>k.purpose===p&&k.state==='ACTIVE'&&new Date(k.notBefore)<=now&&new Date(k.expiresAt)>now);if(active.length!==1)throw new HoldError('SECRET_REQUIRED',503);}return keys;}
export function secretRotationRequirements(p:SecretPurpose){
 const policies={DATABASE:{oldKeyGrace:'DRAIN_EXISTING_POOLS',implemented:false},SQUARE_ACCESS:{oldKeyGrace:'IN_FLIGHT_REQUESTS_ONLY',implemented:false},SQUARE_WEBHOOK:{oldKeyGrace:'EXPLICIT_EVENT_RETRY_WINDOW',implemented:false},STORAGE:{oldKeyGrace:'SIGNED_TICKET_EXPIRY_AND_CDN_PURGE',implemented:false},GUEST_RECOVERY:{oldKeyGrace:'EXISTING_REPLAY_WINDOW',implemented:false}} as const;
 return policies[p];
}
export type RestoreEvidence={backupSha256:string;schemaSha256:string;sourceIdentity:string;restoredIdentity:string;integrityPassed:boolean;verifiedAt:string;method:'COLD_CLUSTER_SAME_MAJOR';rpoSeconds:number;rtoSeconds:number};
export function restoreEvidence(input:RestoreEvidence){if(!/^[a-f0-9]{64}$/.test(input.backupSha256)||!/^[a-f0-9]{64}$/.test(input.schemaSha256)||!input.sourceIdentity||!input.restoredIdentity||input.sourceIdentity===input.restoredIdentity||!input.integrityPassed||!Number.isFinite(Date.parse(input.verifiedAt))||input.method!=='COLD_CLUSTER_SAME_MAJOR'||![input.rpoSeconds,input.rtoSeconds].every(n=>Number.isFinite(n)&&n>=0))throw new HoldError('RESTORE_NOT_VERIFIED',503);return {...input,productionRpoRtoApproved:false};}

/** Environment entry contains IDs/lifecycle metadata only, not the secret material.
 * No NEXT_PUBLIC_* names are approved at this secret boundary. Reject every
 * nonempty public setting; a future public-config allowlist needs explicit review.
 * No alias/default/public environment fallback or provider lookup happens here. */
export function secretMetadataFromEnvironment(env:Readonly<Record<string,string|undefined>>,required:readonly SecretPurpose[],now:Date){
 const raw=env.ZAO_PRODUCTION_SECRET_METADATA;if(!raw||Buffer.byteLength(raw)>16384||Object.keys(env).some(k=>/^NEXT_PUBLIC_/i.test(k)&&env[k]))throw new HoldError('SECRET_METADATA_INVALID',503);
 let v:unknown;try{v=JSON.parse(raw);}catch{throw new HoldError('SECRET_METADATA_INVALID',503);}if(!Array.isArray(v)||v.length>20)throw new HoldError('SECRET_METADATA_INVALID',503);return activeSecretSet(v,required,now);
}

/** Operations console vocabulary. An exception is an acknowledged projection of existing
 * business/audit state, never the authority for payment, inventory, refund or delivery. */
export const exceptionCodes=['PAYMENT_PENDING','PAYMENT_UNKNOWN','WEBHOOK_RECONCILIATION_REQUIRED','WEBHOOK_FAILED','HOLD_EXPIRED','TRANSFER_DELAYED','RETURN_INSPECTION_REQUIRED','INVENTORY_INVARIANT_FAILED','REFUND_PENDING','REFUND_UNKNOWN','NOTIFICATION_FAILED','STORAGE_FAILED','BOOKING_RECOVERY_FAILED','DB_UNAVAILABLE','PROVIDER_TIMEOUT'] as const;
export type ExceptionCode=typeof exceptionCodes[number];
export const exceptionStores=['MOUNTAIN_BASE','ONSEN_BASE','SYSTEM'] as const;
export const exceptionReasons=['TRIAGED','ASSIGNED','VERIFIED_WITH_CANONICAL_RECORD'] as const;
/** Runtime transport/media/database failures that a request can observe directly. */
export const exceptionSignalCodes=['STORAGE_FAILED','NOTIFICATION_FAILED','BOOKING_RECOVERY_FAILED','DB_UNAVAILABLE','PROVIDER_TIMEOUT','WEBHOOK_FAILED'] as const;
export type ExceptionSignalCode=typeof exceptionSignalCodes[number];
/** Safe projection: identifiers, fixed enums and times only. No recipient, provider payload,
 * token, signed URL, stack or raw error text is representable here. */
export type SafeException={id:string;eventType:ExceptionCode;correlationId:string;bookingId:string|null;assetId:string|null;store:string;severity:'INFO'|'WARN'|'ERROR';status:'UNACKNOWLEDGED'|'ACKNOWLEDGED';occurredAt:string;resolvedAt:string|null;resolutionActor:string|null;resolutionReason:typeof exceptionReasons[number]|null;sourceConditionActive:boolean|null};
export function operationalExceptionSignal(input:unknown){
 const v=exact(input,['eventType','correlationId','store']);
 if(!exceptionSignalCodes.includes(v.eventType as ExceptionSignalCode)||typeof v.correlationId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.correlationId)||!exceptionStores.includes(v.store as typeof exceptionStores[number]))throw new HoldError('OPERATIONAL_EVENT_REJECTED',422);
 return {eventType:v.eventType as ExceptionSignalCode,correlationId:v.correlationId,store:v.store as typeof exceptionStores[number]};
}
