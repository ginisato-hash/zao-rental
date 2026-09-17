// Test fixture only. No mail/SMS/network implementation and no body/file logging.
import type {BookingNotificationDelivery,NotificationMessage,DeliveryResult} from '../../packages/core/src/notification/contracts';
export type LoopbackScenario='SUCCESS'|'DEFINITE_BEFORE_ACCEPT'|'TIMEOUT_BEFORE_ACCEPT'|'TIMEOUT_AFTER_ACCEPT'|'RATE_LIMIT'|'SERVER_FAILURE'|'PERMANENT_REJECT';
export class LoopbackDeliveryAdapter implements BookingNotificationDelivery{
 calls=0;lookupCalls=0;readonly accepted=new Map<string,NotificationMessage>();
 constructor(public scenario:LoopbackScenario='SUCCESS'){}
 async send(message:NotificationMessage):Promise<DeliveryResult>{this.calls++;const prior=this.accepted.get(message.idempotencyKey);if(prior)return {state:'ACCEPTED',providerMessageId:'loopback_'+this.calls};
  if(this.scenario==='TIMEOUT_BEFORE_ACCEPT')throw Error('SYNTHETIC_TIMEOUT_NO_RECEIPT');
  if(this.scenario==='DEFINITE_BEFORE_ACCEPT')return {state:'NOT_ACCEPTED',code:'PROVIDER_UNAVAILABLE'};
  if(this.scenario==='RATE_LIMIT')return {state:'NOT_ACCEPTED',code:'RATE_LIMITED'};
  if(this.scenario==='SERVER_FAILURE')return {state:'NOT_ACCEPTED',code:'PROVIDER_UNAVAILABLE'};
  if(this.scenario==='PERMANENT_REJECT')return {state:'REJECTED',code:'PERMANENT_REJECT'};
  this.accepted.set(message.idempotencyKey,structuredClone(message));if(this.scenario==='TIMEOUT_AFTER_ACCEPT')throw Error('SYNTHETIC_RESPONSE_LOST');return {state:'ACCEPTED',providerMessageId:'loopback_'+this.calls};
 }
 async lookup(key:string):Promise<DeliveryResult>{this.lookupCalls++;return this.accepted.has(key)?{state:'ACCEPTED',providerMessageId:'loopback_lookup'}:{state:'UNKNOWN'};}
}
