import {createHash} from 'node:crypto';
import type {StaffState} from '../../../../packages/auth/src/staff-auth';
import {HoldError} from '../../../../packages/contracts/src/hold';
import {isContractError} from '../../../../packages/contracts/src/contract-error';
import {GROUP_STATUSES,GroupError,type Adjustment,type GroupMemberInput,type GroupStatus} from '../../../../packages/contracts/src/group-order';
import type {GroupOrderService,StaffActor} from '../../../../packages/core/src/group/group-service';
import {readJson} from './ledger-http';

/** Staff API for group orders (/api/staff/groups/...). Every route is ADMIN only; the session stamp, the same-origin check and the
 * per-request idempotency key are enforced here, and the service re-authorizes (ADMIN + GROUP_* permission + store scope + revision)
 * inside every transaction, so a revoked permission or a changed store is refused even if this layer let the request through.
 * The browser never supplies the actor. Group orders have no payment, so nothing here creates a charge, a provider call or a booking. */
const privateHeaders={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer'};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const STORES=['MOUNTAIN_BASE','ONSEN_BASE'];
const bad=(code='INVALID_INPUT',status=422):never=>{throw new GroupError(code,status);};
const uuid=(v:unknown):string=>typeof v==='string'&&UUID.test(v)?v:bad('INVALID_ID');
const only=(v:unknown,required:string[],optional:string[]=[]):Record<string,unknown>=>{
 if(!v||typeof v!=='object'||Array.isArray(v))return bad();
 const keys=Object.keys(v);if(keys.some(k=>!required.includes(k)&&!optional.includes(k))||required.some(k=>!(k in (v as object))))return bad();
 return v as Record<string,unknown>;
};
const text=(v:unknown,max:number):string=>typeof v==='string'&&v.length<=max?v:bad();
const optText=(v:unknown,max:number):string|null=>v===undefined||v===null?null:text(v,max);
const revision=(v:unknown):number=>Number.isSafeInteger(v)&&Number(v)>0?Number(v):bad();
const adjustments=(v:unknown):Adjustment[]=>{
 if(!Array.isArray(v)||v.length>101)return bad('ADJUSTMENT_INVALID');
 return v.map(raw=>{const a=only(raw,['target','method','value','reason'],['memberId']);
  return {target:a.target as Adjustment['target'],method:a.method as Adjustment['method'],value:a.value as number,reason:a.reason as string,...(a.memberId===undefined?{}:{memberId:uuid(a.memberId)})};});
};

export type StaffGroupFacade=(subject:string)=>GroupOrderService|null;
export function staffGroupHandler(state:(h:Headers)=>Promise<StaffState>,service:StaffGroupFacade,origin:string){return async(req:Request)=>{try{
 const s=await state(req.headers);if(s.status!=='authorized')throw new GroupError(s.status==='anonymous'?'UNAUTHENTICATED':'FORBIDDEN',s.status==='anonymous'?401:403);
 // ADMIN only. This early gate is a convenience; the service decides again from the database inside each transaction.
 if(s.principal.role!=='ADMIN')throw new GroupError('FORBIDDEN',403);
 const stamp=req.headers.get('x-zao-session'),want=createHash('sha256').update(s.stamp).digest('hex');
 if(req.method!=='GET'&&stamp!==want)throw new GroupError('SESSION_CHANGED',409);
 if(stamp&&stamp!==want)throw new GroupError('SESSION_CHANGED',409);
 const svc=service(s.principal.subject);if(!svc)throw new GroupError('GROUP_NOT_CONNECTED',503);
 const actor:StaffActor={kind:'STAFF',subject:s.principal.subject,revision:s.principal.revision};
 const url=new URL(req.url),path=url.pathname.slice('/api/staff/groups'.length).split('/').filter(Boolean);
 if(req.method==='GET'){
  if(path.length===0){
   for(const k of url.searchParams.keys())if(!['status','store','number'].includes(k))bad('INVALID_QUERY');
   const st=url.searchParams.get('status'),store=url.searchParams.get('store'),number=url.searchParams.get('number');
   const status=st?st.split(',').map(x=>GROUP_STATUSES.includes(x as GroupStatus)?x as GroupStatus:bad('INVALID_QUERY')):undefined;
   if(store&&!STORES.includes(store))bad('INVALID_QUERY');if(number&&!/^G-\d{6}$/.test(number))bad('INVALID_QUERY');
   const rows=await svc.list(actor,{...(status?{status}:{}),...(store?{store}:{})});
   return Response.json({groups:number?rows.filter(r=>r.groupNumber===number):rows},{headers:privateHeaders});
  }
  if(url.search)bad('INVALID_QUERY');
  if(path.length===1&&path[0]==='entrance')return Response.json(await svc.entranceStatus(actor),{headers:privateHeaders});
  if(path.length===1)return Response.json(await svc.staffDetail(actor,uuid(path[0])),{headers:privateHeaders});
  if(path.length===2&&path[1]==='variants')return Response.json({variants:await svc.variantOptions(actor,uuid(path[0]))},{headers:privateHeaders});
  throw new GroupError('NOT_FOUND',404);
 }
 if(req.method!=='POST')throw new GroupError('METHOD_NOT_ALLOWED',405);
 if(req.headers.get('origin')!==origin)throw new GroupError('ORIGIN_REJECTED',403);
 if(url.search)bad('INVALID_QUERY');
 const v=await readJson(req);let result:unknown;
 if(path.length===2&&path[0]==='entrance'){
  const b=only(v,['reason']);const reason=text(b.reason,200);
  if(path[1]==='rotate')result=await svc.rotateEntrance(actor,reason);
  else if(path[1]==='enable')result=await svc.setEntranceEnabled(actor,true,reason);
  else if(path[1]==='disable')result=await svc.setEntranceEnabled(actor,false,reason);
  else throw new GroupError('NOT_FOUND',404);
  return Response.json(result,{headers:privateHeaders});
 }
 if(path.length!==2)throw new GroupError('NOT_FOUND',404);
 const id=uuid(path[0]);
 switch(path[1]){
  case 'release':case 'cancel':{const b=only(v,['requestKey','expectedRevision','reason'],['message']);
   const input={requestKey:uuid(b.requestKey),expectedRevision:revision(b.expectedRevision),reason:text(b.reason,300),message:optText(b.message,2000)};
   result=path[1]==='release'?await svc.release(actor,id,input):await svc.cancelConfirmed(actor,id,input);break;}
  case 'confirm':{const b=only(v,['requestKey','expectedRevision'],['message','noChargeConfirmed','fitAcknowledgedMemberIds']);
   if(b.noChargeConfirmed!==undefined&&typeof b.noChargeConfirmed!=='boolean')bad();
   const fit=b.fitAcknowledgedMemberIds===undefined?[]:Array.isArray(b.fitAcknowledgedMemberIds)&&b.fitAcknowledgedMemberIds.length<=100?b.fitAcknowledgedMemberIds.map(uuid):bad();
   result=await svc.confirm(actor,id,{requestKey:uuid(b.requestKey),expectedRevision:revision(b.expectedRevision),message:optText(b.message,2000),noChargeConfirmed:b.noChargeConfirmed===true,fitAcknowledgedMemberIds:fit});break;}
  case 'request-changes':{const b=only(v,['requestKey','expectedRevision','message']);
   result=await svc.requestChanges(actor,id,{requestKey:uuid(b.requestKey),expectedRevision:revision(b.expectedRevision),message:text(b.message,2000)});break;}
  case 'adjustments':{const b=only(v,['expectedRevision','adjustments']);result=await svc.setAdjustments(actor,id,revision(b.expectedRevision),adjustments(b.adjustments));break;}
  case 'preview-adjustments':{const b=only(v,['adjustments']);result=await svc.previewAdjustments(actor,id,adjustments(b.adjustments));break;}
  case 'members':{
   // The browser sends only the changed sizes/variants (small, and it never rewrites body measurements it did not touch).
   // The server merges them into the stored member rows; the revision check (here and in the transaction) refuses stale edits.
   const b=only(v,['requestKey','expectedRevision','changeRequestId','edits']);
   if(!Array.isArray(b.edits)||b.edits.length<1||b.edits.length>100)bad();
   const edits=new Map<string,{family:string;variantIds:string[]}[]>();
   for(const raw of b.edits as unknown[]){const e=only(raw,['memberId','items']);const mid=uuid(e.memberId);const its=e.items;if(edits.has(mid)||!Array.isArray(its)||its.length<1||its.length>8)bad();
    edits.set(mid,(its as unknown[]).map(it=>{const i=only(it,['family','variantIds']),vids=i.variantIds;if(typeof i.family!=='string'||!Array.isArray(vids)||vids.length<1||vids.length>4)return bad();return {family:i.family,variantIds:(vids as unknown[]).map(uuid)};}));}
   const expected=revision(b.expectedRevision),cr=b.changeRequestId===null?null:uuid(b.changeRequestId);
   const cur=await svc.staffDetail(actor,id);if(cur.group.revision!==expected)throw new GroupError('STALE_REVISION',409,{current:cur.group.revision});
   const known=new Set(cur.members.map(m=>m.id));for(const k of edits.keys())if(!known.has(k))bad('NOT_FOUND',404);
   const members:GroupMemberInput[]=cur.members.map(m=>{
    const e=edits.get(m.id);if(!e)return {memberId:m.id,label:m.label,profile:(m.profile??{}) as Record<string,unknown>,selection:m.selection,fit:m.fit};
    const items=m.selection.items.map(it=>{const x=e.find(y=>y.family===it.family);return x?{...it,variantIds:x.variantIds}:it;});
    // A manual-fit flag keeps gating the confirmation (the administrator acknowledges it there); any other flag is superseded by the administrator's choice.
    const fit0=m.fit??{},manual=(fit0 as {status?:string;kind?:string}).status==='MANUAL_FIT_REQUIRED'||(fit0 as {kind?:string}).kind==='MANUAL_FIT_REQUIRED';
    return {memberId:m.id,label:m.label,profile:(m.profile??{}) as Record<string,unknown>,selection:{...m.selection,items},fit:manual?{...fit0,adminChanged:true}:{status:'ADMIN_SELECTED',previous:fit0}};});
   result=await svc.applyChange(actor,id,{requestKey:uuid(b.requestKey),expectedRevision:expected,changeRequestId:cr,members});break;}
  case 'receipt':{const b=only(v,['requestKey','amountJpy','method','receivedAt'],['note']);
   if(!Number.isSafeInteger(b.amountJpy))bad();const at=text(b.receivedAt,40);if(!Number.isFinite(Date.parse(at)))bad();
   result=await svc.recordReceipt(actor,id,{requestKey:uuid(b.requestKey),amountJpy:b.amountJpy as number,method:b.method as 'CASH',receivedAt:new Date(at).toISOString(),note:optText(b.note,300)??''});break;}
  case 'reverse-receipt':{const b=only(v,['requestKey','paymentId','reason']);
   result=await svc.reverseReceipt(actor,id,{requestKey:uuid(b.requestKey),paymentId:uuid(b.paymentId),reason:text(b.reason,300)});break;}
  default:throw new GroupError('NOT_FOUND',404);
 }
 return Response.json(result,{headers:privateHeaders});
}catch(e){
 const err=e instanceof GroupError||(e instanceof Error&&e.name==='GroupError')?e as GroupError:e instanceof HoldError||isContractError(e)?e as HoldError:new GroupError('GROUP_OPERATION_FAILED',500);
 const detail=err instanceof GroupError&&err.status<500?err.detail:undefined;
 return Response.json({error:err.code,...(detail!==undefined?{detail}:{})},{status:err.status,headers:privateHeaders});}};}
