import {createHmac,timingSafeEqual} from 'node:crypto';
import {FlowError,type PaymentObservation,type PaymentRequest} from '../../../contracts/src/rental-flow';
// Official Square contract: HMAC-SHA256 over notification URL + unmodified raw body.
// No secrets/transport are configured here; this pure boundary makes no HTTP request.
export function verifySquareWebhook(raw:Uint8Array,signature:string|undefined,notificationUrl:string,key:string){
 if(!signature||!key||raw.byteLength>65536||!/^https:\/\//.test(notificationUrl)||!/^[-A-Za-z0-9+/]{43}=$/.test(signature))return false;
 const expected=createHmac('sha256',key).update(notificationUrl).update(raw).digest(),received=Buffer.from(signature,'base64');
 return received.length===expected.length&&timingSafeEqual(received,expected);
}
export function squareCreateBody(r:PaymentRequest,sourceId:string){if(!sourceId)throw new FlowError('PAYMENT_SOURCE_NOT_CONNECTED',503);return {idempotency_key:r.idempotencyKey,source_id:sourceId,reference_id:r.bookingId,location_id:r.locationId,amount_money:{amount:r.amountJpy,currency:r.currency},autocomplete:true};}
export function squareObservation(raw:unknown,request:PaymentRequest,merchantId:string):PaymentObservation{
 if(!raw||typeof raw!=='object')throw new FlowError('INVALID_PROVIDER_RESPONSE');const p=raw as Record<string,unknown>,money=p.amount_money as Record<string,unknown>|undefined;
 if(!money||typeof p.id!=='string'||typeof p.reference_id!=='string'||typeof p.location_id!=='string'||typeof p.updated_at!=='string'||!['APPROVED','PENDING','COMPLETED','FAILED','CANCELED'].includes(String(p.status))||money.currency!=='JPY'||!(typeof money.amount==='number'||typeof money.amount==='bigint')||!Number.isSafeInteger(Number(money.amount)))throw new FlowError('INVALID_PROVIDER_RESPONSE');
 const timeline=(p.card_details as {card_payment_timeline?:{captured_at?:unknown}}|undefined)?.card_payment_timeline;
 const captured=typeof timeline?.captured_at==='string'?timeline.captured_at:null;
 // Idempotency is bound to the persisted request/verified lookup, not a field claimed by a webhook.
 return {providerId:p.id,referenceId:p.reference_id,idempotencyKey:request.idempotencyKey,merchantId,locationId:p.location_id,amountJpy:Number(money.amount),currency:'JPY',status:p.status==='APPROVED'?'PENDING':p.status as PaymentObservation['status'],updatedAt:p.updated_at,completedAt:p.status==='COMPLETED'?captured:null};
}
export type SquareWebhook={eventId:string;merchantId:string;paymentId:string;type:'payment.created'|'payment.updated'};
export function parseVerifiedSquareWebhook(raw:Uint8Array,signature:string|undefined,url:string,key:string):SquareWebhook{
 if(!verifySquareWebhook(raw,signature,url,key))throw new FlowError('WEBHOOK_SIGNATURE_REJECTED',403);
 let v:Record<string,unknown>;try{v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw new FlowError('INVALID_WEBHOOK',422);}
 const data=v.data as Record<string,unknown>|undefined;const object=data?.object as Record<string,unknown>|undefined;const payment=object?.payment as Record<string,unknown>|undefined;
 if(!['payment.created','payment.updated'].includes(String(v.type))||typeof v.event_id!=='string'||v.event_id.length>128||typeof v.merchant_id!=='string'||v.merchant_id.length>100||typeof payment?.id!=='string'||payment.id.length>100)throw new FlowError('INVALID_WEBHOOK',422);
 return {eventId:v.event_id,merchantId:v.merchant_id,paymentId:payment.id,type:v.type as SquareWebhook['type']};
}
