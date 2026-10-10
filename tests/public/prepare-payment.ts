import {syntheticLegalReady} from '../fixtures/approved-legal';
import assert from 'node:assert/strict';
import {mock} from 'node:test';
import type {ProductionConfiguration} from '../../packages/auth/src/production-config';
import type {GuestBookingService as GuestService} from '../../packages/core/src/guest/service';
import type {PaymentRequest,PaymentObservation} from '../../packages/contracts/src/rental-flow';
// Only the already-issued identity lookup is a local test double. No test issuer,
// host override or relaxed gate is added to product code. The real issuer's reject
// tests remain independent; actual pinned-host admission requires hosted acceptance.
const identity=Object.freeze({kind:'EXACT_PRODUCTION_IDENTITY' as const});let config:Readonly<ProductionConfiguration>;
const identityModule=await import('../../packages/auth/src/production-identity');
const identityMock=mock.module(new URL('../../packages/auth/src/production-identity.ts',import.meta.url).href,{namedExports:{...identityModule,exactProductionIdentityConfiguration:(value:unknown)=>value===identity?config:identityModule.exactProductionIdentityConfiguration(value as never)}});
const {normalProductionFixture}=await import('../readiness/normal-production-fixture');
const {productionConfiguration}=await import('../../packages/auth/src/production-config');
const {issueCommercialPriceAuthority}=await import('../../packages/core/src/pricing/commercial-price-authority');
const {GuestContexts}=await import('../../packages/core/src/guest/context');
const {GuestBookingService}=await import('../../packages/core/src/guest/service');
const {guestHandler}=await import('../../apps/web/src/lib/guest-http');
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
type Draft=Awaited<ReturnType<GuestService['get']>>;
try{
 const original=productionConfiguration(x.input().configuration);
 config=productionConfiguration({...original,flags:{...original.flags,payment:true},payment:{provider:'SQUARE',environment:'PRODUCTION',merchantId:'SYNTHETIC-PREPARE-MERCHANT',locations:{MOUNTAIN_BASE:'SYNTHETIC-MOUNTAIN',ONSEN_BASE:'SYNTHETIC-ONSEN'}}});
 // The development flow role lacks the commercial book read used by source(); the
 // existing Production operations plan already grants it. Add it only in this owned fixture.
 await x.db.pool.query(`GRANT SELECT ON price_books TO ${x.flow.flowDb.user}`);
 const authority=issueCommercialPriceAuthority(identity),calls:PaymentRequest[]=[];
 const gateway={kind:'SQUARE_PRODUCTION' as const,async create(r:PaymentRequest):Promise<PaymentObservation>{calls.push(r);return {providerId:'synthetic-'+r.attemptId,referenceId:r.bookingId,idempotencyKey:r.idempotencyKey,merchantId:r.merchantId,locationId:r.locationId,amountJpy:r.amountJpy,currency:'JPY',status:'PENDING',updatedAt:x.now().toISOString(),completedAt:null};},async lookup(){throw Error('UNEXPECTED_PROVIDER_LOOKUP');}};
 const ledger=new LedgerService(x.roles.ledgerPool,ledgerPrincipal(x.principal),(c,s,a)=>verifyLedgerWrite(c,x.roles.authPool,x.signed.identity,s,a),(r,id,v)=>reconcileLedgerProtection(x.roles.transferPool,x.roles.authPool,x.signed.identity,r,id,v));
 const stock=await registerWear(ledger,new WearService(x.flow.flowPool,x.roles.authPool,x.signed.identity));
 const variants=await x.holds.recommendationCatalog(),catalog={revision:'synthetic-prepare',models:[],sizes:variants.filter(v=>['WEAR_JACKET','WEAR_PANTS'].includes(v.family)).map(v=>({key:v.id,label:v.size,variant:v}))};
 const contexts=new GuestContexts(x.guestRole.guestPool),origin='https://synthetic-prepare.invalid';
 const api=guestHandler(contexts,actor=>{const holds=new HoldService(x.roles.holdPool,actor),quotes=new QuoteService(x.roles.pricingPool,actor,undefined,authority),recommendations=new RecommendationService(x.roles.recommendationPool,actor,holds,quotes),booking=new BookingService(x.flow.flowPool,x.guestRole.guestPool,actor,gateway,null,identity);return new GuestBookingService(contexts,actor,recommendations,booking,async()=>catalog,undefined,syntheticLegalReady);},origin);
 let serial=3;
 async function fixture(){
  const c=await api(new Request(origin+'/api/guest/context',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'}));assert.equal(c.status,201);
  const cookie=c.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');let d=(await c.json()).draft as Draft;
  const post=(path:string,body:unknown)=>api(new Request(origin+'/api/guest'+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(body)}));
  const day='2035-02-'+String(serial++).padStart(2,'0'),input={pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:{startDate:day,endDate:day,slot:'DAY'},members:[{key:'person-1',sport:'WEAR',heightCm:null,footCm:null,adultAtStart:true,tier:'STANDARD',ski:null,poleSize:null,premiumModel:null,jacketSize:stock.selection.jacketVariantId,pantsSize:stock.selection.pantsVariantId,wearSport:'SKI'}]};
  for(const [path,body] of [['/draft',{draftId:d.id,expectedRevision:d.revision,input}],['/preview',null],['/selection',null]] as const){const response=await post(path,body??{draftId:d.id,expectedRevision:d.revision,...(path==='/selection'?{directions:{'person-1':'RECOMMENDED'},wantAdvance:false,couponCode:null,acceptedModelPolicy:true}:{})});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));d=await response.json() as Draft;}
  const body={draftId:d.id,expectedRevision:d.revision,reviewHash:d.reviewHash,locale:'en',contact:{displayName:'SYNTHETIC Prepare',email:'synthetic-prepare@example.invalid',termsAccepted:true}};
  const counts=async()=>(await x.db.pool.query(`SELECT (SELECT count(*)::int FROM inventory_holds WHERE owner_id=g.actor_id) holds,(SELECT count(*)::int FROM price_quotes WHERE actor=g.actor_id) quotes,(SELECT count(*)::int FROM rental_bookings WHERE owner_id=g.actor_id) bookings,(SELECT count(*)::int FROM rental_payment_attempts WHERE actor=g.actor_id) attempts FROM guest_drafts d JOIN guest_contexts g ON g.id=d.context_id WHERE d.id=$1`,[d.id])).rows[0];
  const rows=async()=>(await x.db.pool.query(`SELECT b.id,b.hold_id,b.quote_id,b.state,b.mode,q.expires_at quote_expires,h.expires_at hold_expires,q.snapshot,q.snapshot_sha256 FROM guest_drafts d JOIN rental_bookings b ON b.id=d.booking_id JOIN price_quotes q ON q.id=b.quote_id JOIN inventory_holds h ON h.id=b.hold_id WHERE d.id=$1`,[d.id])).rows[0];
  return {post,body,counts,rows};
 }
 const f=await fixture();
 await check('payment material, stale revision and wrong reviewHash reject before stock mutation',async()=>{
  for(const extra of [{paymentSource:'synthetic-source'},{paid:true},{providerId:'synthetic-id'},{status:'COMPLETED'},{providerObservation:{status:'COMPLETED'}}])assert.equal((await f.post('/prepare-payment',{...f.body,...extra})).status,422);
  for(const [patch,code] of [[{expectedRevision:f.body.expectedRevision-1},'STALE_DRAFT'],[{reviewHash:'wrong'},'PRICE_REVIEW_REQUIRED']] as const){const r=await f.post('/prepare-payment',{...f.body,...patch});assert.equal(r.status,409);assert.equal((await r.json()).error,code);}
  assert.deepEqual(await f.counts(),{holds:0,quotes:0,bookings:0,attempts:0});assert.equal(calls.length,0);
 });
 await check('commercial prepare creates one real PG HOLD/approved quote/DRAFT booking, zero attempts/provider calls',async()=>{
  const r=await f.post('/prepare-payment',f.body);assert.equal(r.status,200,JSON.stringify(await r.clone().json()));const d=await r.json() as Draft;
  assert.equal(d.booking!.state,'DRAFT');assert.equal(d.booking!.mode,'SQUARE_PRODUCTION');assert.equal(d.hold!.state,'ACTIVE');assert.equal(d.quote!.chargeReady,true);assert.equal(d.quote!.snapshot.currency,'JPY');assert.equal((d.quote!.snapshot.commercialApproval as {revision:number}).revision,2);
  assert.deepEqual(await f.counts(),{holds:1,quotes:1,bookings:1,attempts:0});assert.equal(calls.length,0);
 });
 await check('identical concurrent prepare reuses IDs and TTL; changed contact/locale refuse',async()=>{
  const before=await f.rows();for(const r of await Promise.all([f.post('/prepare-payment',f.body),f.post('/prepare-payment',f.body)]))assert.equal(r.status,200);
  assert.deepEqual(await f.rows(),before);assert.deepEqual(await f.counts(),{holds:1,quotes:1,bookings:1,attempts:0});
  for(const patch of [{locale:'ja'},{contact:{...f.body.contact,displayName:'SYNTHETIC Changed'}}]){const r=await f.post('/prepare-payment',{...f.body,...patch});assert.equal(r.status,409);assert.equal((await r.json()).error,'IDEMPOTENCY_MISMATCH');}assert.equal(calls.length,0);
 });
 await check('checkout still requires source, then reuses preparation and calls gateway exactly once',async()=>{
  const before=await f.rows();assert.equal((await f.post('/checkout',f.body)).status,422);assert.equal((await f.post('/checkout',{...f.body,paymentSource:'CASH'})).status,422);assert.equal(calls.length,0);
  const body={...f.body,paymentSource:'synthetic-source'};for(let n=0;n<2;n++){const r=await f.post('/checkout',body);assert.equal(r.status,200,JSON.stringify(await r.clone().json()));}
  const after=await f.rows();for(const key of ['id','hold_id','quote_id','hold_expires','quote_expires','snapshot_sha256'])assert.deepEqual(after[key],before[key]);
  assert.deepEqual(await f.counts(),{holds:1,quotes:1,bookings:1,attempts:1});assert.equal(calls.length,1);
  const preparedAfterPayment=await f.post('/prepare-payment',f.body);assert.equal(preparedAfterPayment.status,409);assert.equal((await preparedAfterPayment.json()).error,'PAYMENT_RECONCILIATION_REQUIRED');assert.equal(calls.length,1);
 });
 await check('expired prepared quote/HOLD refuse both prepare and checkout without extension/provider call',async()=>{
  const expired=await fixture();assert.equal((await expired.post('/prepare-payment',expired.body)).status,200);const before=await expired.rows();await x.clock(new Date(Math.max(before.hold_expires.getTime(),before.quote_expires.getTime())+1000).toISOString());
  for(const [path,body] of [['/prepare-payment',expired.body],['/checkout',{...expired.body,paymentSource:'synthetic-source'}]] as const){const r=await expired.post(path,body);assert.equal(r.status,409);assert.equal((await r.json()).error,'HOLD_OR_QUOTE_NOT_USABLE');}
  assert.deepEqual(await expired.rows(),before);assert.deepEqual(await expired.counts(),{holds:1,quotes:1,bookings:1,attempts:0});assert.equal(calls.length,1);
 });
 console.log(JSON.stringify({suite:'prepare-payment',passed,localPostgres:true,productionIdentityLookup:'TEST_DOUBLE_ONLY',externalCalls:0}));
}catch(error){failed=true;console.error(JSON.stringify({stage,code:(error as {code?:string}).code??(error as Error).name}));if(error instanceof assert.AssertionError)console.error(error.message);console.error((error as Error).stack?.split('\n').filter(l=>l.includes('/tests/public/prepare-payment')).join('\n'));}
finally{await x.close();identityMock.restore();if(failed)process.exitCode=1;}
