import {Pool} from 'pg';
import {TLSSocket,checkServerIdentity} from 'node:tls';
import {flowHash,flowId,flowObject,matchPayment,type PaymentRequest} from '../../packages/contracts/src/rental-flow';
import {productionConfiguration,type ProductionConfiguration} from '../../packages/auth/src/production-config';
import {issueExactProductionIdentity} from '../../packages/auth/src/production-identity';
import {productionPaymentRoleNames,productionPaymentActivationGrants} from '../production-payment-roles';
import {PgPaymentReconciliation} from '../../packages/db/src/payment-reconciliation';
import {PgPaymentProjection} from '../../packages/db/src/payment-projection';
import {PaymentReconciliationWorker,type PaymentReconciliationRepository,type PaymentContextReader,type PaymentTruthProvider} from '../../packages/core/src/payment/payment-reconciliation';
import {issueProductionReconciliationAuthority} from '../../packages/core/src/payment/production-reconciliation-authority';
import {productionProjectionPermit} from '../../packages/core/src/payment/production-projection-authority';
import {TransactionalPaymentProjection,validateProjectionReference,verifyProjectionSource,type ProjectionReference,type ProjectionSource} from '../../packages/core/src/payment/payment-projection';
import {SquareProductionPaymentTruth} from '../../packages/core/src/payment/square-payment-truth';
import {FetchSquareProductionTransport,type SquareFetch} from '../../packages/core/src/payment/square-transport';
import {RoutedSquareProductionRefundGateway} from '../../packages/core/src/payment/square-production-routing';
import {CancellationRefundWorker} from '../../packages/core/src/payment/cancellation-refund-worker';

export type PaymentRole=keyof ReturnType<typeof productionPaymentRoleNames>;
export type AcceptanceTarget=PaymentRequest&{paymentId:string};
export const acceptanceCommands=['preflight','reconcile-one','project-one','cancellation-refund-one','diagnostics'] as const;
export type AcceptanceCommand=typeof acceptanceCommands[number];
export type AcceptanceInput={releaseId:string;tree:string;configuration:unknown;databaseUrls:Partial<Record<PaymentRole|'operations',string>>;square:{accessToken:string;expiresAt:string};target:AcceptanceTarget|null;reference:ProjectionReference|null;jobId:string|null;refund:{id:string;amountJpy:number;authorizeCreate:boolean}|null};
const fail=(code:string):never=>{throw new Error(code);};
const hash=(s:unknown,n:number):s is string=>typeof s==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(s);
export function acceptanceRelease(input:Pick<AcceptanceInput,'releaseId'|'tree'>,facts:{head:string;tree:string;main:string;clean:boolean}){
 if(!hash(input.releaseId,40)||!hash(input.tree,40)||!facts.clean||input.releaseId!==facts.head||input.releaseId!==facts.main||input.tree!==facts.tree)fail('M3_RELEASE_IDENTITY_REJECTED');
}
export function acceptancePlan(raw:unknown){
 const value=flowObject(raw,['releaseId','tree','configuration','databaseUrls','square','target','reference','jobId','refund']) as unknown as AcceptanceInput;
 const c=productionConfiguration(value.configuration);
 if(!hash(value.releaseId,40)||!hash(value.tree,40)||c.deployment.releaseId!==value.releaseId||c.deployment.origin!=='https://zao-rental.vercel.app'||!c.payment||!c.flags.payment||!c.flags.booking)fail('M3_RELEASE_IDENTITY_REJECTED');
 const square=flowObject(value.square,['accessToken','expiresAt']);
 if(typeof square.accessToken!=='string'||square.accessToken.length<16||square.accessToken.length>4096)fail('M3_CREDENTIAL_REJECTED');
 if(square.expiresAt!=='never'&&(typeof square.expiresAt!=='string'||!Number.isFinite(Date.parse(square.expiresAt))||Date.parse(square.expiresAt)<=Date.now()))fail('M3_CREDENTIAL_REJECTED');
 if(!value.databaseUrls||typeof value.databaseUrls!=='object'||Object.keys(value.databaseUrls).some(k=>![...Object.keys(productionPaymentRoleNames(c.database.name)),'operations'].includes(k)))fail('M3_DATABASE_ROLE_REJECTED');
 if(value.target!==null){
  flowObject(value.target,['attemptId','bookingId','idempotencyKey','merchantId','locationId','amountJpy','currency','paymentId']);
  for(const key of ['attemptId','bookingId','idempotencyKey'] as const)flowId(value.target[key]);
  if(value.target.merchantId!==c.payment!.merchantId||value.target.locationId!==c.payment!.locations.MOUNTAIN_BASE||value.target.currency!=='JPY'||!Number.isSafeInteger(value.target.amountJpy)||value.target.amountJpy<1||value.target.amountJpy>100000000||!/^[A-Za-z0-9_-]{1,100}$/.test(value.target.paymentId))fail('M3_TARGET_REJECTED');
 }
 if(value.reference!==null){flowObject(value.reference,['bookingId','attemptId','jobId','truthRevision','truthFingerprint','observationFingerprint','expectedRevision']);validateProjectionReference(value.reference);if(value.reference.bookingId!==value.target?.bookingId||value.reference.attemptId!==value.target?.attemptId)fail('M3_TARGET_REJECTED');}
 if(value.jobId!==null)flowId(value.jobId);
 if(value.refund!==null){flowObject(value.refund,['id','amountJpy','authorizeCreate']);flowId(value.refund.id);if(value.refund.amountJpy!==value.target?.amountJpy||typeof value.refund.authorizeCreate!=='boolean')fail('M3_REFUND_AUTHORIZATION_REJECTED');}
 return {input:value,configuration:c};
}

