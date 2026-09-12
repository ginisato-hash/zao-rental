import {createHash} from 'node:crypto';
import type {StaffState,StaffPrincipal} from '../../../../packages/auth/src/staff-auth';
import type {RecommendationService} from '../../../../packages/core/src/recommendation/recommendation-service';
import {HoldError} from '../../../../packages/contracts/src/hold';
import {LedgerError} from '../../../../packages/contracts/src/ledger';
import {exact,id} from '../../../../packages/contracts/src/pricing';
import {RecommendationError} from '../../../../packages/contracts/src/recommendation';
import {readJson} from './ledger-http';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
export function recommendationHandler(state:(h:Headers)=>Promise<StaffState>,service:(p:StaffPrincipal)=>RecommendationService,origin:string){return async(request:Request)=>{try{
 const s=await state(request.headers);if(s.status!=='authorized')throw new RecommendationError(s.status==='anonymous'?'UNAUTHENTICATED':'FORBIDDEN',s.status==='anonymous'?401:403);
 if(!s.principal.permissions.includes('HOLD_VIEW')||!s.principal.permissions.includes('QUOTE_VIEW'))throw new RecommendationError('FORBIDDEN',403);
 const stamp=request.headers.get('x-zao-session');if(stamp&&stamp!==createHash('sha256').update(s.stamp).digest('hex'))throw new RecommendationError('SESSION_CHANGED',409);
 const url=new URL(request.url),path=url.pathname.slice('/api/recommendations'.length);if(url.search)throw new RecommendationError('INVALID_QUERY');const svc=service(s.principal);
 if(request.method==='GET')return Response.json(path==='/options'?await svc.options():path===''?await svc.list():await svc.get(path.slice(1)),{headers});
 if(request.method!=='POST')throw new RecommendationError('METHOD_NOT_ALLOWED',405);if(request.headers.get('origin')!==origin)throw new RecommendationError('ORIGIN_REJECTED',403);
 if(path===''){const b=exact(await readJson(request),['requestKey','input','replaceHoldId']);id(b.requestKey);if(b.replaceHoldId!==null)id(b.replaceHoldId);return Response.json(await svc.preview(b.requestKey,b.input,b.replaceHoldId as string|null),{headers,status:201});}
 const m=/^\/([a-f0-9-]{36})\/(select|resume)$/.exec(path);if(!m)throw new RecommendationError('NOT_FOUND',404);
 if(m[2]==='resume'){exact(await readJson(request),[]);return Response.json(await svc.resume(m[1]!),{headers});}
 const b=exact(await readJson(request),['requestKey','selection']);id(b.requestKey);return Response.json(await svc.select(m[1]!,b.requestKey,b.selection),{headers});
 }catch(e){const err=e instanceof HoldError||e instanceof LedgerError?e:new RecommendationError('RECOMMENDATION_FAILED',500);return Response.json({error:err.code},{headers,status:err.status});}};}
