import {squareObservation} from './square-boundary';
import {SQUARE_SANDBOX_ORIGIN,SQUARE_VERSION,type SquareSandboxTransport} from './square-sandbox';
import type {PaymentTruthProvider,LookupResult} from './payment-reconciliation';
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
