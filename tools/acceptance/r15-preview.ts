import {createHash} from 'node:crypto';
import {Pool,type PoolConfig} from 'pg';
import {squareS1Preflight} from '../../apps/web/src/lib/square-s1-preflight';
import {dispatchR15Once} from '../../packages/db/src/r15-operation-guard';
import {r15HostedComposition} from '../../packages/db/src/r15-hosted-composition';
import {SquareSandboxPaymentTruth} from '../../packages/core/src/payment/square-payment-truth';
import {squareCreateBody,squareObservation} from '../../packages/core/src/payment/square-boundary';
import {flowHash,matchPayment,type PaymentRequest} from '../../packages/contracts/src/rental-flow';
import type {ProjectionSource} from '../../packages/core/src/payment/payment-projection';
import type {InboxPool} from '../../packages/db/src/square-webhook-inbox';
const PROJECT='prj_ehUMOzM77em9DVnHJBJffncD5hg7',DB='zr_852b20c4d4b0',MERCHANT='MLKDVEDH1ME21';
const ORIGIN='https://connect.squareupsandbox.com',VERSION='2026-08-19';
const NOTIFICATION='https://zao-rental-webhook-sandbox.vercel.app/api/webhooks/square';
const ident=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error();return v as Record<string,unknown>;};
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'}});
export function r15RuntimeDatabase(uri:string|undefined,role:string):PoolConfig{
 const u=new URL(uri??'');
 if(u.protocol!=='postgresql:'||!/^ep-[a-z0-9.-]+\.neon\.tech$/.test(u.hostname)||u.port&&u.port!=='5432'||u.hash||u.pathname!=='/'+DB||decodeURIComponent(u.username)!==DB+'_pay_'+role||!u.password||u.search!=='?sslmode=verify-full')throw Error('R15_RUNTIME_DATABASE_INVALID');
 return {host:u.hostname,port:5432,database:DB,user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:true},max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:5000};
}
/** The local operator verifies these exact bytes from Git before installing the DB
 * manifest. The server recomputes their hash; the durable DB reservation validates
 * that it is the installed hash and that all persisted payment bindings match. */
export function r15Manifest(raw:unknown,location:string){
 const b=object(raw);if(typeof b.manifestSource!=='string'||b.manifestSource.length>10000||!hash(b.manifestSha256)||createHash('sha256').update(b.manifestSource).digest('hex')!==b.manifestSha256)throw Error('R15_MANIFEST_SOURCE_MISMATCH');
 const m=object(JSON.parse(b.manifestSource)),budgets=object(m.budgets);
 if(m.authority!=='P6_R15_COMPLETION'||m.resourceId!=='store_i5vh0ZEKo2ikcVo9'||m.database!==DB||m.environment!=='SANDBOX'||m.merchantId!==MERCHANT||m.locationId!==location||m.amountJpy!==100||m.currency!=='JPY'||m.branch!=='codex/external-acceptance-p6'||typeof m.sourceHead!=='string'||!/^[a-f0-9]{40}$/.test(m.sourceHead)||!uuid(m.bookingId)||!uuid(m.attemptId)||!uuid(m.idempotencyKey)||!uuid(m.operationId)||budgets.createPayment!==1||budgets.getPayment!==1||budgets.retry!==0)throw Error('R15_MANIFEST_BINDING_INVALID');
 const request:PaymentRequest={bookingId:m.bookingId,attemptId:m.attemptId,idempotencyKey:m.idempotencyKey,merchantId:MERCHANT,locationId:location,amountJpy:100,currency:'JPY'};
 return {request,manifestSha256:b.manifestSha256};
}
type Env=Readonly<Record<string,string|undefined>>;
type Pools={worker:InboxPool;dispatcher:InboxPool;projector:InboxPool;diagnostic:InboxPool};
/** Temporary protected operator only. No customer page, owner credential, background
 * task or automatic retry. Caller persists exclusive guards before each invocation.
 * Subscription key response is a private RAM-only handoff to the existing sink. */
