import type {StaffState,StaffPrincipal} from '../../../../packages/auth/src/staff-auth';
import {createHash} from 'node:crypto';
import type {QuoteService} from '../../../../packages/core/src/pricing/quote-service';
import {PricingError,exact,id} from '../../../../packages/contracts/src/pricing';
import {HoldError} from '../../../../packages/contracts/src/hold';
import {LedgerError} from '../../../../packages/contracts/src/ledger';
import {readJson} from './ledger-http';
import {GROUP_JSON_BYTES} from '../../../../packages/contracts/src/http-body-limits';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
export function quoteHandler(state:(h:Headers)=>Promise<StaffState>,service:(p:StaffPrincipal)=>QuoteService,origin:string){return async(request:Request)=>{try{
 const s=await state(request.headers);if(s.status!=='authorized')throw new PricingError(s.status==='anonymous'?'UNAUTHENTICATED':'FORBIDDEN',s.status==='anonymous'?401:403);
 if(!s.principal.permissions.includes('QUOTE_VIEW'))throw new PricingError('FORBIDDEN',403);const stamp=request.headers.get('x-zao-session');if(stamp&&stamp!==createHash('sha256').update(s.stamp).digest('hex'))throw new PricingError('SESSION_CHANGED',409);
 const url=new URL(request.url),path=url.pathname.slice('/api/quotes'.length);if(url.search)throw new PricingError('INVALID_QUERY');const svc=service(s.principal);
 if(request.method==='GET')return Response.json(path===''?await svc.list():path==='/catalog'?await svc.catalog():path==='/options'?await svc.options():await svc.get(path.slice(1)),{headers});
 if(request.method!=='POST')throw new PricingError('METHOD_NOT_ALLOWED',405);if(request.headers.get('origin')!==origin)throw new PricingError('ORIGIN_REJECTED',403);
 if(path==='/private-initialize')return Response.json(await svc.manage(await readJson(request)),{headers,status:201});if(path!=='')throw new PricingError('NOT_FOUND',404);
 const body=exact(await readJson(request,GROUP_JSON_BYTES),['requestKey','input']);id(body.requestKey);return Response.json(await svc.create(body.requestKey,body.input),{headers,status:201});
 }catch(e){const err=e instanceof HoldError||e instanceof LedgerError?e:new PricingError('QUOTE_OPERATION_FAILED',500);return Response.json({error:err.code},{status:err.status,headers});}};}
