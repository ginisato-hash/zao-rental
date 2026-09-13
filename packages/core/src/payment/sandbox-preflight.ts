import {FlowError} from '../../../contracts/src/rental-flow';
import {exact} from '../../../contracts/src/pricing';
import {SQUARE_VERSION} from './square-sandbox';
import {parseVerifiedSquareWebhook,verifySquareWebhook,type SquareWebhook} from './square-boundary';
import {secretMetadata,type SecretMetadata} from '../../../contracts/src/production-operations';
import type {SandboxCredential} from './square-transport';
export type SandboxActivationMetadata={revision:string;environment:'SANDBOX';applicationId:string;merchantId:string;locations:{MOUNTAIN_BASE:string;ONSEN_BASE:string};apiVersion:typeof SQUARE_VERSION;notificationUrl:string;secretStoreId:string;accessKeyId:string;webhookKeys:SecretMetadata[];paymentLimit:20;refundLimit:5;redirectPolicy:'FIXED_ORIGIN_NO_PAYMENT_AUTHORITY';activation:'DISABLED'};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
export function sandboxActivationMetadata(input:unknown,now:Date):SandboxActivationMetadata{
 const v=exact(input,['revision','environment','applicationId','merchantId','locations','apiVersion','notificationUrl','secretStoreId','accessKeyId','webhookKeys','paymentLimit','refundLimit','redirectPolicy','activation']);
 const locations=exact(v.locations,['MOUNTAIN_BASE','ONSEN_BASE']);let url:URL;try{url=new URL(String(v.notificationUrl));}catch{throw new FlowError('SANDBOX_METADATA_INVALID',503);}
 if(!id(v.revision)||v.environment!=='SANDBOX'||!id(v.applicationId)||!id(v.merchantId)||!id(locations.MOUNTAIN_BASE)||!id(locations.ONSEN_BASE)||locations.MOUNTAIN_BASE===locations.ONSEN_BASE||v.apiVersion!==SQUARE_VERSION||url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!id(v.secretStoreId)||!id(v.accessKeyId)||v.paymentLimit!==20||v.refundLimit!==5||v.redirectPolicy!=='FIXED_ORIGIN_NO_PAYMENT_AUTHORITY'||v.activation!=='DISABLED'||!Array.isArray(v.webhookKeys)||v.webhookKeys.length<1||v.webhookKeys.length>2)throw new FlowError('SANDBOX_METADATA_INVALID',503);
 const keys=v.webhookKeys.map(k=>secretMetadata(k,now));
 if(keys.some(k=>k.purpose!=='SQUARE_WEBHOOK')||new Set(keys.map(k=>k.keyId)).size!==keys.length||keys.filter(k=>k.state==='ACTIVE').length!==1||keys.some(k=>k.state==='RETIRING'&&k.graceUntil===null))throw new FlowError('SANDBOX_METADATA_INVALID',503);
 return {...v,locations,webhookKeys:keys} as SandboxActivationMetadata;
}
/** Secret values remain exclusively in this injected server port and call stack.
 * No global env reader/default store. Real storage and provider setup remain blocked. */
export interface SandboxSecretResolver{
 access(keyId:string,signal:AbortSignal):Promise<SandboxCredential>;
 webhook(keyId:string,signal:AbortSignal):Promise<{keyId:string;value:string}>;
}
export function sandboxAccessResolver(config:SandboxActivationMetadata,resolver:SandboxSecretResolver,store:'MOUNTAIN_BASE'|'ONSEN_BASE'){
 return async(signal:AbortSignal)=>{signal.throwIfAborted();const c=await resolver.access(config.accessKeyId,signal);signal.throwIfAborted();if(c.environment!=='SANDBOX'||c.merchantId!==config.merchantId||c.locationId!==config.locations[store])throw new FlowError('SQUARE_AUTH_STOP',503);return c;};
}
/** Accept at most the active key and a specifically dated retiring key. This models
 * local receiver migration only; actual Square retry-signing behavior is unverified.
 * Exact configured URL + original bytes are verified before any parse/provider lookup. */
export async function verifySandboxReceiver(config:SandboxActivationMetadata,resolver:SandboxSecretResolver,raw:Uint8Array,signature:string|undefined,now:Date,signal:AbortSignal):Promise<{event:SquareWebhook;keyId:string}>{
 if(!Number.isFinite(now.getTime())||raw.byteLength>65536)throw new FlowError('WEBHOOK_SIGNATURE_REJECTED',403);
 const keys=config.webhookKeys.filter(k=>k.state!=='REVOKED'&&Date.parse(k.notBefore)<=now.getTime()&&Date.parse(k.expiresAt)>now.getTime()&&(k.state==='ACTIVE'||k.graceUntil!==null&&Date.parse(k.graceUntil)>now.getTime()));
 if(!keys.some(k=>k.state==='ACTIVE'))throw new FlowError('SQUARE_AUTH_STOP',503);
 let matched:{value:string;keyId:string}|undefined;
 for(const k of keys){signal.throwIfAborted();const secret=await resolver.webhook(k.keyId,signal);signal.throwIfAborted();if(secret.keyId!==k.keyId||secret.value.length<32)throw new FlowError('SQUARE_AUTH_STOP',503);if(verifySquareWebhook(raw,signature,config.notificationUrl,secret.value))matched=secret;}
 if(!matched)throw new FlowError('WEBHOOK_SIGNATURE_REJECTED',403);
 const event=parseVerifiedSquareWebhook(raw,signature,config.notificationUrl,matched.value);if(event.merchantId!==config.merchantId)throw new FlowError('WEBHOOK_TARGET_MISMATCH',403);return {event,keyId:matched.keyId};
}
export const sandboxActivationStops=Object.freeze(['APPLICATION_UNCONFIRMED','SECRET_STORE_UNCONFIGURED','HTTPS_RECEIVER_ABSENT','OWNER_NIGHT_REAL_REQUESTS_PROHIBITED','SQUARE_AUTH_STOP','SQUARE_QUOTA_STOP','SQUARE_BUDGET_EXHAUSTED','UNKNOWN_RECONCILE_ONLY']);
