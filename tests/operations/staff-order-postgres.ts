import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {syntheticLegalReady} from '../fixtures/approved-legal';
import {currentRentalTerms} from '../../packages/core/src/content/rental-terms';
import type {ProductionConfiguration} from '../../packages/auth/src/production-config';
import type {StaffPrincipal,StaffState} from '../../packages/auth/src/staff-auth';
import type {PaymentRequest,PaymentObservation} from '../../packages/contracts/src/rental-flow';
// Staff New order (Issue #47 consolidated order §6, payment method per #7008569703): the shared booking flow composed on
// staff drafts exactly as the Production factory composes it, against real local PostgreSQL. Only the already-issued
// production identity lookup and the Square gateway are local test doubles; no provider, card data or network is used.
const identity=Object.freeze({kind:'EXACT_PRODUCTION_IDENTITY' as const});let config:Readonly<ProductionConfiguration>;
const identityModule=await import('../../packages/auth/src/production-identity');
const identityMock=mock.module(new URL('../../packages/auth/src/production-identity.ts',import.meta.url).href,{namedExports:{...identityModule,exactProductionIdentityConfiguration:(value:unknown)=>value===identity?config:identityModule.exactProductionIdentityConfiguration(value as never)}});
const {normalProductionFixture}=await import('../readiness/normal-production-fixture');
const {productionConfiguration}=await import('../../packages/auth/src/production-config');
const {issueCommercialPriceAuthority}=await import('../../packages/core/src/pricing/commercial-price-authority');
const {GuestBookingService}=await import('../../packages/core/src/guest/service');
const {StaffOrderDrafts}=await import('../../packages/core/src/operations/staff-order-drafts');
const {staffOrderHandler}=await import('../../apps/web/src/lib/staff-order-http');
const {HoldService}=await import('../../packages/core/src/inventory/hold-service');
const {QuoteService}=await import('../../packages/core/src/pricing/quote-service');
const {RecommendationService}=await import('../../packages/core/src/recommendation/recommendation-service');
const {BookingService}=await import('../../packages/core/src/payment/booking-service');
const {registerWear}=await import('../wear/fixture');
const {LedgerService}=await import('../../packages/core/src/catalog/ledger-service');
const {WearService}=await import('../../packages/core/src/wear/service');
const {ledgerPrincipal}=await import('../../packages/auth/src/staff-auth');
const {verifyLedgerWrite}=await import('../../packages/auth/src/ledger-write-authority');
const {reconcileLedgerProtection}=await import('../../packages/core/src/catalog/reconcile-protection');
const x=await normalProductionFixture();let failed=false,stage='fixture',passed=0;
const check=async(name:string,fn:()=>Promise<void>)=>{stage=name;await fn();passed++;console.log('PASS '+name);};
type View={id:string;revision:number;reviewHash:string;customerProfileId:string|null;booking:{id:string;state:string;mode:string}|null;hold:{state:string}|null;quote:{validity:string}|null};
try{
 const original=productionConfiguration(x.input().configuration);
 config=productionConfiguration({...original,flags:{...original.flags,payment:true},payment:{provider:'SQUARE',environment:'PRODUCTION',merchantId:'SYNTHETIC-STAFF-MERCHANT',locations:{MOUNTAIN_BASE:'SYNTHETIC-MOUNTAIN',ONSEN_BASE:'SYNTHETIC-ONSEN'}}});
 // The local development operations role is narrower than the Production operations plan
 // (scripts/production-app-roles.ts), which already grants these booking/payment writes. Mirror only those statements here.
 {const u=x.operationsRole.operationsDb.user;for(const sql of [`GRANT SELECT ON price_books,rental_bookings,rental_payment_attempts TO ${u}`,`GRANT INSERT,UPDATE(state,confirmed_at,version) ON rental_bookings TO ${u}`,`GRANT INSERT,UPDATE(state,provider_id,provider_state,provider_updated_at,completed_at,updated_at) ON rental_payment_attempts TO ${u}`,`GRANT UPDATE(payment_state,confirmed_at,version) ON inventory_holds TO ${u}`])await x.db.pool.query(sql);}
 const authority=issueCommercialPriceAuthority(identity),calls:PaymentRequest[]=[];
 const gateway={kind:'SQUARE_PRODUCTION' as const,async create(r:PaymentRequest):Promise<PaymentObservation>{calls.push(r);await new Promise(f=>setTimeout(f,30));return {providerId:'synthetic-'+r.attemptId,referenceId:r.bookingId,idempotencyKey:r.idempotencyKey,merchantId:r.merchantId,locationId:r.locationId,amountJpy:r.amountJpy,currency:'JPY',status:'PENDING',updatedAt:x.now().toISOString(),completedAt:null};},async lookup(){throw Error('UNEXPECTED_PROVIDER_LOOKUP');}};
 const ledger=new LedgerService(x.roles.ledgerPool,ledgerPrincipal(x.principal),(c,s,a)=>verifyLedgerWrite(c,x.roles.authPool,x.signed.identity,s,a),(r,id,v)=>reconcileLedgerProtection(x.roles.transferPool,x.roles.authPool,x.signed.identity,r,id,v));
 const stock=await registerWear(ledger,new WearService(x.flow.flowPool,x.roles.authPool,x.signed.identity));
 const variants=await x.holds.recommendationCatalog(),catalog={revision:'synthetic-staff-order',models:[],sizes:variants.filter(v=>['WEAR_JACKET','WEAR_PANTS'].includes(v.family)).map(v=>({key:v.id,label:v.size,variant:v}))};
 const ops=x.operationsRole.operationsPool,origin=x.origin;
 // Same composition as production-runtime staffOrders(): staff principal for HOLD/quote, verified session for booking.
 const factory=(principal:StaffPrincipal,actor:{subject:string;sessionId:string})=>{const holds=new HoldService(x.roles.holdPool,principal),quotes=new QuoteService(x.roles.pricingPool,principal,undefined,authority),recommendations=new RecommendationService(x.roles.recommendationPool,principal,holds,quotes);
  const drafts=new StaffOrderDrafts(ops),bookings=new BookingService(ops,x.roles.authPool,actor,gateway,null,identity);return {drafts,service:new GuestBookingService(drafts,actor,recommendations,bookings,async()=>catalog,undefined,syntheticLegalReady)};};
 const stampOf=(sessionId:string,principal:StaffPrincipal)=>JSON.stringify([sessionId,principal]);
 const client=(sessionId:string,principal:StaffPrincipal=x.principal,f:typeof factory|null=factory)=>{const stamp=stampOf(sessionId,principal),state=async():Promise<StaffState>=>({status:'authorized',principal,stamp}),api=staffOrderHandler(state,f,origin),session=createHash('sha256').update(stamp).digest('hex');
  return {raw:(path:string,init:RequestInit={})=>api(new Request(origin+'/api/staff-orders'+path,init)),get:(path:string)=>api(new Request(origin+'/api/staff-orders'+path,{headers:{'x-zao-session':session}})),post:(path:string,body:unknown,headers:Record<string,string>={})=>api(new Request(origin+'/api/staff-orders'+path,{method:'POST',headers:{origin,'content-type':'application/json','x-zao-session':session,...headers},body:JSON.stringify(body)}))};};
 const me=client(x.signed.identity.sessionId);let serial=3;
 const ok=async(r:Response)=>{assert.equal(r.status,200,JSON.stringify(await r.clone().json()));return await r.json() as View;};
 async function order(c:ReturnType<typeof client>,customerId?:string|null){
  let d=await ok(await c.post('/restart',{}));
  if(customerId!==undefined)d=await ok(await c.post('/customer',{draftId:d.id,expectedRevision:d.revision,customerId}));
  const day='2035-03-'+String(serial++).padStart(2,'0'),input={pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:{startDate:day,endDate:day,slot:'DAY'},members:[{key:'person-1',sport:'WEAR',heightCm:null,footCm:null,adultAtStart:true,tier:'STANDARD',ski:null,poleSize:null,premiumModel:null,jacketSize:stock.selection.jacketVariantId,pantsSize:stock.selection.pantsVariantId,wearSport:'SKI'}]};
  d=await ok(await c.post('/draft',{draftId:d.id,expectedRevision:d.revision,input}));d=await ok(await c.post('/preview',{draftId:d.id,expectedRevision:d.revision}));
  d=await ok(await c.post('/selection',{draftId:d.id,expectedRevision:d.revision,directions:{'person-1':'RECOMMENDED'},wantAdvance:false,couponCode:null,acceptedModelPolicy:true}));
  const body={draftId:d.id,expectedRevision:d.revision,reviewHash:d.reviewHash,locale:'ja',contact:{displayName:'SYNTHETIC Counter',email:'synthetic-counter@example.invalid',termsAccepted:true,terms:{...currentRentalTerms(),locale:'ja'}}};
  return {d,body};
 }
 const attempts=async(booking:string)=>(await x.db.pool.query('SELECT count(*)::int n FROM rental_payment_attempts WHERE booking_id=$1',[booking])).rows[0].n as number;

 await check('session stamp, origin, permissions and unconnected composition are enforced before any draft',async()=>{
  assert.equal((await me.raw('/draft')).status,409);
  assert.equal((await me.raw('/draft',{headers:{'x-zao-session':'0'.repeat(64)}})).status,409);
  assert.equal((await me.post('/context',{},{origin:'https://other.invalid'})).status,403);
  const viewer={...x.principal,permissions:x.principal.permissions.filter(p=>p!=='BOOKING_CREATE')} as StaffPrincipal;
  assert.equal((await client(x.signed.identity.sessionId,viewer).post('/context',{})).status,403);
  const none={...x.principal,permissions:[]} as unknown as StaffPrincipal;assert.equal((await client(x.signed.identity.sessionId,none).get('/draft')).status,403);
  const r=await client(x.signed.identity.sessionId,x.principal,null).post('/context',{});assert.equal(r.status,503);assert.equal((await r.json()).error,'PAYMENT_NOT_CONNECTED_CHARGE_DISABLED');
  assert.equal((await me.raw('/draft?x=1',{headers:{'x-zao-session':createHash('sha256').update(stampOf(x.signed.identity.sessionId,x.principal)).digest('hex')}})).status,422);
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM staff_order_drafts')).rows[0].n,0);
 });
 let first:{booking:string;customer:string};
 await check('save/preview/selection/prepare create one DRAFT booking with zero provider calls; terms recorded',async()=>{
  const {body}=await order(me);const d=await ok(await me.post('/prepare-payment',body));
  assert.equal(d.booking!.state,'DRAFT');assert.equal(d.booking!.mode,'SQUARE_PRODUCTION');assert.equal(d.hold!.state,'ACTIVE');assert.equal(calls.length,0);assert.equal(await attempts(d.booking!.id),0);
  const row=(await x.db.pool.query("SELECT b.owner_id,l.customer_id,l.source,a.version,a.sha256,a.locale FROM rental_bookings b JOIN customer_booking_links l ON l.booking_id=b.id JOIN rental_terms_acceptances a ON a.booking_id=b.id WHERE b.id=$1",[d.booking!.id])).rows[0];
  assert.equal(row.owner_id,x.signed.identity.subject);assert.equal(row.source,'BOOKING_CREATE');assert.deepEqual([row.version,row.sha256,row.locale],[currentRentalTerms().version,currentRentalTerms().sha256,'ja']);
  first={booking:d.booking!.id,customer:row.customer_id};
  // Card material is only accepted by the explicit checkout step.
  assert.equal((await me.post('/prepare-payment',{...body,paymentSource:'synthetic-source'})).status,422);assert.equal(calls.length,0);
 });
 await check('concurrent explicit checkout calls the gateway exactly once; missing/CASH source is refused',async()=>{
  const d=await ok(await me.get('/draft')),body={draftId:d.id,expectedRevision:d.revision,reviewHash:d.reviewHash,locale:'ja',contact:{displayName:'SYNTHETIC Counter',email:'synthetic-counter@example.invalid',termsAccepted:true,terms:{...currentRentalTerms(),locale:'ja'}}};
  assert.equal((await me.post('/checkout',body)).status,422);assert.equal((await me.post('/checkout',{...body,paymentSource:'CASH'})).status,422);assert.equal(calls.length,0);
  const rs=await Promise.all([me.post('/checkout',{...body,paymentSource:'synthetic-source'}),me.post('/checkout',{...body,paymentSource:'synthetic-source'})]);
  assert.ok(rs.some(r=>r.status===200),JSON.stringify(await Promise.all(rs.map(r=>r.clone().json()))));assert.equal(calls.length,1);assert.equal(await attempts(first.booking),1);
  assert.equal(calls[0]!.bookingId,first.booking);assert.equal(calls[0]!.locationId,'SYNTHETIC-MOUNTAIN');
 });
 await check('another session of the same staff member cannot see or continue this draft',async()=>{
  const other=await x.login('flow-actor@example.invalid'),c=client(other.identity.sessionId);
  const r=await c.get('/draft');assert.equal(r.status,409);assert.equal((await r.json()).error,'STAFF_ORDER_REQUIRED');
  const mine=await ok(await me.get('/draft'));assert.equal(mine.booking!.id,first.booking);
 });
 await check('customer selection: only a visible customer, rechecked at booking creation; unknown customer refused',async()=>{
  let d=await ok(await me.post('/restart',{}));
  const bad=await me.post('/customer',{draftId:d.id,expectedRevision:d.revision,customerId:'00000000-0000-4000-8000-000000000000'});assert.equal(bad.status,403);
  const {body}=await order(me,first.customer);d=await ok(await me.post('/prepare-payment',body));assert.equal(d.customerProfileId,first.customer);
  const link=(await x.db.pool.query('SELECT customer_id,source FROM customer_booking_links WHERE booking_id=$1',[d.booking!.id])).rows[0];assert.equal(link.customer_id,first.customer);assert.equal(calls.length,1);
  const locked=await me.post('/customer',{draftId:d.id,expectedRevision:d.revision,customerId:null});assert.equal(locked.status,409);
 });
 await check('payment start refuses a booking whose recorded terms no longer match the current bundle',async()=>{
  const {body}=await order(me);const d=await ok(await me.post('/prepare-payment',body));
  // Simulate a bundle change after booking creation in this owned DB only (the immutability trigger is restored at once).
  const c=await x.db.pool.connect();try{await c.query('BEGIN');await c.query('ALTER TABLE rental_terms_acceptances DISABLE TRIGGER rental_terms_acceptances_immutable');await c.query('DELETE FROM rental_terms_acceptances WHERE booking_id=$1',[d.booking!.id]);await c.query('ALTER TABLE rental_terms_acceptances ENABLE TRIGGER rental_terms_acceptances_immutable');await c.query('COMMIT');}finally{c.release();}
  const now=await ok(await me.get('/draft')),r=await me.post('/checkout',{...body,expectedRevision:now.revision,reviewHash:now.reviewHash,paymentSource:'synthetic-source'});
  assert.equal(r.status,409);assert.equal((await r.json()).error,'TERMS_REACCEPT_REQUIRED');assert.equal(calls.length,1);assert.equal(await attempts(d.booking!.id),0);
 });
 await check('a revoked session can no longer read or change its draft',async()=>{
  const other=await x.login('flow-actor@example.invalid'),c=client(other.identity.sessionId);await ok(await c.post('/context',{}));
  await x.db.pool.query('DELETE FROM auth_session WHERE id=$1',[other.identity.sessionId]);
  const r=await c.get('/draft');assert.equal(r.status,403);assert.equal((await c.post('/restart',{})).status,403);
 });
 console.log(JSON.stringify({suite:'staff-order-postgres',passed,localPostgres:true,productionIdentityLookup:'TEST_DOUBLE_ONLY',paymentGateway:'TEST_DOUBLE_ONLY',externalCalls:0}));
}catch(error){failed=true;console.error(JSON.stringify({stage,code:(error as {code?:string}).code??(error as Error).name}));if(error instanceof assert.AssertionError)console.error(error.message);console.error((error as Error).stack?.split('\n').filter(l=>l.includes('/tests/operations/staff-order')).join('\n'));}
finally{await x.close();identityMock.restore();if(failed)process.exitCode=1;}
