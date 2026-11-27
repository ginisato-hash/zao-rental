import type {GroupCustomerService} from '../../../../packages/core/src/group/group-customer';
import {deriveOwnerSecret,groupPeriod} from '../../../../packages/core/src/group/group-customer';
import type {OwnerActor} from '../../../../packages/core/src/group/group-service';
import {GroupError} from '../../../../packages/contracts/src/group-order';
import {currentRentalTerms} from '../../../../packages/core/src/content/rental-terms';
import {HoldError} from '../../../../packages/contracts/src/hold';

/** Customer group application HTTP boundary. Capabilities, never accounts:
 *  - the shared ENTRANCE (a permanent 256-bit token, header `x-group-entrance`) only lets a caller read the catalog/CSV templates and start a NEW application;
 *  - the OWNER secret of ONE application lives in an HttpOnly, SameSite=Strict cookie scoped to that group's API path. It is the only authority over that group.
 * GET never writes. POST needs the exact configured Origin (and not a cross-site fetch), JSON, a bounded body, and passes the shared rate guard.
 * Nothing here logs request data (rows are body measurements of identifiable people). */
export type GroupBoundary={customer:GroupCustomerService;origin:string;serverKey:string;guard:(request:Request)=>Promise<void>};
const BODY_LIMIT=96*1024;
export const privateHeaders={'Cache-Control':'private, no-store','Vary':'Cookie','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const cookieName=(id:string)=>'zao_grp_'+id.replace(/-/g,'');
export const groupCookie=(id:string,secret:string,secure:boolean,remove=false)=>`${cookieName(id)}=${remove?'':secret}; Path=/api/group/g/${id}; HttpOnly; SameSite=Strict; Max-Age=${remove?0:60*60*24*30}${secure?'; Secure':''}`;
function ownerSecret(headers:Headers,id:string){
 const want=cookieName(id),hits=(headers.get('cookie')??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(want+'='));
 if(hits.length!==1)return undefined;const v=hits[0]!.slice(want.length+1);return /^[A-Za-z0-9_-]{43,128}$/.test(v)?v:undefined;
}
async function readBody(request:Request):Promise<Record<string,unknown>>{
 if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new GroupError('JSON_REQUIRED',415);
 const reader=request.body?.getReader();if(!reader)throw new GroupError('INVALID_INPUT',422);
 const chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>BODY_LIMIT){await reader.cancel();throw new GroupError('BODY_TOO_LARGE',413);}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let o=0;for(const c of chunks){bytes.set(c,o);o+=c.length;}
 let v:unknown;try{v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new GroupError('INVALID_JSON',422);}
 if(!v||typeof v!=='object'||Array.isArray(v))throw new GroupError('INVALID_INPUT',422);return v as Record<string,unknown>;
}
function exact(v:Record<string,unknown>,required:string[],optional:string[]=[]){
 const keys=Object.keys(v);if(keys.some(k=>!required.includes(k)&&!optional.includes(k))||required.some(k=>!(k in v)))throw new GroupError('INVALID_INPUT',422);return v;
}
const uuidOf=(v:unknown)=>{if(typeof v!=='string'||!UUID.test(v))throw new GroupError('INVALID_ID',404);return v;};
const str=(v:unknown,max:number)=>{if(typeof v!=='string'||v.length>max)throw new GroupError('INVALID_INPUT',422);return v;};

