import type {BookingNotificationDelivery,DeliveryResult,NotificationMessage} from './contracts';
export const RESEND_SENDER='ZAO Rental <rentalstation@yuge-zao.com>';
/** Unconnected transport adapter. Resend has no lookup by idempotency key; deliberately no
 * lookup method. Only explicit NOT_ACCEPTED may be retried by the durable outbox worker. */
export class ResendDelivery implements BookingNotificationDelivery{
 constructor(private credential:()=>Promise<{secret:string;revoked:boolean}>,private fetch:(url:string,init:RequestInit)=>Promise<Response>){}
 async send(m:NotificationMessage,signal:AbortSignal):Promise<DeliveryResult>{
  if(!/^[a-f0-9]{64}$/.test(m.idempotencyKey)||m.recipient.length>254||!/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(m.recipient)||!m.subject||m.subject.length>200||/[\r\n]/.test(m.subject)||m.text.length>64000)return {state:'REJECTED',code:'PERMANENT_REJECT'};
  try{
   signal.throwIfAborted();const c=await this.credential();if(c.revoked||!/^re_[-A-Za-z0-9_]{16,200}$/.test(c.secret))return {state:'REJECTED',code:'PERMANENT_REJECT'};signal.throwIfAborted();
   const r=await this.fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+c.secret,'Content-Type':'application/json','Idempotency-Key':m.idempotencyKey},body:JSON.stringify({from:RESEND_SENDER,to:[m.recipient],subject:m.subject,text:m.text}),signal,redirect:'error',cache:'no-store',credentials:'omit'});
   if(r.status===429){await r.body?.cancel();return {state:'NOT_ACCEPTED',code:'RATE_LIMITED'};}
   if([400,401,403,422].includes(r.status)){await r.body?.cancel();return {state:'REJECTED',code:'PERMANENT_REJECT'};}
   if(r.status<200||r.status>=300){await r.body?.cancel();return {state:'UNKNOWN'};}
   const reader=r.body?.getReader();if(!reader)return {state:'UNKNOWN'};const chunks:Uint8Array[]=[];let size=0;
   try{while(true){signal.throwIfAborted();const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>65536)throw Error();chunks.push(chunk.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));return typeof v.id==='string'&&/^[-A-Za-z0-9_]{1,128}$/.test(v.id)?{state:'ACCEPTED',providerMessageId:v.id}:{state:'UNKNOWN'};
  }catch{return {state:'UNKNOWN'};}
 }
}
