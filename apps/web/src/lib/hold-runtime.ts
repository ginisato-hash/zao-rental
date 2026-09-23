import 'server-only';
import {getRuntime,staffState,publicStamp} from './staff-runtime';
import {GROUP_JSON_BYTES,DEFAULT_JSON_BYTES} from '../../../../packages/contracts/src/http-body-limits';
import {readJson} from './ledger-http';
import {LedgerError} from '../../../../packages/contracts/src/ledger';
import {HoldError} from '../../../../packages/contracts/src/hold';
import {HoldService} from '../../../../packages/core/src/inventory/hold-service';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
export async function handleHold(request:Request){
 try{
  const runtime=getRuntime(),state=await staffState(request.headers);
  if(state.status!=='authorized')throw new HoldError(state.status==='anonymous'?'UNAUTHENTICATED':'FORBIDDEN',state.status==='anonymous'?401:403);
  const url=new URL(request.url),path=url.pathname.slice('/api/holds'.length),post=request.method==='POST';
  const preview=/^\/([a-f0-9-]{36})\/availability$/.exec(path),isPreview=path==='/capacity'||path==='/availability'||Boolean(preview);
  if(url.search)throw new HoldError('INVALID_QUERY');
  if(!state.principal.permissions.includes('HOLD_VIEW')||(post&&!isPreview&&!state.principal.permissions.includes('HOLD_EDIT')))throw new HoldError('FORBIDDEN',403);
  const stamp=request.headers.get('x-zao-session');if(stamp&&stamp!==publicStamp(state.stamp))throw new HoldError('SESSION_CHANGED',409);
  if(post&&request.headers.get('origin')!==runtime?.config.origin)throw new HoldError('ORIGIN_REJECTED',403);
  if(!runtime)throw new HoldError('STORAGE_NOT_CONNECTED',503);
  const service=new HoldService(runtime.holdPool,state.principal);
  if(request.method==='GET')return Response.json(path==='/options'?await service.options():path===''?await service.list():await service.get(path.slice(1)),{headers});
  if(!post)throw new HoldError('METHOD_NOT_ALLOWED',405);
  const groupBody=isPreview||path===''||/^\/[a-f0-9-]{36}\/amend$/.test(path);
  const body=await readJson(request,groupBody?GROUP_JSON_BYTES:DEFAULT_JSON_BYTES);
  if(path==='/capacity')return Response.json(await service.managementCapacity(body),{headers});
  if(isPreview){
   const envelope=body&&typeof body==='object'&&'bufferOverride' in body?body as Record<string,unknown>:null;
   if(envelope&&(Object.keys(envelope).sort().join()!=='bufferOverride,conditions'||typeof envelope.bufferOverride!=='boolean'))throw new HoldError('INVALID_INPUT');
   if(envelope&&!state.principal.permissions.includes('INVENTORY_BUFFER_OVERRIDE'))throw new HoldError('FORBIDDEN',403);
   return Response.json(await service.availability(envelope?envelope.conditions:body,preview?.[1],undefined,envelope?envelope.bufferOverride as boolean:undefined),{headers});
  }
  if(!body||typeof body!=='object'||Array.isArray(body))throw new HoldError('INVALID_INPUT');
  const b=body as Record<string,unknown>;
  const match=/^\/([a-f0-9-]{36})\/(amend|cancel|expire|reassign)$/.exec(path);
  if(path!==''&&!match)throw new HoldError('NOT_FOUND',404);
  const op=match?match[2] as 'amend'|'cancel'|'expire'|'reassign':'create';
  const keys=op==='create'||op==='amend'?['requestKey','conditions',...(op==='amend'&&'expectedVersion' in b?['expectedVersion']:[])]:op==='reassign'?['requestKey','requirementKey','assetId']:['requestKey'];
  let bufferOverride:{reason:string;useReserve?:boolean}|undefined;
  if('bufferOverride' in b){
   if(!['create','amend','reassign'].includes(op)||!state.principal.permissions.includes('INVENTORY_BUFFER_OVERRIDE'))throw new HoldError('FORBIDDEN',403);
   const value=b.bufferOverride;if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['reason','useReserve'].includes(k))||typeof (value as {reason?:unknown}).reason!=='string')throw new HoldError('INVALID_INPUT');
   bufferOverride=value as {reason:string;useReserve?:boolean};keys.push('bufferOverride');
  }
  if(Object.keys(b).length!==keys.length||Object.keys(b).some(k=>!keys.includes(k))||typeof b.requestKey!=='string')throw new HoldError('INVALID_INPUT');
  const result=await service.command(op,b.requestKey,op==='reassign'?{requirementKey:b.requirementKey,assetId:b.assetId}:b.conditions,match?.[1],op==='amend'&&'expectedVersion' in b?b.expectedVersion as number:undefined,bufferOverride);return Response.json(result,{headers,status:result.result==='CREATED'?201:200});
 }catch(e){const error=e instanceof HoldError||e instanceof LedgerError?e:new HoldError('HOLD_OPERATION_FAILED',500);return Response.json({error:error.code},{status:error.status,headers});}
}
