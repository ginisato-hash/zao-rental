import {FlowError,flowId,flowObject} from '../../../contracts/src/rental-flow';
import type {OperationsContext} from '../operations/context';
export class NotificationOperations{
 constructor(private ctx:OperationsContext){}
 async list(store:string){if(typeof store!=='string'||!['MOUNTAIN_BASE','ONSEN_BASE'].includes(store))throw new FlowError('INVALID_STORE',422);return this.ctx.transaction('BOOKING_VIEW',[store],'NOTIFICATION_STATUS',async c=>({deliveries:(await c.query('SELECT notification_status($1) v',[store])).rows[0].v,deliveryConnection:'UNCONNECTED'}));}
 async resend(key:string,input:unknown){flowId(key);const v=flowObject(input,['deliveryId','store','reason']);flowId(v.deliveryId);if(typeof v.store!=='string'||!['MOUNTAIN_BASE','ONSEN_BASE'].includes(v.store)||!['CUSTOMER_REQUEST','DELIVERY_RECOVERY'].includes(v.reason as string))throw new FlowError('INVALID_NOTIFICATION_REQUEST',422);
  return this.ctx.transaction('NOTIFICATION_RESEND',[v.store],v.reason as string,async c=>this.ctx.idempotent(c,key,v,async()=>({id:(await c.query('SELECT notification_resend($1,$2,$3,$4) id',[v.deliveryId,key,v.store,v.reason])).rows[0].id,status:'PENDING',sent:false})));
 }
}
