import {createHash} from 'node:crypto';
import {parseVerifiedSquareWebhook,verifySquareWebhook} from './square-boundary';
import type {SquareWebhookInbox,WebhookEnvironment} from './square-webhook-inbox';

export const SQUARE_WEBHOOK_LIMIT=65536;
export type SquareWebhookConfiguration={environment:WebhookEnvironment;merchantId:string;notificationUrl:string;signatureKey:string};
function reply(status:number,classification:string){
 return Response.json({classification},{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow',...(status===405?{Allow:'POST'}:{})}});
}
class BodyLimit extends Error {}
async function rawBytes(request:Request):Promise<Uint8Array>{
 const length=request.headers.get('content-length');
 if(length&&/^\d+$/.test(length)&&Number(length)>SQUARE_WEBHOOK_LIMIT)throw new BodyLimit();
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();
 let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;
  if(size>SQUARE_WEBHOOK_LIMIT){await reader.cancel().catch(()=>{});throw new BodyLimit();}chunks.push(chunk.value);
 }}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
function record(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v);}
const identifier=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max&&/^[A-Za-z0-9_-]+$/.test(v);
/** Retry-count/reason, Host and forwarded URL headers confer no authority. No raw payload/log sink escapes. */
export function squareWebhookReceiver(config:SquareWebhookConfiguration|null,inbox:()=>SquareWebhookInbox){
 return async(request:Request):Promise<Response>=>{
  if(request.method!=='POST')return reply(405,'METHOD_NOT_ALLOWED');
  if(!config?.signatureKey||!config.merchantId||!/^https:\/\//.test(config.notificationUrl))return reply(503,'WEBHOOK_NOT_CONFIGURED');
  let raw:Uint8Array;
  try{raw=await rawBytes(request);}catch(error){return reply(error instanceof BodyLimit?413:400,error instanceof BodyLimit?'WEBHOOK_TOO_LARGE':'WEBHOOK_BODY_UNREADABLE');}
  const signature=request.headers.get('x-square-hmacsha256-signature')??undefined;
  if(!verifySquareWebhook(raw,signature,config.notificationUrl,config.signatureKey))return reply(403,'WEBHOOK_SIGNATURE_REJECTED');
  let envelope:unknown;
  try{envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{return reply(422,'INVALID_WEBHOOK');}
  if(!record(envelope)||!identifier(envelope.event_id,128)||!identifier(envelope.merchant_id,100)||typeof envelope.type!=='string'||! /^[a-z][a-z0-9_.]{0,99}$/.test(envelope.type))return reply(422,'INVALID_WEBHOOK');
  if(envelope.merchant_id!==config.merchantId)return reply(403,'WEBHOOK_MERCHANT_REJECTED');
  // Signed, correct-merchant unsupported events are deliberately ignored, never queued.
  // This explicit 200 exception prevents permanent retries; it is NOT a durable payment ACK.
  if(envelope.type!=='payment.created'&&envelope.type!=='payment.updated')return reply(200,'IGNORED_UNSUPPORTED_EVENT');
  let event;
  try{event=parseVerifiedSquareWebhook(raw,signature,config.notificationUrl,config.signatureKey);}
  catch{return reply(422,'INVALID_WEBHOOK');}
  if(!identifier(event.paymentId,100))return reply(422,'INVALID_WEBHOOK');
  try{
   const received=await inbox().receive({...event,environment:config.environment,bodySha256:createHash('sha256').update(raw).digest('hex')});
   switch(received){
    case 'INSERTED':return reply(200,'RECEIVED');
    case 'DUPLICATE':return reply(200,'DUPLICATE');
    case 'HASH_CONFLICT':return reply(409,'EVENT_HASH_CONFLICT');
    default:return reply(503,'WEBHOOK_INBOX_UNAVAILABLE');
   }
  }catch{
   // No database/transport error details are safe for the response.
   return reply(503,'WEBHOOK_INBOX_UNAVAILABLE');
  }
 };
}
