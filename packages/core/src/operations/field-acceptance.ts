import {FlowError,flowId,flowObject} from '../../../contracts/src/rental-flow';
import type {OperationsContext} from './context';
export const fieldScenarios=['IPHONE_QR_SCAN','ANDROID_QR_SCAN','MANUAL_ASSET_ID_FALLBACK','DUPLICATE_SCAN','CAMERA_PERMISSION_DENIED','OFFLINE','RECONNECT','CHECKOUT','PARTIAL_RETURN','CROSS_STORE_RETURN','INSPECTION_REQUIRED','POLE_QUANTITY','WEAR_QUANTITY','LABEL_DAMAGED_MANUAL_FALLBACK'] as const;
export const deviceScenarios=['IPHONE_QR_SCAN','ANDROID_QR_SCAN','MANUAL_ASSET_ID_FALLBACK','DUPLICATE_SCAN','CAMERA_PERMISSION_DENIED','OFFLINE','RECONNECT','LABEL_DAMAGED_MANUAL_FALLBACK'] as const;
export const rehearsalScenarios=['CHECKOUT','PARTIAL_RETURN','CROSS_STORE_RETURN','INSPECTION_REQUIRED','POLE_QUANTITY','WEAR_QUANTITY'] as const;
const DEVICES=['IOS','ANDROID','DESKTOP','NOT_APPLICABLE'],RESULTS=['PASS','FAIL','NOT_RUN'];
/** A physical-device scenario cannot be satisfied from a desktop, so the scenario and the
 * device class are bound. The same matrix is enforced as a database constraint. */
export const DEVICE_MATRIX:Record<string,readonly string[]>={
 IPHONE_QR_SCAN:['IOS'],ANDROID_QR_SCAN:['ANDROID'],
 DUPLICATE_SCAN:['IOS','ANDROID'],CAMERA_PERMISSION_DENIED:['IOS','ANDROID'],OFFLINE:['IOS','ANDROID'],RECONNECT:['IOS','ANDROID'],
 MANUAL_ASSET_ID_FALLBACK:['IOS','ANDROID','DESKTOP'],LABEL_DAMAGED_MANUAL_FALLBACK:['IOS','ANDROID','DESKTOP'],
};
const allowedDevices=(scenario:string)=>DEVICE_MATRIX[scenario]??DEVICES;
const NOTES=['NONE','CAMERA_PERMISSION_DENIED','OFFLINE_QUEUED','RECONNECTED','SCAN_TIMEOUT','LABEL_UNREADABLE','MANUAL_FALLBACK_USED','DUPLICATE_SCAN_IGNORED','DEVICE_UNAVAILABLE','BLOCKED_BY_PERMISSION','SEE_OPERATIONS_EXCEPTION'];
const STORES=['MOUNTAIN_BASE','ONSEN_BASE','SYSTEM'];
export type FieldRecord={scenario:string;result:'PASS'|'FAIL'|'NOT_RUN';deviceClass:string|null;store:string|null;safeNote:string|null;recordedAt:string|null};
/** Records what staff observed while exercising the ordinary screens. It is a record, not
 * a capability: it grants nothing, writes no business row, and its note is a fixed enum so
 * no customer information can be stored. */
export class FieldAcceptance{
 constructor(private ctx:OperationsContext){}
 async record(key:string,input:unknown){
  flowId(key);const v=flowObject(input,['runId','scenario','deviceClass','store','result','safeNote']);flowId(v.runId);
  if(!fieldScenarios.includes(v.scenario as typeof fieldScenarios[number])||!DEVICES.includes(v.deviceClass as string)||!STORES.includes(v.store as string)||!RESULTS.includes(v.result as string)||!NOTES.includes(v.safeNote as string))throw new FlowError('FIELD_ACCEPTANCE_INVALID',422);
  if(!allowedDevices(v.scenario as string).includes(v.deviceClass as string))throw new FlowError('FIELD_DEVICE_CLASS_MISMATCH',422);
  const store=v.store as string;
  return this.ctx.transaction('FIELD_ACCEPTANCE',store==='SYSTEM'?[]:[store],'FIELD_ACCEPTANCE',c=>this.ctx.idempotent(c,key,v,async()=>(await c.query('SELECT field_acceptance_record($1,$2,$3,$4,$5,$6) v',[v.runId,v.scenario,v.deviceClass,store,v.result,v.safeNote])).rows[0].v));
 }
 /** Reading is store scoped. SYSTEM is the cross-store aggregate and needs explicit ALL
  * scope, which the SQL boundary re-checks against the maintained session. */
 async status(runId:string,store:string){
  flowId(runId);
  if(!STORES.includes(store))throw new FlowError('INVALID_STORE',422);
  const p=await this.ctx.authorize('OPERATIONS_VIEW',store==='SYSTEM'?[]:[store]);
  if(store==='SYSTEM'&&p.scope!=='ALL')throw new FlowError('FORBIDDEN',403);
  return this.ctx.transaction('OPERATIONS_VIEW',store==='SYSTEM'?[]:[store],'FIELD_ACCEPTANCE_STATUS',async c=>(await c.query('SELECT field_acceptance_status($1,$2) v',[runId,store])).rows[0].v as FieldRecord[]);
 }
}
/** All PASS is READY; any FAIL blocks; anything still unexercised is NOT_RUN. */
export function summariseField(records:FieldRecord[],scenarios:readonly string[]){
 const relevant=records.filter(r=>scenarios.includes(r.scenario));
 if(relevant.some(r=>r.result==='FAIL'))return 'BLOCKED' as const;
 if(relevant.length<scenarios.length||relevant.some(r=>r.result==='NOT_RUN'))return 'NOT_RUN' as const;
 return 'READY' as const;
}