export function groupHandler(boundary:()=>GroupBoundary|null|Promise<GroupBoundary|null>){return async(req:Request):Promise<Response>=>{
 try{
  const b=await boundary();if(!b)throw new GroupError('GROUP_UNCONNECTED',503);
  const url=new URL(req.url),path=url.pathname.replace(/^\/api\/group/,'')||'/';
  if(url.search)throw new GroupError('INVALID_QUERY',422);
  if(!['GET','POST'].includes(req.method))throw new GroupError('METHOD_NOT_ALLOWED',405);
  if(req.method==='POST'&&(req.headers.get('origin')!==b.origin||req.headers.get('sec-fetch-site')==='cross-site'))throw new GroupError('ORIGIN_REJECTED',403);
  await b.guard(req);
  const secure=b.origin.startsWith('https:'),c=b.customer,entrance=req.headers.get('x-group-entrance')??'';
  const needEntrance=async()=>{if(!(await c.svc.entranceOpen(entrance)))throw new GroupError('ENTRANCE_UNAVAILABLE',404);};
  const json=(body:unknown,init:{status?:number;cookie?:string}={})=>Response.json(body,{status:init.status??200,headers:{...privateHeaders,...(init.cookie?{'Set-Cookie':init.cookie}:{})}});

  // ----- entrance-scoped (no group data)
  if(req.method==='GET'&&path==='/catalog'){await needEntrance();const cat=await c.catalog();return json({csv:cat.csv,models:cat.models.map(m=>({code:m.code,name:m.name,sport:m.sport})),terms:currentRentalTerms()});}
  let m=/^\/template\/(ja|en)\/(empty|example|legend)$/.exec(path);
  if(req.method==='GET'&&m){await needEntrance();const t=await c.templates(m[1]==='ja'?'JA':'EN'),f=t.files[m[2] as 'empty'|'example'|'legend'];
   return new Response(f.content,{headers:{...privateHeaders,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${f.filename}"`,'X-Content-Type-Options':'nosniff'}});}
  if(req.method==='POST'&&path==='/start'){
   await needEntrance();const v=exact(await readBody(req),['requestKey','groupLabel','contactName','contactEmail','locale','pickupStore','returnStore','period'],['contactPhone']);
   const requestKey=uuidOf(v.requestKey),secret=deriveOwnerSecret(b.serverKey,entrance,requestKey);
   const r=await c.svc.startApplication(entrance,requestKey,secret,{groupLabel:str(v.groupLabel,120),contactName:str(v.contactName,120),contactEmail:str(v.contactEmail,254),contactPhone:v.contactPhone==null||v.contactPhone===''?null:str(v.contactPhone,40),locale:v.locale as 'ja'|'en',pickupStore:str(v.pickupStore,30),returnStore:str(v.returnStore,30),contractVersion:'INTEGRATED_V1_4',period:groupPeriod(v.period)});
   return json({groupId:r.groupId,groupNumber:r.groupNumber,revision:r.revision,resumeKey:secret},{status:201,cookie:groupCookie(r.groupId,secret,secure)});
  }
  // ----- owner session by capability (resume link). Never reachable from the entrance alone.
  if(req.method==='POST'&&path==='/session'){
   const v=exact(await readBody(req),['groupId','secret']),id=uuidOf(v.groupId),secret=str(v.secret,128);
   await c.svc.get({kind:'OWNER',groupId:id,secret},id);
   return json({groupId:id},{cookie:groupCookie(id,secret,secure)});
  }
  // ----- catalog / templates for an EXISTING application: authority is the owner cookie, never the entrance, so a stopped or re-issued
  // entrance cannot strand a group that already exists.
  const og=/^\/g\/([^/]+)\/(catalog|template\/(?:ja|en)\/(?:empty|example|legend))$/.exec(path);
  if(req.method==='GET'&&og){
   const id=uuidOf(og[1]),secret=ownerSecret(req.headers,id);if(!secret)throw new GroupError('NOT_FOUND',404);
   await c.svc.get({kind:'OWNER',groupId:id,secret},id);
   if(og[2]==='catalog'){const cat=await c.catalog();return json({csv:cat.csv,models:cat.models.map(x=>({code:x.code,name:x.name,sport:x.sport})),terms:currentRentalTerms()});}
   const tm=/^template\/(ja|en)\/(empty|example|legend)$/.exec(og[2]!)!;const t=await c.templates(tm[1]==='ja'?'JA':'EN'),f=t.files[tm[2] as 'empty'|'example'|'legend'];
   return new Response(f.content,{headers:{...privateHeaders,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${f.filename}"`,'X-Content-Type-Options':'nosniff'}});
  }
  // ----- one application (owner cookie)
  m=/^\/g\/([^/]+)(?:\/([a-z-]+))?$/.exec(path);
  if(!m)throw new GroupError('NOT_FOUND',404);
  const id=uuidOf(m[1]),op=m[2];const secret=ownerSecret(req.headers,id);if(!secret)throw new GroupError('NOT_FOUND',404);
  const owner:OwnerActor={kind:'OWNER',groupId:id,secret};
  if(req.method==='GET'){if(op)throw new GroupError('NOT_FOUND',404);return json(await c.ownerView(owner,id));}
  const body=await readBody(req),rev=(x:unknown)=>{if(!Number.isInteger(x))throw new GroupError('INVALID_INPUT',422);return x as number;};
  switch(op){
   case 'advise':{exact(body,['rows']);return json(await c.advise(owner,id,body.rows));}
   case 'members':{exact(body,['expectedRevision','rows','directions']);return json(await c.saveRows(owner,id,rev(body.expectedRevision),body.rows,body.directions));}
   case 'quote':{exact(body,['expectedRevision']);await c.svc.quote(owner,id,rev(body.expectedRevision));return json(await c.ownerView(owner,id));}
   case 'consent':{exact(body,['quoteId','digest','explanationConfirmed','fitAcknowledged']);
    if(body.explanationConfirmed!==true)throw new GroupError('CONSENT_INVALID',422);
    if(await c.needsFitAcknowledgement(owner,id)&&body.fitAcknowledged!==true)throw new GroupError('FIT_ACKNOWLEDGEMENT_REQUIRED',422);
    const t=currentRentalTerms();await c.svc.consent(owner,id,{quoteId:str(body.quoteId,64),digest:str(body.digest,64),termsVersion:t.version,termsSha256:t.sha256,explanationConfirmed:true});return json(await c.ownerView(owner,id));}
   case 'submit':{exact(body,['requestKey','expectedRevision','quoteId']);const r=await c.svc.submit(owner,id,{requestKey:uuidOf(body.requestKey),expectedRevision:rev(body.expectedRevision),quoteId:str(body.quoteId,64)});return json({...r,view:await c.ownerView(owner,id)});}
   case 'request':{exact(body,['requestKey','kind','body']);if(body.kind!=='CHANGE'&&body.kind!=='DECLINE')throw new GroupError('INVALID_INPUT',422);
    const text=str(body.body,2000);if(!text.trim())throw new GroupError('INVALID_INPUT',422);
    await c.svc.requestFromCustomer(owner,id,{requestKey:uuidOf(body.requestKey),kind:body.kind,body:text});return json(await c.ownerView(owner,id));}
   case 'logout':{exact(body,[]);return json({revoked:true},{cookie:groupCookie(id,'',secure,true)});}
   default:throw new GroupError('NOT_FOUND',404);
  }
 }catch(e){
  const err=e as {code?:unknown;status?:unknown;detail?:unknown}|null;
  // Known contract errors keep their code/status; anything else (driver, runtime) is an opaque 500 so no data or SQL can leak.
  if((e instanceof GroupError||e instanceof HoldError||(e instanceof Error&&typeof err?.code==='string'&&/^[A-Z][A-Z0-9_]{1,80}$/.test(err.code)&&Number.isInteger(err.status)))&&Number.isInteger(err?.status)){
   const safeDetail=e instanceof GroupError&&e.code.startsWith('ROWS_')?{detail:e.detail}:{};
   return Response.json({error:err!.code,...safeDetail},{status:err!.status as number,headers:{...privateHeaders,...(err!.status===429?{'Retry-After':'60'}:{})}});}
  return Response.json({error:'GROUP_OPERATION_FAILED'},{status:500,headers:privateHeaders});
 }
};}
