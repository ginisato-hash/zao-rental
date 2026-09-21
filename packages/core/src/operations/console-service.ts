import {FlowError,flowId,flowObject} from '../../../contracts/src/rental-flow';
import {exceptionCodes,exceptionReasons,exceptionStores,type ExceptionCode,type SafeException} from '../../../contracts/src/production-operations';
import type {OperationsContext} from './context';
const PAGE=50;
/** Read/acknowledge boundary for the operations console. Every result is the safe
 * projection built in SQL; this class never reads a provider payload or business row
 * directly, and acknowledgement never writes a business table. */
export class OperationsConsole{
 constructor(private ctx:OperationsContext){}
 // Store scope is re-checked in SQL under the maintained session; this only rejects
 // malformed input early and keeps SYSTEM restricted to explicit ALL scope.
 private async scope(store:unknown){
  if(typeof store!=='string'||!exceptionStores.includes(store as typeof exceptionStores[number]))throw new FlowError('INVALID_STORE',422);
  const p=await this.ctx.authorize('OPERATIONS_VIEW',store==='SYSTEM'?[]:[store]);
  if(store==='SYSTEM'&&p.scope!=='ALL')throw new FlowError('FORBIDDEN',403);
  return store;
 }
 async list(input:unknown){
  const v=flowObject(input,['store','type','severity','ageHours','status','beforeTime','beforeId']),store=await this.scope(v.store);
  if((v.type!==null&&!exceptionCodes.includes(v.type as ExceptionCode))||(v.severity!==null&&!['INFO','WARN','ERROR'].includes(v.severity as string))||!Number.isInteger(v.ageHours)||Number(v.ageHours)<0||Number(v.ageHours)>8760||!['ALL','UNACKNOWLEDGED','ACKNOWLEDGED'].includes(v.status as string)||(v.beforeTime===null)!==(v.beforeId===null))throw new FlowError('OPS_FILTER_INVALID',422);
  if(v.beforeTime!==null){flowId(v.beforeId);if(typeof v.beforeTime!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v.beforeTime)||!Number.isFinite(Date.parse(v.beforeTime)))throw new FlowError('OPS_FILTER_INVALID',422);}
  return this.ctx.transaction('OPERATIONS_VIEW',store==='SYSTEM'?[]:[store],'OPS_OBSERVE',async c=>{
   await c.query('SELECT ops_collect_exceptions($1)',[store]);
   const rows=(await c.query('SELECT ops_list_exceptions($1,$2,$3,$4,$5,$6,$7) v',[store,v.type,v.severity,v.ageHours,v.status,v.beforeTime,v.beforeId])).rows[0].v as SafeException[];
   const visible=rows.slice(0,PAGE),last=visible.at(-1);
   return {exceptions:visible,next:rows.length>PAGE&&last?{beforeTime:last.occurredAt,beforeId:last.id}:null};
  });
 }
 async acknowledge(key:string,input:unknown){
  flowId(key);const v=flowObject(input,['id','store','reason']);flowId(v.id);const store=await this.scope(v.store);
  if(!exceptionReasons.includes(v.reason as typeof exceptionReasons[number]))throw new FlowError('OPS_REASON_REQUIRED',422);
  return this.ctx.transaction('OPERATIONS_ACKNOWLEDGE',store==='SYSTEM'?[]:[store],v.reason as string,c=>this.ctx.idempotent(c,key,v,async()=>(await c.query('SELECT ops_acknowledge_exception($1,$2,$3) v',[v.id,store,v.reason])).rows[0].v));
 }
}
