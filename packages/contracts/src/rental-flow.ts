import {createHash} from 'node:crypto';
import {canonical,normalizePeriod,type HoldConditions} from './hold';
import type {StoreId} from './ledger';
import {brandContractError} from './contract-error';
export class FlowError extends Error{constructor(public code:string,public status=409){super(code);brandContractError(this);}}
export const flowPermissions=['BOOKING_VIEW','BOOKING_CREATE','RENTAL_CHECKOUT','RENTAL_RETURN'] as const;
export type FlowPermission=typeof flowPermissions[number];
export const flowHash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export function flowId(value:unknown):asserts value is string{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))throw new FlowError('INVALID_ID',422);}
export function flowObject(value:unknown,keys:readonly string[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())throw new FlowError('INVALID_INPUT',422);return value as Record<string,unknown>;}
export function flowStore(value:unknown):StoreId{if(value!=='MOUNTAIN_BASE'&&value!=='ONSEN_BASE')throw new FlowError('INVALID_STORE',422);return value;}
export function flowVersion(value:unknown):number{if(!Number.isSafeInteger(value)||Number(value)<1)throw new FlowError('INVALID_VERSION',422);return Number(value);}
export function syntheticContact(value:unknown){const v=flowObject(value&&typeof value==='object'&&!Array.isArray(value)&&'terms' in value?Object.fromEntries(Object.entries(value).filter(([k])=>k!=='terms')):value,['displayName','email','termsAccepted']);if(typeof v.displayName!=='string'||!/^SYNTHETIC [A-Za-z0-9 -]{1,60}$/.test(v.displayName)||typeof v.email!=='string'||!/^synthetic-[a-z0-9-]{1,64}@example\.invalid$/.test(v.email)||v.termsAccepted!==true)throw new FlowError('SYNTHETIC_PREVIEW_ONLY',422);return {displayName:v.displayName,email:v.email,termsAccepted:true,termsVersion:'DEVELOPMENT_PREVIEW_NOT_COMMERCIAL_TERMS_V1'};}
/** Commercial contact: the customer accepted the current rental terms bundle (version + SHA-256 of the exact JA/EN text,
 * shown in the locale named here). A missing, older or altered bundle is refused before any booking or payment work.
 * termsVersion stays the refund-arithmetic policy (ZAO_CANCELLATION_V1); rentalTerms is the accepted text bundle. */
export type RentalTermsAcceptance={version:string;sha256:string;locale:'ja'|'en'};
export function commercialContact(value:unknown,expected?:{version:string;sha256:string}){const v=flowObject(value,['displayName','email','termsAccepted','terms']);
 if(typeof v.displayName!=='string'||!v.displayName.trim()||v.displayName.length>120||/[\x00-\x1f\x7f]/.test(v.displayName)||typeof v.email!=='string'||v.email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)||v.termsAccepted!==true)throw new FlowError('INVALID_BOOKING_CONTACT',422);
 const terms=v.terms as Record<string,unknown>|null;if(!terms||typeof terms!=='object'||Array.isArray(terms)||Object.keys(terms).sort().join()!=='locale,sha256,version'||typeof terms.version!=='string'||typeof terms.sha256!=='string'||!/^[0-9a-f]{64}$/.test(terms.sha256)||(terms.locale!=='ja'&&terms.locale!=='en'))throw new FlowError('TERMS_ACCEPTANCE_REQUIRED',422);
 if(!expected||terms.version!==expected.version||terms.sha256!==expected.sha256)throw new FlowError('TERMS_VERSION_MISMATCH',409);
 const rentalTerms:RentalTermsAcceptance={version:terms.version,sha256:terms.sha256,locale:terms.locale};
 return {displayName:v.displayName.trim(),email:v.email.trim(),termsAccepted:true,termsVersion:'ZAO_CANCELLATION_V1',rentalTerms};
}
export type SyntheticContact=ReturnType<typeof syntheticContact>;
export type PaymentObservation={providerId:string;referenceId:string;idempotencyKey:string;merchantId:string;locationId:string;amountJpy:number;currency:'JPY';status:'PENDING'|'COMPLETED'|'FAILED'|'CANCELED';updatedAt:string;completedAt:string|null};
export type PaymentRequest={attemptId:string;bookingId:string;idempotencyKey:string;merchantId:string;locationId:string;amountJpy:number;currency:'JPY'};
export interface PaymentGateway{readonly kind:'SIMULATED_DEV'|'SQUARE_UNCONNECTED'|'SQUARE_SANDBOX'|'SQUARE_PRODUCTION';create(request:PaymentRequest,sourceToken?:string):Promise<PaymentObservation>;lookup(request:PaymentRequest,providerId:string|null):Promise<PaymentObservation|null>;}
export function matchPayment(expected:PaymentRequest,observed:PaymentObservation){if(!observed||typeof observed.providerId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(observed.providerId)||observed.referenceId!==expected.bookingId||observed.idempotencyKey!==expected.idempotencyKey||observed.merchantId!==expected.merchantId||observed.locationId!==expected.locationId||observed.currency!=='JPY'||!Number.isSafeInteger(observed.amountJpy)||observed.amountJpy!==expected.amountJpy||!['PENDING','COMPLETED','FAILED','CANCELED'].includes(observed.status)||!Number.isFinite(Date.parse(observed.updatedAt))||observed.status==='COMPLETED'&&(!observed.completedAt||!Number.isFinite(Date.parse(observed.completedAt))))throw new FlowError('PAYMENT_EVIDENCE_MISMATCH');}
export function expectedClaimKeys(c:HoldConditions){return c.members.flatMap(m=>m.items.flatMap(i=>normalizePeriod(c.period).dates.map(day=>m.key+':'+i.family+'/'+day))).sort();}
/** Exactly one durable witness for every requirement/day, including an explicit POLE exemption. */
export function claimKeysSatisfied(c:HoldConditions,actualKeys:string[]):boolean{
 const expected=expectedClaimKeys(c),actual=[...actualKeys].sort();
 return expected.length===actual.length&&expected.every((key,i)=>key===actual[i]);
}
export function reservationQr(id:string){flowId(id);return 'zao-rental:reservation:'+id;}
export function parseReservationQr(raw:unknown){if(typeof raw!=='string'||!raw.startsWith('zao-rental:reservation:'))throw new FlowError('INVALID_RESERVATION_QR',422);const id=raw.slice('zao-rental:reservation:'.length);flowId(id);return id;}