/** Explicit URL only; no ambient PG variables, owner fallback, pooled host or TLS override. */
export function acceptanceDatabaseConfig(c:ProductionConfiguration,role:PaymentRole|'operations',raw:string|undefined){
 const expected=role==='operations'?c.database.roles.operations:productionPaymentRoleNames(c.database.name)[role];
 let u:URL;try{u=new URL(raw??'');}catch{return fail('M3_DATABASE_ROLE_REJECTED');}
 if(u.protocol!=='postgresql:'||u.hostname!==c.database.host||/-pooler\./.test(u.hostname)||u.pathname!=='/'+c.database.name||decodeURIComponent(u.username)!==expected||decodeURIComponent(u.password).length<16||u.port&&u.port!=='5432'||u.hash||u.search!=='?sslmode=verify-full')fail('M3_DATABASE_ROLE_REJECTED');
 return {host:u.hostname,port:5432,database:c.database.name,user:expected,password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:true},enableChannelBinding:true,max:1,connectionTimeoutMillis:5000,idleTimeoutMillis:1000,statement_timeout:5000,application_name:'zao_m3_attended_'+role};
}
export async function verifyAcceptanceRole(pool:Pool,c:ProductionConfiguration,role:PaymentRole|'operations'){
 const expected=role==='operations'?c.database.roles.operations:productionPaymentRoleNames(c.database.name)[role];
 const row=(await pool.query(`SELECT current_database() db,current_user role,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolinherit,r.rolreplication,r.rolbypassrls,
 EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) membership,
 EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba=r.oid) database_owner,
 EXISTS(SELECT 1 FROM pg_class cl JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND cl.relowner=r.oid) object_owner,
 has_database_privilege(current_user,current_database(),'CREATE') database_create,has_schema_privilege(current_user,'public','CREATE') schema_create
 FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
 if(!row||row.db!==c.database.name||row.role!==expected||Object.entries(row).some(([k,v])=>!['db','role'].includes(k)&&v!==false))fail('M3_DATABASE_ROLE_REJECTED');
 if(role!=='operations'){
  const required=productionPaymentActivationGrants(c.database.name).filter(sql=>sql.startsWith('GRANT EXECUTE ON FUNCTION ')&&sql.split(' TO ')[1]?.split(',').includes(expected)).flatMap(sql=>sql.split(' TO ')[0]!.match(/[a-z_][a-z0-9_.]*\([^)]*\)/g)??[]);
  const positive=(await pool.query("SELECT bool_and(has_function_privilege(current_user,f,'EXECUTE')) allowed FROM unnest($1::text[]) t(f)",[required])).rows[0];
  const negative=(await pool.query("SELECT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='square_webhook' AND p.proname='receive' OR n.nspname='payment_reconciliation' AND p.proname IN ('dispatch','claim','finalize','load_context','load_contexts','diagnostics')) AND has_function_privilege(current_user,p.oid,'EXECUTE')) forbidden")).rows[0];
  if(positive?.allowed!==true||negative?.forbidden!==false)fail('M3_DATABASE_GRANTS_REJECTED');
 }
}

export async function verifyAcceptanceAttempt(pool:Pool,target:AcceptanceTarget){
 const row=(await pool.query(`SELECT a.id AS "attemptId",a.booking_id AS "bookingId",a.idempotency_key AS "idempotencyKey",a.merchant_id AS "merchantId",a.location_id AS "locationId",a.amount_jpy::integer AS "amountJpy",a.currency,a.provider_id AS "paymentId",b.mode
 FROM rental_payment_attempts a JOIN rental_bookings b ON b.id=a.booking_id WHERE a.id=$1 AND a.booking_id=$2`,[target.attemptId,target.bookingId])).rows[0];
 if(!row)fail('M3_TARGET_REJECTED');
 const {mode,...persisted}=row;
 if(mode!=='SQUARE_PRODUCTION'||flowHash(persisted)!==flowHash(target))fail('M3_TARGET_REJECTED');
}

/** One dispatch, one claim, one persisted context, at most one provider GET; no scheduling/retry. */
export async function reconcileProductionOne(repository:PaymentReconciliationRepository,contexts:PaymentContextReader,provider:PaymentTruthProvider,target:AcceptanceTarget){
 let invoked=false;
 const bounded:PaymentReconciliationRepository={
  dispatch:(e,n)=>repository.dispatch(e,n),
  async claimBatch(e,id,n){const claims=await repository.claimBatch(e,id,n);if(claims.length>1||claims.some(c=>c.environment!=='PRODUCTION'||c.merchantId!==target.merchantId||c.paymentId!==target.paymentId))fail('M3_CLAIM_TARGET_REJECTED');return claims;},
  finalize:(c,o)=>repository.finalize(c,o),diagnostics:(e,n)=>repository.diagnostics(e,n),
 };
 const scoped:PaymentContextReader={async load(claim){const context=await contexts.load(claim);if(!context||flowHash({...context.expected,paymentId:target.paymentId})!==flowHash(target))return null;return context;}};
 const once:PaymentTruthProvider={async lookupPayment(request){if(invoked)fail('M3_LOOKUP_ALREADY_INVOKED');invoked=true;return provider.lookupPayment(request);}};
 return new PaymentReconciliationWorker(bounded,scoped,once).runOnce('PRODUCTION','m3-attended',1);
}

export function refundNextAction(row:{state:string;dispatched_at:string|null;provider_id:string|null},authorized:boolean){
 if(['COMPLETED','FAILED','REVIEW'].includes(row.state))return 'TERMINAL';
 if(row.provider_id)return 'LOOKUP';
 if(row.dispatched_at)return 'MANUAL_RECONCILIATION_REQUIRED';
 if(row.state==='UNKNOWN')return 'MANUAL_RECONCILIATION_REQUIRED';
 if(row.state!=='PENDING'||!authorized)fail('M3_LIVE_REFUND_AUTHORIZATION_REQUIRED');
 return 'CREATE';
}

/** Live factory is override-free: every authority originates from the pinned ExactProductionIdentity. */
export async function runProductionPaymentAcceptance(command:AcceptanceCommand,raw:unknown,fetch:SquareFetch){
 const {input,configuration:c}=acceptancePlan(raw),identity=issueExactProductionIdentity(c),authority=issueProductionReconciliationAuthority(identity);
 const pools:Pool[]=[];
 const open=async(role:PaymentRole|'operations')=>{
  if(['NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR'].some(k=>process.env[k]!==undefined))fail('M3_TLS_OVERRIDE_REJECTED');
  const config=acceptanceDatabaseConfig(c,role,input.databaseUrls[role]),pool=new Pool(config);pools.push(pool);pool.on('error',()=>{});
  const client=await pool.connect();try{const stream=(Reflect.get(client,'connection') as {stream?:unknown})?.stream;
   if(!(stream instanceof TLSSocket)||!stream.encrypted||!stream.authorized||!['TLSv1.2','TLSv1.3'].includes(stream.getProtocol()??'')||Reflect.get(stream,'servername')!==config.host||checkServerIdentity(config.host,stream.getPeerCertificate())!==undefined)fail('M3_TLS_IDENTITY_REJECTED');
  }finally{client.release();}await verifyAcceptanceRole(pool,c,role);return pool;
 };
 const target=()=>input.target??fail('M3_TARGET_REQUIRED');
 const transport=(locationId:string)=>new FetchSquareProductionTransport(c.payment!.merchantId,locationId,async()=>({environment:'PRODUCTION',merchantId:c.payment!.merchantId,locationId,accessToken:input.square.accessToken,expiresAt:input.square.expiresAt==='never'?null:new Date(input.square.expiresAt),revoked:false}),fetch);
 try{
  if(command==='preflight'){for(const role of Object.keys(productionPaymentRoleNames(c.database.name)) as PaymentRole[])await open(role);return {status:'READY',verifiedPaymentRoles:5,providerCalls:0};}
  if(command==='reconcile-one'){
   const dispatcher=new PgPaymentReconciliation(await open('dispatcher'),undefined,authority),worker=new PgPaymentReconciliation(await open('worker'),undefined,authority);
   return await reconcileProductionOne({dispatch:(e,n)=>dispatcher.dispatch(e,n),claimBatch:(e,id,n)=>worker.claimBatch(e,id,n),finalize:(claim,outcome)=>worker.finalize(claim,outcome),diagnostics:async()=>[]},worker,new SquareProductionPaymentTruth(transport(target().locationId)),target());
  }
  if(command==='project-one'){
   if(!input.reference)fail('M3_PROJECTION_REFERENCE_REQUIRED');
   const permit=productionProjectionPermit(identity,target()),pool=await open('projector');
   await verifyAcceptanceAttempt(pool,target());
   const repository=new PgPaymentProjection(pool,async(client,ref)=>{
    const source=(await client.query<{source:ProjectionSource|null}>('SELECT payment_projection.lock_source($1) AS source',[ref.jobId])).rows[0]?.source??null;
    if(source?.observation){matchPayment(target(),source.observation);if(source.paymentId!==target().paymentId)fail('M3_TARGET_REJECTED');}
    return source;
   },undefined,permit);
   return await new TransactionalPaymentProjection(repository,undefined,permit).project(input.reference!);
  }
  if(command==='diagnostics'){
   const diagnostic=new PgPaymentReconciliation(await open('diagnostic'),undefined,authority);
   const jobs=(await diagnostic.diagnostics('PRODUCTION',20)).filter(j=>j.paymentId===target().paymentId&&(!input.jobId||j.id===input.jobId)).map(j=>({id:j.id,state:j.state,code:j.code,decision:j.decision}));
   if(!input.jobId)return {jobs,reference:null};
   const projector=await open('projector');await verifyAcceptanceAttempt(projector,target());
   const client=await projector.connect();try{
    await client.query('BEGIN');const source=(await client.query<{source:ProjectionSource|null}>('SELECT payment_projection.lock_source($1) AS source',[input.jobId])).rows[0]?.source;
    if(!source?.observation)fail('M3_PERSISTED_TRUTH_REQUIRED');
    matchPayment(target(),source!.observation!);if(source!.paymentId!==target().paymentId)fail('M3_TARGET_REJECTED');
    const revision=(await client.query<{revision:number}>('SELECT revision FROM payment_projection.heads WHERE attempt_id=$1',[target().attemptId])).rows[0]?.revision??0;
    const reference={bookingId:target().bookingId,attemptId:target().attemptId,jobId:input.jobId,truthRevision:source!.truthRevision,truthFingerprint:source!.decisionFingerprint,observationFingerprint:flowHash(source!.observation),expectedRevision:revision};
    verifyProjectionSource(reference,source!,new Date(),'PRODUCTION');return {jobs,reference};
   }finally{await client.query('ROLLBACK').catch(()=>{});client.release();}
  }
  if(command==='cancellation-refund-one'){
   const spec=input.refund??fail('M3_REFUND_TARGET_REQUIRED'),pool=await open('operations');
   const row=(await pool.query('SELECT cancellation_refund_row($1) v',[spec.id])).rows[0]?.v;
   if(!row||row.mode!=='SQUARE_PRODUCTION'||row.booking_id!==target().bookingId||row.merchant_id!==target().merchantId||row.location_id!==target().locationId||row.payment_provider_id!==target().paymentId||Number(row.amount_jpy)!==spec.amountJpy||row.currency!=='JPY')fail('M3_REFUND_TARGET_REJECTED');
   const payment=(await pool.query('SELECT state,provider_state,provider_id,amount_jpy,currency FROM rental_payment_attempts WHERE id=$1 AND booking_id=$2',[target().attemptId,target().bookingId])).rows[0];
   if(!payment||payment.state!=='COMPLETED'||payment.provider_state!=='COMPLETED'||payment.provider_id!==target().paymentId||Number(payment.amount_jpy)!==target().amountJpy||payment.currency!=='JPY')fail('M3_COMPLETED_PAYMENT_REQUIRED');
   const action=refundNextAction(row,spec.authorizeCreate);
   if(action==='MANUAL_RECONCILIATION_REQUIRED'||action==='TERMINAL')return {state:row.state,action,providerCalls:0};
   const gateway=new RoutedSquareProductionRefundGateway(c.payment!.merchantId,{MOUNTAIN_BASE:{locationId:c.payment!.locations.MOUNTAIN_BASE,transport:transport(c.payment!.locations.MOUNTAIN_BASE)},ONSEN_BASE:{locationId:c.payment!.locations.ONSEN_BASE,transport:transport(c.payment!.locations.ONSEN_BASE)}});
   const worker=new CancellationRefundWorker(pool,gateway,identity);
   return action==='CREATE'?await worker.dispatch(spec.id):await worker.reconcile(spec.id);
  }
  return fail('M3_COMMAND_REJECTED');
 }finally{await Promise.all(pools.map(p=>p.end().catch(()=>{})));}
}
