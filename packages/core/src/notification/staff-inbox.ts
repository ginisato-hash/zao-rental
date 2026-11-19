import {FlowError,flowId} from '../../../contracts/src/rental-flow';
import type {OperationsContext} from '../operations/context';

const STORES=['MOUNTAIN_BASE','ONSEN_BASE'] as const;
export type StaffInboxItem={id:string;bookingId:string;kind:'BOOKING_CONFIRMED'|'PAYMENT_REVIEW';source:'LIVE'|'HISTORY_IMPORT';store:string;returnStore:string;createdAt:string;
 acknowledgedAt:string|null;acknowledgedBy:string|null;state:string;startDate:string;endDate:string;slot:string;people:number;customer:string|null;totalJpy:number|null};
export type StaffInboxPage={unacknowledged:number;attention:number;total:number;latest:string|null;items:StaffInboxItem[];next:{before:string;beforeId:string}|null};

/** Staff new-booking inbox (Issue #47 §6). Store scope is enforced twice: here against the principal and again in SQL. */
export class StaffInbox{
 constructor(private ctx:OperationsContext){}
 private stores(value:unknown):string[]{
  const list=Array.isArray(value)?value:[value];
  if(!list.length||list.length>STORES.length||list.some(s=>typeof s!=='string'||!(STORES as readonly string[]).includes(s))||new Set(list).size!==list.length)throw new FlowError('INVALID_STORE',422);
  return list as string[];
 }
 async list(input:{stores:unknown;openOnly?:unknown;before?:unknown;beforeId?:unknown;limit?:unknown}):Promise<StaffInboxPage>{
  const stores=this.stores(input.stores),openOnly=input.openOnly===true||input.openOnly==='1'||input.openOnly==='true';
  const limit=input.limit===undefined?20:Number(input.limit);if(!Number.isInteger(limit)||limit<1||limit>50)throw new FlowError('INVALID_INPUT',422);
  let before:string|null=null,beforeId:string|null=null;
  if(input.before!==undefined&&input.before!==null&&input.before!==''){if(typeof input.before!=='string'||!Number.isFinite(Date.parse(input.before))||typeof input.beforeId!=='string')throw new FlowError('INVALID_INPUT',422);flowId(input.beforeId);before=input.before;beforeId=input.beforeId;}
  const v=await this.ctx.light('BOOKING_VIEW',stores,async c=>(await c.query('SELECT staff_inbox_list($1::text[],$2,$3,$4,$5) v',[stores,openOnly,before,beforeId,limit])).rows[0].v) as Omit<StaffInboxPage,'next'>;
  const last=v.items.length===limit?v.items[v.items.length-1]:undefined;
  return {...v,unacknowledged:Number(v.unacknowledged),attention:Number(v.attention),total:Number(v.total),next:last?{before:last.createdAt,beforeId:last.id}:null};
 }
 async acknowledge(eventId:unknown){
  if(typeof eventId!=='string')throw new FlowError('INVALID_INPUT',422);flowId(eventId);
  // The station comes from the event row (pickup or return), checked in SQL; the client does not choose it.
  return this.ctx.light('BOOKING_VIEW',[],async c=>(await c.query('SELECT staff_inbox_ack($1) v',[eventId])).rows[0].v as {id:string;acknowledgedAt:string;acknowledgedBy:string|null});
 }
 /** Own email preference only. enabled=null reads it. */
 async preference(enabled:unknown,locale:unknown){
  if(enabled!==null&&typeof enabled!=='boolean')throw new FlowError('INVALID_INPUT',422);
  if(enabled!==null&&locale!=='ja'&&locale!=='en')throw new FlowError('INVALID_INPUT',422);
  return this.ctx.light('BOOKING_VIEW',[],async c=>(await c.query('SELECT staff_notification_preference($1,$2) v',[enabled,enabled===null?null:locale])).rows[0].v as {emailEnabled:boolean;locale:'ja'|'en';email:string});
 }
}
