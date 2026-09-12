import {createHash} from 'node:crypto';
import type {StaffState} from '../../../../packages/auth/src/staff-auth';
import type {WearService} from '../../../../packages/core/src/wear/service';
import {WearError} from '../../../../packages/core/src/wear/service';
import {HoldError} from '../../../../packages/contracts/src/hold';
import {LedgerError} from '../../../../packages/contracts/src/ledger';
import {exact,id} from '../../../../packages/contracts/src/pricing';
import {readJson} from './ledger-http';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer'};
export function wearHandler(state:(h:Headers)=>Promise<StaffState>,factory:((identity:{subject:string;sessionId:string})=>WearService)|null,origin:string){return async(request:Request)=>{try{
 const s=await state(request.headers);if(s.status!=='authorized')throw new WearError('UNAUTHENTICATED',401);const stamp=request.headers.get('x-zao-session');if(stamp&&stamp!==createHash('sha256').update(s.stamp).digest('hex'))throw new WearError('SESSION_CHANGED',409);if(!factory)throw new WearError('WEAR_DEVELOPMENT_CONNECTION_NOT_CONFIGURED',503);
 const [sessionId]=JSON.parse(s.stamp) as [string,unknown],service=factory({subject:s.principal.subject,sessionId}),url=new URL(request.url),path=url.pathname.slice('/api/wear'.length);
 if(request.method==='GET'){if([...url.searchParams.keys()].some(k=>!['store','bookingId'].includes(k)))throw new WearError('INVALID_QUERY');const store=url.searchParams.get('store')??'';let result:unknown;if(path==='/pools')result=await service.overview(store);else if(path==='/loans')result=await service.loans(url.searchParams.get('bookingId')??'',store);else if(path==='/transfers')result=await service.transfers(store);else if(path==='/receipts')result=await service.receipts(url.searchParams.get('bookingId')??'',store);else throw new WearError('NOT_FOUND',404);return Response.json(result,{headers});}
 if(request.method!=='POST')throw new WearError('METHOD_NOT_ALLOWED',405);if(request.headers.get('origin')!==origin)throw new WearError('ORIGIN_REJECTED',403);if(url.search)throw new WearError('INVALID_QUERY');const body=exact(await readJson(request),['requestKey','input']);id(body.requestKey);let result:unknown;
 switch(path){case '/transfer-plan':result=await service.planTransfer(body.requestKey,body.input);break;case '/transfer':result=await service.transfer(body.requestKey,body.input);break;case '/transfer-ready':result=await service.transferReady(body.requestKey,body.input);break;case '/register':result=await service.register(body.requestKey,body.input);break;case '/adjust':result=await service.adjust(body.requestKey,body.input);break;case '/checkout':result=await service.checkout(body.requestKey,body.input);break;case '/receive':result=await service.receive(body.requestKey,body.input);break;case '/unresolved':result=await service.unresolved(body.requestKey,body.input);break;case '/cleaning':result=await service.cleaning(body.requestKey,body.input);break;default:throw new WearError('NOT_FOUND',404);}
 return Response.json(result,{headers});
 }catch(e){const known=e instanceof HoldError||e instanceof LedgerError?e:new WearError('WEAR_OPERATION_FAILED',500);return Response.json({error:known.code},{status:known.status,headers});}};}