export function r15Preview(env:Env,send:typeof fetch,pools:()=>Pools){
 const used=new Set<string>();
 return async(request:Request):Promise<Response>=>{
  let dispatched=false;
  try{
   const u=new URL(request.url),action=u.pathname.slice('/api/r15/'.length);
   if(env.VERCEL_ENV!=='preview'||env.VERCEL_PROJECT_ID!==PROJECT||env.R15_ACTIVATION_AUTHORITY!=='P6_R15')return reply({classification:'NOT_FOUND'},404);
   if(u.pathname==='/'&&request.method==='GET')return new Response('R15 synthetic operator. No customer routes.',{headers:{'Cache-Control':'no-store','Content-Type':'text/plain','Content-Security-Policy':"default-src 'none'; connect-src 'self'"}});
   if(!u.pathname.startsWith('/api/r15/')||u.search||request.headers.get('X-ZAO-Acceptance')!=='P6_R15_COMPLETION'||request.headers.get('sec-fetch-site')!=='same-origin'||request.headers.get('origin')!==u.origin&&!(request.method==='GET'&&!request.headers.has('origin')))return reply({classification:'INTENT_REQUIRED'},400);
   if(!squareS1Preflight(env).readyForS1||env.SQUARE_SANDBOX_MERCHANT_ID!==MERCHANT)return reply({classification:'CONFIGURATION_BLOCKED'},503);
   const location=env.SQUARE_SANDBOX_LOCATION_ID!;
   if(action==='preflight'&&request.method==='GET'){
    for(const [name,role] of [['WORKER','truth'],['DISPATCHER','dispatch'],['PROJECTOR','projection'],['DIAGNOSTIC','diagnostic']])r15RuntimeDatabase(env['R15_'+name+'_DATABASE_URL'],role!);
    return reply({classification:'READY',merchantId:MERCHANT,locationId:location,apiVersion:VERSION,environment:'SANDBOX',database:DB,providerRequests:0});
   }
   if(request.method!=='POST'||!['subscription','test','payment','reconcile','delete-subscription'].includes(action))return reply({classification:'NOT_FOUND'},404);
   if(Number(request.headers.get('content-length')??0)>16384)return reply({classification:'BODY_REJECTED'},413);
   const text=await request.text();if(text.length>16384)return reply({classification:'BODY_REJECTED'},413);const body=object(JSON.parse(text));
   if(used.has(action))return reply({classification:'ALREADY_INVOKED_DO_NOT_RETRY'},409);
   const provider=async(method:string,path:string,payload?:unknown,signal?:AbortSignal)=>{
    dispatched=true;
    const r=await send(ORIGIN+path,{method,redirect:'error',signal:signal??AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+env.SQUARE_SANDBOX_ACCESS_TOKEN,'Square-Version':VERSION,'Content-Type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    if(r.status===204)return {status:r.status,body:{}};
    return {status:r.status,body:object(await r.json())};
   };
   if(action==='subscription'){
    if(!uuid(body.idempotencyKey))throw Error();used.add(action);
    const r=await provider('POST','/v2/webhooks/subscriptions',{idempotency_key:body.idempotencyKey,subscription:{name:'ZAO R15 synthetic acceptance',enabled:true,event_types:['payment.created','payment.updated'],notification_url:NOTIFICATION,api_version:VERSION}});
    const s=object(r.body.subscription);
    if(r.status!==200||!ident(s.id)||s.enabled!==true||s.api_version!==VERSION||s.notification_url!==NOTIFICATION||!Array.isArray(s.event_types)||s.event_types.length!==2||!s.event_types.includes('payment.created')||!s.event_types.includes('payment.updated')||typeof s.signature_key!=='string'||s.signature_key.length<16||s.signature_key.length>512)throw Error();
    return reply({http:r.status,subscription:{id:s.id,enabled:true,api_version:VERSION,notification_url:NOTIFICATION,event_types:s.event_types,signature_key:s.signature_key}});
   }
   if(action==='test'||action==='delete-subscription'){
    if(!ident(body.subscriptionId))throw Error();used.add(action);
    const r=await provider(action==='test'?'POST':'DELETE','/v2/webhooks/subscriptions/'+body.subscriptionId+(action==='test'?'/test':''),action==='test'?{event_type:'payment.created'}:undefined);
    if(action==='delete-subscription')return reply({http:r.status,classification:r.status===200&&(r.body.errors===undefined||(Array.isArray(r.body.errors)&&r.body.errors.length===0))?'DELETED':'DELETE_UNCONFIRMED'});
    const s=object(r.body.subscription_test_result);
    if(r.status!==200||!ident(s.id)||!Number.isInteger(s.status_code))throw Error();
    return reply({http:r.status,testId:s.id,deliveryStatus:s.status_code});
   }
   const m=r15Manifest(body,location),p=pools();used.add(action);
   if(action==='payment'){
    const r=await dispatchR15Once(p.worker,{...m.request,manifestSha256:m.manifestSha256,action:'CREATE_PAYMENT',paymentId:null},()=>provider('POST','/v2/payments',squareCreateBody(m.request,'cnon:card-nonce-ok')));
    if(r.status!==200)return reply({classification:'CREATE_FAILED_DO_NOT_RETRY',http:r.status,createPaymentCount:1},422);
    const o=squareObservation(r.body.payment,m.request,MERCHANT);matchPayment(m.request,o);
    return reply({classification:o.status==='COMPLETED'?'CREATE_COMPLETED':'CREATE_NONTERMINAL_DO_NOT_RETRY',http:r.status,createPaymentCount:1,payment:o});
   }
   if(!ident(body.paymentId))throw Error();
   let lookups=0,lastHttp:number|null=null;
   const truth=new SquareSandboxPaymentTruth({environment:'SANDBOX',merchantId:MERCHANT,async send(input){lookups++;const r=await provider('GET','/v2/payments/'+body.paymentId,undefined,input.signal);lastHttp=r.status;return r;}});
   const composition=r15HostedComposition(p,env,{...m.request,database:DB,paymentId:body.paymentId},truth,m.manifestSha256);
   const result=await composition.runOnce();
   if(result.results.length!==1||result.results[0]?.result!=='SAVED'||result.results[0]?.proposedState!=='RECONCILED'||result.results[0]?.decision!=='ACCEPT_COMPLETED')return reply({classification:'R12_NOT_ACCEPTED_DO_NOT_RETRY',getPaymentCount:lookups,http:lastHttp,r12:result},422);
   const c=await p.projector.connect();let source:ProjectionSource|null;
   try{await c.query('BEGIN');source=(await c.query<{source:ProjectionSource}>('SELECT payment_projection.lock_source($1) AS source',[result.results[0].id])).rows[0]?.source??null;await c.query('ROLLBACK');}finally{c.release();}
   if(!source?.observation)throw Error();
   const ref={bookingId:m.request.bookingId,attemptId:m.request.attemptId,jobId:source.jobId,truthRevision:source.truthRevision,truthFingerprint:source.decisionFingerprint,observationFingerprint:flowHash(source.observation),expectedRevision:0};
   const projected=await composition.project(ref),duplicate=await composition.project(ref);
   return reply({classification:projected.decision==='APPLY_COMPLETED'&&duplicate.duplicate?'R15_E2E_PASS':'R13_NOT_ACCEPTED',getPaymentCount:lookups,http:lastHttp,r12:result,projection:projected,duplicate});
  }catch{return reply({classification:dispatched?'UNKNOWN_DO_NOT_RETRY':'BLOCKED_NOT_DISPATCHED',providerDispatchObserved:dispatched},503);}
 };
}
let runtime:Pools|undefined;
export const handle=r15Preview(process.env,fetch,()=>{
 if(!runtime){const make=(key:string,role:string)=>{const p=new Pool(r15RuntimeDatabase(process.env[key],role));p.on('error',()=>{});return p;};runtime={worker:make('R15_WORKER_DATABASE_URL','truth'),dispatcher:make('R15_DISPATCHER_DATABASE_URL','dispatch'),projector:make('R15_PROJECTOR_DATABASE_URL','projection'),diagnostic:make('R15_DIAGNOSTIC_DATABASE_URL','diagnostic')};}return runtime;
});
