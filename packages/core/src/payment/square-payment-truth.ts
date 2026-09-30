import {squareObservation} from './square-boundary';
import {SQUARE_SANDBOX_ORIGIN,SQUARE_VERSION,type SquareSandboxTransport} from './square-sandbox';
import type {PaymentTruthProvider,LookupResult} from './payment-reconciliation';
import {flowId,matchPayment} from '../../../contracts/src/rental-flow';
import {SQUARE_PRODUCTION_ORIGIN,type SquareProductionTransport} from './square-production';
/** Unconnected transport adapter. No credential reader/default fetch/create/refund method. */
export class SquareSandboxPaymentTruth implements PaymentTruthProvider{
 constructor(private readonly transport:SquareSandboxTransport){}
 async lookupPayment(input:Parameters<PaymentTruthProvider['lookupPayment']>[0]):Promise<LookupResult>{
  const fail=(code:Extract<LookupResult,{kind:'FAILED'}>['code']):LookupResult=>({kind:'FAILED',code});
  if(input.environment!=='SANDBOX'||this.transport.environment!=='SANDBOX'||input.expected.merchantId!==this.transport.merchantId||input.expected.currency!=='JPY'||!Number.isSafeInteger(input.expected.amountJpy)||input.expected.amountJpy<1||!/^[-A-Za-z0-9_]{1,100}$/.test(input.paymentId))return fail('EVIDENCE_MISMATCH_BLOCKED');
  let response:Awaited<ReturnType<SquareSandboxTransport['send']>>;
  try{response=await this.transport.send({method:'GET',url:SQUARE_SANDBOX_ORIGIN+'/v2/payments/'+input.paymentId,version:SQUARE_VERSION,signal:input.signal});}
  catch(error){const e=error as {name?:string;code?:string};return fail(input.signal.aborted||e?.name==='AbortError'||['ETIMEDOUT','ECONNRESET','ECONNREFUSED','EAI_AGAIN'].includes(e?.code??'')?'NETWORK_RETRYABLE':'INVALID_RESPONSE_BLOCKED');}
  if(!response||!Number.isInteger(response.status))return fail('INVALID_RESPONSE_BLOCKED');
  if(response.status===401||response.status===403)return fail('AUTH_BLOCKED');
  if(response.status===429)return fail('RATE_LIMITED');
  if(response.status===404)return fail('NOT_FOUND_BLOCKED');
  if(response.status>=500&&response.status<=599)return fail('PROVIDER_5XX_RETRYABLE');
  if(response.status!==200)return fail('INVALID_RESPONSE_BLOCKED');
  try{return {kind:'OBSERVED',observation:squareObservation((response.body as {payment?:unknown}|null)?.payment,input.expected,this.transport.merchantId)};}
  catch{return fail('INVALID_RESPONSE_BLOCKED');}
 }
}

/** Production lookup only. Merchant/location are transport-bound; the idempotency key comes
 * from the persisted attempt (GetPayment does not return one), never from webhook evidence. */
export class SquareProductionPaymentTruth implements PaymentTruthProvider{
 constructor(private readonly transport:SquareProductionTransport&{readonly locationId:string}){}
 async lookupPayment(input:Parameters<PaymentTruthProvider['lookupPayment']>[0]):Promise<LookupResult>{
  const fail=(code:Extract<LookupResult,{kind:'FAILED'}>['code']):LookupResult=>({kind:'FAILED',code});
  const {expected:e}=input;
  try{flowId(e.bookingId);flowId(e.attemptId);flowId(e.idempotencyKey);}catch{return fail('EVIDENCE_MISMATCH_BLOCKED');}
  if(input.environment!=='PRODUCTION'||this.transport.environment!=='PRODUCTION'||typeof e.merchantId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(e.merchantId)||typeof e.locationId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(e.locationId)||e.merchantId!==this.transport.merchantId||e.locationId!==this.transport.locationId||e.currency!=='JPY'||!Number.isSafeInteger(e.amountJpy)||e.amountJpy<1||e.amountJpy>100000000||!/^[A-Za-z0-9_-]{1,100}$/.test(input.paymentId))return fail('EVIDENCE_MISMATCH_BLOCKED');
  let response:Awaited<ReturnType<SquareProductionTransport['send']>>;
  try{response=await this.transport.send({method:'GET',url:SQUARE_PRODUCTION_ORIGIN+'/v2/payments/'+input.paymentId,version:SQUARE_VERSION,signal:input.signal});}
  catch(error){
   const err=error as {name?:string;code?:string};
   if(err?.code==='SQUARE_AUTH_STOP')return fail('AUTH_BLOCKED');
   if(err?.code==='SQUARE_INVALID_RESPONSE')return fail('INVALID_RESPONSE_BLOCKED');
   return fail(input.signal.aborted||err?.name==='AbortError'||err?.name==='TypeError'||['PAYMENT_LOOKUP_UNAVAILABLE','ETIMEDOUT','ECONNRESET','ECONNREFUSED','EAI_AGAIN'].includes(err?.code??'')?'NETWORK_RETRYABLE':'INVALID_RESPONSE_BLOCKED');
  }
  if(!response||!Number.isInteger(response.status))return fail('INVALID_RESPONSE_BLOCKED');
  if(response.status===401||response.status===403)return fail('AUTH_BLOCKED');
  if(response.status===429)return fail('RATE_LIMITED');
  if(response.status===404)return fail('NOT_FOUND_BLOCKED');
  if(response.status>=500&&response.status<=599)return fail('PROVIDER_5XX_RETRYABLE');
  if(response.status!==200)return fail('INVALID_RESPONSE_BLOCKED');
  try{
   const raw=(response.body as {payment?:Record<string,unknown>}|null)?.payment;
   if(raw&&(raw.merchant_id!==undefined&&raw.merchant_id!==e.merchantId||raw.idempotency_key!==undefined&&raw.idempotency_key!==e.idempotencyKey))return fail('EVIDENCE_MISMATCH_BLOCKED');
   const observation=squareObservation(raw,e,this.transport.merchantId);
   matchPayment(e,observation);
   if(observation.providerId!==input.paymentId||observation.completedAt!==null&&Date.parse(observation.completedAt)>Date.parse(observation.updatedAt))return fail('EVIDENCE_MISMATCH_BLOCKED');
   return {kind:'OBSERVED',observation};
  }catch{return fail('INVALID_RESPONSE_BLOCKED');}
 }
}
