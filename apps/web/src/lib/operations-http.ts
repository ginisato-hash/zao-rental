import {createHash} from 'node:crypto';
import type {StaffState} from '../../../../packages/auth/src/staff-auth';
import {FlowError,flowId,flowObject} from '../../../../packages/contracts/src/rental-flow';
import {HoldError} from '../../../../packages/contracts/src/hold';
import {LedgerError} from '../../../../packages/contracts/src/ledger';
import {ContentInputError} from '../../../../packages/core/src/content/bulk-plan';
import {GROUP_JSON_BYTES,IMPORT_JSON_BYTES} from '../../../../packages/contracts/src/http-body-limits';
import type {OperationsContext,OpsIdentity} from '../../../../packages/core/src/operations/context';
import {AmendmentService} from '../../../../packages/core/src/operations/amendment-service';
import {FinancialOperations} from '../../../../packages/core/src/operations/financial';
import {InventoryOperations} from '../../../../packages/core/src/operations/inventory-service';
import {NotificationOperations} from '../../../../packages/core/src/notification/staff-service';
import {OperationsConsole} from '../../../../packages/core/src/operations/console-service';
import {FieldAcceptance} from '../../../../packages/core/src/operations/field-acceptance';
import {readJson} from './ledger-http';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer'};
export function operationsHandler(state:(headers:Headers)=>Promise<StaffState>,factory:((id:OpsIdentity)=>OperationsContext)|null,origin:string){return async(request:Request)=>{try{
 const s=await state(request.headers);if(s.status!=='authorized')throw new FlowError('UNAUTHENTICATED',401);const stamp=request.headers.get('x-zao-session');if(stamp&&stamp!==createHash('sha256').update(s.stamp).digest('hex'))throw new FlowError('SESSION_CHANGED',409);
 if(!factory)throw new FlowError('OPERATIONS_UNCONNECTED',503);const [sessionId]=JSON.parse(s.stamp) as [string];const ctx=factory({subject:s.principal.subject,sessionId}),amend=new AmendmentService(ctx),money=new FinancialOperations(ctx),inventory=new InventoryOperations(ctx),url=new URL(request.url),path=url.pathname.slice('/api/operations'.length);
 let result:unknown;
 if(request.method==='GET'){
  const allowed=path==='/exceptions'?['store','type','severity','ageHours','status','beforeTime','beforeId']:path==='/field-acceptance'?['runId','store']:path==='/real-data'?[]:['id','store'];
  if([...url.searchParams.keys()].some(k=>!allowed.includes(k)))throw new FlowError('INVALID_QUERY',422);
  switch(path){case '/field-acceptance':{const run=url.searchParams.get('runId')??'';flowId(run);result=await new FieldAcceptance(ctx).status(run,url.searchParams.get('store')??'');break;}case '/real-data':result=await inventory.realDataAcceptance();break;case '/exceptions':{const q=url.searchParams,age=q.get('ageHours')??'0';if(!/^\d{1,4}$/.test(age))throw new FlowError('OPS_FILTER_INVALID',422);result=await new OperationsConsole(ctx).list({store:q.get('store')??'',type:q.get('type'),severity:q.get('severity'),ageHours:Number(age),status:q.get('status')??'UNACKNOWLEDGED',beforeTime:q.get('beforeTime'),beforeId:q.get('beforeId')});break;}case '/notifications':result=await new NotificationOperations(ctx).list(url.searchParams.get('store')??'');break;case '/amendment-options':result=await amend.options();break;case '/amendment':result=await amend.view(url.searchParams.get('id')??'');break;case '/financial':result=await money.summary(url.searchParams.get('id')??'',url.searchParams.get('store')??'');break;case '/inventory':result=await inventory.workspace(url.searchParams.get('store')??'');break;case '/stocktake':result=await inventory.get(url.searchParams.get('id')??'');break;case '/import-catalog':result=await inventory.importCatalog();break;default:throw new FlowError('NOT_FOUND',404);}
 }else{
  if(request.method!=='POST')throw new FlowError('METHOD_NOT_ALLOWED',405);if(request.headers.get('origin')!==origin)throw new FlowError('ORIGIN_REJECTED',403);if(url.search)throw new FlowError('INVALID_QUERY',422);
  const body=flowObject(await readJson(request,path==='/import-stage'?IMPORT_JSON_BYTES:GROUP_JSON_BYTES),['requestKey','input']);flowId(body.requestKey);
  switch(path){case '/field-acceptance':result=await new FieldAcceptance(ctx).record(body.requestKey,body.input);break;case '/real-data-accept':result=await inventory.acceptRealData(body.requestKey,body.input);break;case '/exception-acknowledge':result=await new OperationsConsole(ctx).acknowledge(body.requestKey,body.input);break;case '/notification-resend':result=await new NotificationOperations(ctx).resend(body.requestKey,body.input);break;case '/amendment-quote':result=await amend.quote(body.requestKey,body.input);break;case '/amendment-accept':result=await amend.accept(body.requestKey,body.input);break;case '/refund':result=await money.requestRefund(body.requestKey,body.input);break;case '/stocktake-create':{const v=flowObject(body.input,['store']);if(typeof v.store!=='string')throw new FlowError('INVALID_STORE',422);result=await inventory.create(body.requestKey,v.store);break;}case '/stocktake-observe':result=await inventory.observe(body.requestKey,body.input);break;case '/stocktake-reconcile':result=await inventory.reconcile(body.requestKey,body.input);break;case '/import-stage':result=await inventory.stageImport(body.requestKey,body.input);break;case '/import-commit':result=await inventory.commitImport(body.requestKey,body.input);break;default:throw new FlowError('NOT_FOUND',404);}
 }
 return Response.json(result,{headers});
 }catch(e){const error=e instanceof FlowError||e instanceof HoldError||e instanceof LedgerError?e:e instanceof ContentInputError?new FlowError(e.code,422):new FlowError('OPERATIONS_FAILED',500);return Response.json({error:error.code},{status:error.status,headers});}};}
