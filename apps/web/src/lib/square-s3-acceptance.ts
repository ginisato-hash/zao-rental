import {squareS1Preflight} from './square-s1-preflight';
import {exactS3Manifest,s3Operation,SquareS3Service,SquareS3Transport} from '../../../../packages/core/src/payment/square-s3';
import type {SquareFetch} from '../../../../packages/core/src/payment/square-transport';

type Environment=Readonly<Record<string,string|undefined>>;
const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'};
const reply=(data:unknown,status:number)=>Response.json(data,{status,headers});
function intent(r:Request){const u=new URL(r.url);return !u.search&&r.headers.get('X-ZAO-Acceptance')==='SQUARE_S3_R10'&&
 r.headers.get('sec-fetch-site')==='same-origin'&&(r.headers.get('origin')===u.origin||r.method==='GET'&&!r.headers.has('origin'));}
export function s3Preflight(env:Environment,attempted=false){
 const s1=squareS1Preflight(env);
 const {readyForS1:configurationReady,...flags}=s1;
 const merchantExact=env.SQUARE_SANDBOX_MERCHANT_ID===s3Operation.merchantId,operationManifestExact=exactS3Manifest();
 const paymentExact=s3Operation.paymentId==='pezzekG1LQRt4MVKF0X4sgRCx1FZY',refundAmountExact=s3Operation.refundAmountJpy===100;
 const ready=configurationReady&&merchantExact&&operationManifestExact&&paymentExact&&refundAmountExact&&!attempted;
 return {...flags,merchantExact,operationManifestExact,paymentExact,refundAmountExact,production:env.VERCEL_ENV==='production',instanceAttempted:attempted,
  operatorGuard:'LOCAL_EXCLUSIVE_FSYNC_CHECK_REQUIRED',readyForS3:ready,result:ready?'PASS':'BLOCKED',
  reason:s1.reason??(!merchantExact?'MERCHANT_MISMATCH':!operationManifestExact?'MANIFEST_MISMATCH':attempted?'ALREADY_ATTEMPTED':null)};
}
async function emptyBody(request:Request){
 if(!request.body)return true;const reader=request.body.getReader();let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([Promise.resolve().then(async()=>{for(let i=0;i<4;i++){const p=await reader.read();if(p.done)return true;if(p.value.byteLength)return false;}return false;}),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),1000);})]);}
 catch{return false;}finally{clearTimeout(timer);void reader.cancel().catch(()=>{});}
}
/** Temporary R10 only. Intent is not identity: externally verified Vercel Team protection
 * is required. The per-instance latch is NOT the local operator guard or a shared DB. */
export function createSquareS3Acceptance(env:Environment,fetch:SquareFetch){
 let attempted=false;
 return {
  preflight:async(r:Request)=>{
   if(env.VERCEL_ENV!=='preview')return reply({result:'BLOCKED',reason:'NOT_FOUND'},404);
   if(r.method!=='GET'||!intent(r))return reply({result:'BLOCKED',reason:'INTENT_REQUIRED'},400);
   const p=s3Preflight(env,attempted);return reply(p,p.readyForS3?200:503);
  },
  post:async(r:Request)=>{
   const block=(reason:string,status=400)=>reply({classification:'BLOCKED_NOT_DISPATCHED',reason,paymentLookupCount:0,refundPostCount:0,conditionalGetRefundCount:0},status);
   try {
    if(env.VERCEL_ENV!=='preview')return block('NOT_FOUND',404);
    if(r.method!=='POST')return block('METHOD_NOT_ALLOWED',405);
    if(!intent(r))return block('INTENT_REQUIRED');
    if(!await emptyBody(r))return block('BODY_FORBIDDEN');
    if(attempted)return block('ALREADY_ATTEMPTED',409);
    const p=s3Preflight(env,attempted);if(!p.readyForS3)return block(p.reason??'PREFLIGHT_BLOCKED',503);
    const token=env.SQUARE_SANDBOX_ACCESS_TOKEN!;
    const location=env.SQUARE_SANDBOX_LOCATION_ID!;
    const transport=new SquareS3Transport(location,()=>token,fetch),service=new SquareS3Service(location,transport,()=>token);
    attempted=true;
    const result=await service.run();
    return reply(result,result.classification==='S3_PASS'?200:result.classification==='UNKNOWN_DO_NOT_RETRY'?503:422);
   }catch{return reply({classification:attempted?'UNKNOWN_DO_NOT_RETRY':'BLOCKED_NOT_DISPATCHED',reason:'INTERNAL_EXCEPTION',paymentLookupCount:attempted?null:0,refundPostCount:attempted?null:0,conditionalGetRefundCount:attempted?null:0},503);}
  }
 };
}
