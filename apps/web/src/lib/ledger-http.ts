import {LedgerError,ledgerAccess,parseResource,type LedgerPrincipal,type LedgerFilters} from '../../../../packages/contracts/src/ledger';
import type {LedgerService} from '../../../../packages/core/src/catalog/ledger-service';
type Service=Pick<LedgerService,'list'|'get'|'create'|'update'>;
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
async function readJson(request:Request):Promise<unknown> {
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new LedgerError('JSON_REQUIRED',415);
  const reader=request.body?.getReader();if(!reader)throw new LedgerError('INVALID_INPUT',422);
  const chunks:Uint8Array[]=[];let length=0;
  try {
    for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>16384){await reader.cancel();throw new LedgerError('BODY_TOO_LARGE',413);}chunks.push(value);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}catch{throw new LedgerError('INVALID_JSON',422);}
  }finally{reader.releaseLock();}
}
export function ledgerHandler(resolvePrincipal:()=>Promise<LedgerPrincipal|null>,serviceFor:(principal:LedgerPrincipal)=>Service|Promise<Service>) {
  return async(request:Request):Promise<Response>=>{
    try {
      const write=request.method==='POST'||request.method==='PATCH';const principal=await resolvePrincipal();ledgerAccess(principal,write);
      const url=new URL(request.url);const match=/^\/api\/ledger\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
      if(!match)throw new LedgerError('NOT_FOUND',404);const resource=parseResource(match[1]!);const id=match[2];
      if(!['GET','POST','PATCH'].includes(request.method))throw new LedgerError('METHOD_NOT_ALLOWED',405);
      if(write && request.headers.get('origin')!==url.origin)throw new LedgerError('ORIGIN_REJECTED',403);
      if((request.method==='POST'&&id)||(request.method==='PATCH'&&!id))throw new LedgerError('METHOD_NOT_ALLOWED',405);
      const body=write?await readJson(request):undefined;
      const service=await serviceFor(principal!);
      if(request.method==='POST')return Response.json(await service.create(resource,body),{status:201,headers});
      if(request.method==='PATCH')return Response.json(await service.update(resource,id!,body),{headers});
      if(id){if(url.search)throw new LedgerError('INVALID_FILTER',422);return Response.json(await service.get(resource,id),{headers});}
      const filters:Record<string,unknown>={};for(const [key,value] of url.searchParams){if(key in filters)throw new LedgerError('INVALID_FILTER',422);filters[key]=key==='offset'&&/^\d+$/.test(value)?Number(value):value;}
      return Response.json(await service.list(resource,filters as LedgerFilters),{headers});
    }catch(error){const known=error instanceof LedgerError?error:new LedgerError('LEDGER_OPERATION_FAILED',500);return Response.json({error:known.code},{status:known.status,headers});}
  };
}
