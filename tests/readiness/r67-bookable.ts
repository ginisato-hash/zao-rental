// R67 real disposable PostgreSQL acceptance: Production-shaped catalog (WEAR only, no physical
// ski/board/boot/pole stock) + the accepted Source A/B provisional payloads + the R67 bridge.
// Proves provisional capacity -> catalog variant -> recommendation -> HOLD -> quote, the +1.0 cm
// boot rule, POLE capacity, V1.4 multiple individual items, Premium model-bound capacity and the
// physical-handoff gate. Synthetic people only; no Square, no mail.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {migrate} from '../../packages/db/src/index';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {provisionApplicationRoles} from '../../scripts/application-roles';
import {provisionFlowRole} from '../../scripts/flow-roles';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {createStaffAuth,loadStaff} from '../../packages/auth/src/staff-auth';
import {writeAccount} from '../../packages/auth/src/accounts';
import {authHandler} from '../../apps/web/src/lib/auth-http';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import {RecommendationService} from '../../packages/core/src/recommendation/recommendation-service';
import {CustodyService} from '../../packages/core/src/rental/custody-service';
import {provisionalCapacity} from '../../packages/core/src/inventory/provisional-capacity';
import {activateProvisionalCatalog,PREMIUM_MODELS,type PremiumModelSpec} from '../../packages/core/src/operations/provisional-catalog-bridge';
import {provisionalPremiumModels} from '../../packages/core/src/content/public-catalog';
import {boundarySlot,type HoldConditions} from '../../packages/contracts/src/hold';
import {FakeGateway,simulation} from '../flow/fixture';
import {recordSyntheticBookingProfile} from '../custody/preparation-fixture';

let failed=false,stage='fixture',count=0;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const db=await startIsolatedPostgres();
let roles:Awaited<ReturnType<typeof provisionApplicationRoles>>|undefined,flow:Awaited<ReturnType<typeof provisionFlowRole>>|undefined,ops:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined;
try{
 await migrate(db.pool);
 roles=await provisionApplicationRoles(db.pool,db.identity);flow=await provisionFlowRole(db.pool,db.identity);ops=await provisionOperationsRole(db.pool,db.identity);
 const now=new Date('2035-01-10T10:00:00+09:00');
 await db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${now.toISOString()}'::timestamptz$$`);
 const password=randomBytes(24).toString('base64url'),origin='http://127.0.0.1:34567';
 const root=await bootstrapDevelopmentAdmin(db.pool,{email:'r67-root@example.invalid',displayName:'SYNTHETIC Admin',password}),bp=(await loadStaff(db.pool,root))!;
 const perms={BOOKING_VIEW:true,BOOKING_CREATE:true,RENTAL_CHECKOUT:true,RENTAL_RETURN:true,INVENTORY_VIEW:true,INVENTORY_EDIT:true,HOLD_VIEW:true,HOLD_EDIT:true,QUOTE_VIEW:true,QUOTE_CREATE:true,PRICE_EDIT:true,TRANSFER_VIEW:true,TRANSFER_PLAN:true,TRANSFER_DISPATCH:true,TRANSFER_RECEIVE:true,INVENTORY_BUFFER_OVERRIDE:true} as const;
 const actor=(await writeAccount(roles.authPool,bp,undefined,{email:'r67-actor@example.invalid',password,displayName:'SYNTHETIC Creator',active:true,role:'ADMIN',scope:'ALL',storeIds:[],permissions:perms})).id!,principal=(await loadStaff(db.pool,actor))!;
 const auth=createStaffAuth(roles.authPool,{origin,secret:randomBytes(32).toString('hex')}),handler=authHandler(auth,roles.authPool,origin,roles.authPool);
 const signIn=await handler(new Request(origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'r67-actor@example.invalid',password})}));assert.equal(signIn.status,200);
 const sessionId=(await db.pool.query('SELECT id FROM auth_session WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',[actor])).rows[0].id as string,identity={subject:actor,sessionId};
 const holds=new HoldService(roles.holdPool,principal,()=>now),quotes=new QuoteService(roles.pricingPool,principal,()=>now),recs=new RecommendationService(roles.recommendationPool,principal,holds,quotes);
 const fake=new FakeGateway(()=>now),bookings=new BookingService(flow.flowPool,roles.authPool,identity,fake,simulation);
 await quotes.initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 async function asOwner<T>(reason:string,fn:(c:import('pg').PoolClient)=>Promise<T>){const c=await db.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason',$2,true)",[actor,reason]);const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 // Production-shaped WEAR catalog (the only variants Production has today).
 const wear=await asOwner('SYNTHETIC R67 wear catalog',async c=>{const out:Record<string,string>={};for(const family of ['WEAR_JACKET','WEAR_PANTS']){const m=(await c.query("INSERT INTO ledger_models(code,name,brand,family,notes,source_kind,source_document,source_locator,catalog_season) VALUES($1,$1,'SYNTHETIC',$2,'','SYNTHETIC','tests/readiness/r67-bookable.ts',$1,'2026/27') RETURNING id",['R67-'+family.replace('_','-'),family])).rows[0].id;out[family]=(await c.query("INSERT INTO ledger_variants(model_id,family,age,tier,size,compatible_sports,notes,source_kind,source_document,source_locator) VALUES($1,$2,'ADULT','STANDARD','M',ARRAY['SKI','SNOWBOARD'],'','SYNTHETIC','tests/readiness/r67-bookable.ts',$3) RETURNING id",[m,family,'v-'+family])).rows[0].id;}return out;});
 const payload=(name:string)=>JSON.parse(readFileSync('docs/execution/provisional-booking-capacity/ACTIVATION_PAYLOAD_SOURCE_'+name+'.json','utf8')) as {sourceSha256:string;originalFilename:string;buckets:{family:string;age:string;sourceSize:string;bookingSize:string|null;quantity:number;provenance:string}[]};
 const counts=async()=>(await db.pool.query(`SELECT (SELECT count(*) FROM ledger_assets)::int assets,(SELECT count(*) FROM ledger_poles)::int poles,(SELECT count(*) FROM ledger_variants WHERE family LIKE 'WEAR%')::int wear,(SELECT coalesce(sum(provisional_capacity_effective_quantity(b.id)),0)::int FROM provisional_capacity_buckets b JOIN provisional_capacity_sources s ON s.id=b.source_id WHERE s.source_sha256=ANY($1::text[])) ab`,[['5ff5ce67c8ec1afbfab6bc5beeab0a2a725b73db0e1958a02860a0db39fbe1f4','c85997f464e59c616c6afb18ce03a34f6a73371d1aebeba2a6b8229bfd9c2257']])).rows[0];
 let before:Record<string,number>={};
 await check('A0 accepted Source A/B registered exactly as committed; 0058 canonical key',async()=>{
  await asOwner('SYNTHETIC R67 source registration',async c=>{for(const n of ['A','B']){const p=payload(n);await c.query('SELECT provisional_capacity_register_source($1,$2,$3::jsonb)',[p.sourceSha256,p.originalFilename,JSON.stringify(p.buckets.map(b=>({family:b.family,age:b.age,source_size:b.sourceSize,booking_size:b.bookingSize,size_mapping_status:b.bookingSize===null?'UNRESOLVED':'MAPPED',quantity:b.quantity,provenance:b.provenance})))]);}});
  before=await counts();
  for(const [f,s,k] of [['SNOWBOARD','145','145 cm'],['SNOWBOARD','145 cm','145 cm'],['SKI_BOOT','25/25.5','25/25.5 cm'],['SKI_BOOT','25.5','25.5 cm'],['SNOWBOARD_BOOT','26.5 cm','26.5 cm'],['SKI_BOOT','22X','22X'],['WEAR_JACKET','M','M']])assert.equal((await db.pool.query('SELECT provisional_size_key($1,$2) k',[f,s])).rows[0].k,k);
 });
 let report:Awaited<ReturnType<typeof activateProvisionalCatalog>>;
 // Owner (2026-10-15): Salomon has not confirmed the Premium models; every Source A row is Regular stock.
 // The Production activation binds no Premium model. The model-bound mechanism is proven below against a
 // separate test-only synthetic Premium source (never Source A/B).
 const TEST_PREMIUM_SHA='7e57'+'0'.repeat(60);
 const TEST_PREMIUM:PremiumModelSpec[]=[
  {code:'TEST-PREM-SB-ALPHA',name:'TEST ALPHA',family:'SNOWBOARD',itemCode:'SYNTHETIC',sourceSha256:TEST_PREMIUM_SHA,rows:[[1,150,4],[2,155,4]]},
  {code:'TEST-PREM-SB-BETA',name:'TEST BETA',family:'SNOWBOARD',itemCode:'SYNTHETIC',sourceSha256:TEST_PREMIUM_SHA,rows:[[3,140,2]]},
  {code:'TEST-PREM-SKI-GAMMA',name:'TEST GAMMA',family:'SKI',itemCode:'SYNTHETIC',sourceSha256:TEST_PREMIUM_SHA,rows:[[4,153,3],[5,160,3]]}];
 await check('A1 Production activation: Regular catalog for SKI/SNOWBOARD/boots + adult POLE, NO Premium binding (Owner), fake physical assets 0, WEAR unchanged, Source A/B quantities unchanged, idempotent',async()=>{
  report=await asOwner('R67 provisional catalog bridge',c=>activateProvisionalCatalog(c));
  assert.equal(report.poleSourceRegistered,true);assert.ok(report.regularVariants.SKI&&report.regularVariants.SNOWBOARD&&report.regularVariants.SKI_BOOT&&report.regularVariants.SNOWBOARD_BOOT&&report.regularVariants.POLE===5);
  assert.deepEqual(report.premiumVariants,{});assert.equal(report.bindingsCreated,0);assert.equal(PREMIUM_MODELS.length,0);
  assert.deepEqual(await provisionalPremiumModels(db.pool),[],'no Premium model is offered before Salomon confirms it');
  const after=await counts();assert.deepEqual(after,before,'no fake assets/poles; WEAR and Source A/B quantities unchanged');
  // canonical lexical duplicates collapse to one Regular variant (Source A "145" + Source B "145 cm")
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM ledger_variants WHERE family='SNOWBOARD' AND age='ADULT' AND tier='REGULAR' AND size='145 cm'")).rows[0].n,1);
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM ledger_models WHERE catalog_role='PROVISIONAL_BOOKING_SELECTOR'")).rows[0].n,5);
  const again=await asOwner('R67 provisional catalog bridge rerun',c=>activateProvisionalCatalog(c));assert.deepEqual([again.poleSourceRegistered,again.modelsCreated,again.variantsCreated,again.bindingsCreated],[false,0,0,0]);
  await assert.rejects(asOwner('bad binding',async c=>{const v=(await c.query("SELECT id FROM ledger_variants WHERE tier='REGULAR' AND family='SNOWBOARD' LIMIT 1")).rows[0].id,b=(await c.query("SELECT id FROM provisional_capacity_buckets WHERE family='SNOWBOARD' LIMIT 1")).rows[0].id;await c.query('INSERT INTO provisional_model_bindings(variant_id,bucket_id,quantity,provenance,actor) VALUES($1,$2,1,$3,$4)',[v,b,'bad',actor]);}),/PROVISIONAL_MODEL_BINDING_INVALID/);
 });
 await check('A1b mechanism: a separate synthetic Premium source binds each model length only to its own bucket; idempotent',async()=>{
  await asOwner('SYNTHETIC R67 premium test source',async c=>{await c.query('SELECT provisional_capacity_register_source($1,$2,$3::jsonb)',[TEST_PREMIUM_SHA,'SYNTHETIC R67 premium test source',JSON.stringify(TEST_PREMIUM.flatMap(m=>m.rows.map(([,l,q])=>({family:m.family,age:'ADULT',source_size:String(l),booking_size:l+' cm',size_mapping_status:'MAPPED',quantity:q,provenance:'SYNTHETIC '+m.code}))))]);});
  const r=await asOwner('R67 bridge with synthetic premium',c=>activateProvisionalCatalog(c,TEST_PREMIUM));
  assert.deepEqual(r.premiumVariants,{'TEST-PREM-SB-ALPHA':2,'TEST-PREM-SB-BETA':1,'TEST-PREM-SKI-GAMMA':2});assert.equal(r.bindingsCreated,5);
  const bad=(await db.pool.query(`SELECT count(*)::int n FROM provisional_model_bindings x JOIN provisional_capacity_buckets b ON b.id=x.bucket_id JOIN provisional_capacity_sources s ON s.id=b.source_id JOIN ledger_variants v ON v.id=x.variant_id WHERE s.source_sha256<>$1 OR provisional_size_key(b.family,b.booking_size)<>v.size OR x.quantity<>b.quantity`,[TEST_PREMIUM_SHA])).rows[0].n;assert.equal(bad,0);
  const models=await provisionalPremiumModels(db.pool);assert.deepEqual(models.map(m=>[m.name,m.sport,m.lengths.join('/')]).sort(),[['TEST ALPHA','SNOWBOARD','150 cm/155 cm'],['TEST BETA','SNOWBOARD','140 cm'],['TEST GAMMA','SKI','153 cm/160 cm']]);
  const again=await asOwner('rerun',c=>activateProvisionalCatalog(c,TEST_PREMIUM));assert.equal(again.bindingsCreated,0);
 });
 const period=(startDate:string,endDate=startDate,startAt:'08:30'|'13:00'='08:30',returnBy:'12:00'|'17:00'='17:00')=>({startDate,endDate,slot:boundarySlot(startDate,endDate,startAt,returnBy),startAt,returnBy});
 const adultSki={weightKg:65,ageAtStart:30,skierType:'TYPE_II'},kidSki={weightKg:25,ageAtStart:8,skierType:'TYPE_I'};
 let dayN=10;const nextDay=()=>'2035-02-'+String(dayN++).padStart(2,'0');
 type M=Record<string,unknown>;
 const member=(o:M):M=>({key:'p',sport:'SKI',heightCm:170,footCm:null,adultAtStart:true,tier:'REGULAR',ski:null,poleVariantId:null,...o});
 async function book(m:M,date=nextDay(),p=period(date)){
  const input={contractVersion:'INTEGRATED_V1_4',pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:p,members:[m]};
  const preview=await recs.preview(randomUUID(),input,null);const offered=preview.preview.offered[0]!;
  assert.ok(offered.candidates.RECOMMENDED,'candidate for '+JSON.stringify(m)+' reason='+offered.reason);
  const result=await recs.select(preview.preview.id,randomUUID(),{directions:{[String(m.key)]:'RECOMMENDED'},wantAdvance:false,couponCode:null,acceptedModelPolicy:true});
  assert.equal(result.selection?.stage,'COMPLETE','selection '+result.selection?.outcome);
  const claims=(await db.pool.query('SELECT requirement_key,promise_variant_id FROM provisional_capacity_claims WHERE hold_id=$1 AND state=$2 ORDER BY requirement_key',[result.hold!.id,'ACTIVE'])).rows;
  return {offered,hold:result.hold!,quote:result.quote!,claims,candidate:offered.candidates.RECOMMENDED!};
 }
 const families=(r:{candidate:{member:HoldConditions['members'][number]}})=>r.candidate.member.items.map(i=>i.family).sort().join('+');
 await check('B1 Adult Ski Regular set -> candidates -> HOLD -> quote (provisional SKI + SKI_BOOT, accessory pole)',async()=>{const r=await book(member({footCm:26,ski:adultSki}));assert.equal(families(r),'POLE+SKI+SKI_BOOT');assert.deepEqual(r.claims.map(c=>c.requirement_key),['p:SKI','p:SKI_BOOT']);assert.ok(Number(r.quote.snapshot.totalJpy)>0);});
 await check('B2 Adult Snowboard Regular set',async()=>{const r=await book(member({sport:'SNOWBOARD',footCm:26}));assert.equal(families(r),'SNOWBOARD+SNOWBOARD_BOOT');assert.equal(r.claims.length,2);});
 await check('B3 Kids Ski Regular set',async()=>{const r=await book(member({heightCm:125,footCm:20,adultAtStart:false,ski:kidSki}));assert.equal(r.candidate.member.age,'KIDS');assert.equal(r.claims.length,2);});
 await check('B4 Kids Snowboard Regular set',async()=>{const r=await book(member({sport:'SNOWBOARD',heightCm:130,footCm:21,adultAtStart:false}));assert.equal(r.candidate.member.age,'KIDS');assert.equal(r.claims.length,2);});
 await check('B5 Ski boot-only: foot 24.5 -> target 25.5 -> shell 25/25.5 bucket -> HOLD',async()=>{const r=await book(member({heightCm:null,footCm:24.5,items:['SKI_BOOT']}));assert.equal(r.offered.bootCm,25.5);assert.equal(r.candidate.sizeLabel,'25/25.5 cm');assert.deepEqual(r.claims.map(c=>c.requirement_key),['p:SKI_BOOT']);});
 await check('B6 Snowboard boot-only: foot 24.0 -> target 25.0 -> the 25/25.5 shell containing the target beats the exact 24.5/25.5 boots; the equal-distance larger 25.5 outranks the smaller neighbour',async()=>{const r=await book(member({sport:'SNOWBOARD',heightCm:null,footCm:24,items:['SNOWBOARD_BOOT']}));assert.equal(r.offered.bootCm,25);assert.equal(r.candidate.sizeLabel,'25/25.5 cm');assert.equal(r.offered.candidates.LONGER?.sizeLabel,'25.5 cm');assert.ok(r.offered.candidates.SHORTER&&r.offered.candidates.SHORTER.lengthCm<25);});
 await check('B7 one person: individual ski + pole (V1.4), each line priced from its own key',async()=>{const r=await book(member({ski:adultSki,items:['SKI','POLE']}));assert.equal(r.candidate.member.product,'SINGLE');assert.equal(families(r),'POLE+SKI');assert.deepEqual(r.claims.map(c=>c.requirement_key),['p:POLE','p:SKI']);assert.deepEqual((r.quote.snapshot.items as {productKey:string}[]).map(i=>i.productKey).sort(),['SKI_EQUIPMENT_ONLY_ADULT_REGULAR','SKI_POLES_ONLY_ADULT_STANDARD']);});
 await check('B8 one person: individual ski + boot + pole',async()=>{const r=await book(member({footCm:26,ski:adultSki,items:['SKI','SKI_BOOT','POLE']}));assert.equal(families(r),'POLE+SKI+SKI_BOOT');assert.equal(r.claims.length,3);assert.equal((r.quote.snapshot.items as unknown[]).length,3);});
 await check('B9 one person: individual snowboard + boots',async()=>{const r=await book(member({sport:'SNOWBOARD',footCm:26,items:['SNOWBOARD','SNOWBOARD_BOOT']}));assert.equal(families(r),'SNOWBOARD+SNOWBOARD_BOOT');assert.deepEqual((r.quote.snapshot.items as {productKey:string}[]).map(i=>i.productKey).sort(),['SNOWBOARD_BOOTS_ONLY_ADULT_STANDARD','SNOWBOARD_EQUIPMENT_ONLY_ADULT_REGULAR']);});
 await check('B10 wear only',async()=>{const r=await book({key:'p',sport:'WEAR',heightCm:null,footCm:null,adultAtStart:true,tier:'STANDARD',ski:null,poleVariantId:null,wearSport:'SKI',wearSelection:{jacketVariantId:wear.WEAR_JACKET,pantsVariantId:wear.WEAR_PANTS}});assert.equal(r.candidate.member.product,'WEAR_SET');});
 const premium=async(code:string)=>{const m=(await provisionalPremiumModels(db.pool)).find(x=>x.slug===code.toLowerCase())!;return {modelId:m.modelId,season:m.season};};
 await check('B11 Premium Ski model/length promise -> model-bound claim (synthetic Premium source)',async()=>{const r=await book(member({heightCm:178,footCm:26,ski:adultSki,tier:'PREMIUM',modelSelection:await premium('TEST-PREM-SKI-GAMMA')}));const ski=r.candidate.member.items.find(i=>i.family==='SKI')!;assert.ok(ski.modelPromise);assert.equal(r.claims.find(c=>c.requirement_key==='p:SKI')!.promise_variant_id,ski.modelPromise!.variantId);assert.equal(r.claims.find(c=>c.requirement_key==='p:SKI_BOOT')!.promise_variant_id,null,'boots come from the common pool, no model promise');});
 await check('B12 Premium Snowboard model A (synthetic Premium source)',async()=>{const r=await book(member({sport:'SNOWBOARD',heightCm:170,footCm:26,tier:'PREMIUM',modelSelection:await premium('TEST-PREM-SB-ALPHA')}));const b=r.candidate.member.items.find(i=>i.family==='SNOWBOARD')!;assert.equal(r.candidate.lengthCm,150);assert.equal(r.claims.find(c=>c.requirement_key==='p:SNOWBOARD')!.promise_variant_id,b.modelPromise!.variantId);});
 await check('B13 Premium Snowboard model B (synthetic Premium source)',async()=>{const r=await book(member({sport:'SNOWBOARD',heightCm:158,footCm:24,tier:'PREMIUM',modelSelection:await premium('TEST-PREM-SB-BETA')}));assert.equal(r.candidate.lengthCm,140);assert.ok(r.claims.find(c=>c.requirement_key==='p:SNOWBOARD')!.promise_variant_id);});
 // Direct planner proofs on a fixed day: fill exact buckets with synthetic live claims.
 const fillDay='2035-03-20';
 async function fill(bucketId:string,n:number){await asOwner('SYNTHETIC R67 capacity fill',async c=>{for(let i=0;i<n;i++){const res=randomUUID(),hold=randomUUID();await c.query('INSERT INTO inventory_reservations(id,owner_id) VALUES($1,$2)',[res,actor]);await c.query(`INSERT INTO inventory_holds(id,reservation_id,owner_id,pickup_store,return_store,conditions,starts_at,due_at,occupancy_start,occupancy_end,expires_at,state,payment_state) VALUES($1,$2,$3,'MOUNTAIN_BASE','MOUNTAIN_BASE','{}'::jsonb,$4,$5,$6,$6,$5,'ACTIVE','SUCCESS')`,[hold,res,actor,fillDay+'T08:30:00+09:00',fillDay+'T17:00:00+09:00',fillDay]);await c.query('INSERT INTO provisional_capacity_claims(hold_id,requirement_key,bucket_id,day,quantity) VALUES($1,$2,$3,$4,1)',[hold,'fill:'+i,bucketId,fillDay]);}});}
 const bucket=async(sha:string,family:string,size:string)=>(await db.pool.query('SELECT b.id FROM provisional_capacity_buckets b JOIN provisional_capacity_sources s ON s.id=b.source_id WHERE s.source_sha256=$1 AND b.family=$2 AND provisional_size_key(b.family,b.booking_size)=$3',[sha,family,size])).rows[0].id as string;
 const variant=async(code:string,size:string)=>(await db.pool.query('SELECT v.id FROM ledger_variants v JOIN ledger_models m ON m.id=v.model_id WHERE m.code=$1 AND v.size=$2',[code,size])).rows[0].id as string;
 await check('B14 a Premium promise cannot consume another model or the generic Regular buckets: model B 140 exhausted -> Premium B 140 infeasible while Regular 140 still feasible from Source A/B',async()=>{
  const lib140=await bucket(TEST_PREMIUM_SHA,'SNOWBOARD','140 cm');await fill(lib140,1);
  const c=await db.pool.connect();try{
   const prem=await provisionalCapacity(c,[{key:'x',family:'SNOWBOARD',age:'ADULT',bookingSize:'140 cm',promiseVariantId:await variant('TEST-PREM-SB-BETA','140 cm')}],[fillDay],now,null);assert.equal(prem.feasible,false);
   const reg=await provisionalCapacity(c,[{key:'x',family:'SNOWBOARD',age:'ADULT',bookingSize:'140'}],[fillDay],now,null);assert.equal(reg.feasible,true);assert.notEqual(reg.rows[0]!.bucket,lib140);
   const wc=await provisionalCapacity(c,[{key:'x',family:'SNOWBOARD',age:'ADULT',bookingSize:'140 cm',promiseVariantId:await variant('TEST-PREM-SB-ALPHA','150 cm')}],[fillDay],now,null);assert.equal(wc.feasible,false,'model A 150 binding never matches a 140 bucket');
  }finally{c.release();}
 });
 await check('B15 Regular and Premium share one ceiling: Regular claims on the model A 155 bucket leave no Premium model A 155 capacity; a direct over-claim is rejected by the DB guard',async()=>{
  const wc165=await bucket(TEST_PREMIUM_SHA,'SNOWBOARD','155 cm'),v=await variant('TEST-PREM-SB-ALPHA','155 cm');
  const c=await db.pool.connect();try{
   assert.equal((await provisionalCapacity(c,[{key:'x',family:'SNOWBOARD',age:'ADULT',bookingSize:'155 cm',promiseVariantId:v}],[fillDay],now,null,true)).feasible,true);
   await fill(wc165,4);
   assert.equal((await provisionalCapacity(c,[{key:'x',family:'SNOWBOARD',age:'ADULT',bookingSize:'155 cm',promiseVariantId:v}],[fillDay],now,null,true)).feasible,false);
  }finally{c.release();}
  await assert.rejects(fill(wc165,1),/PROVISIONAL_CAPACITY_EXCEEDED/);
 });
 await check('B16 a provisional-backed confirmed booking is blocked from physical handoff until materialized',async()=>{
  const r=await book(member({sport:'SNOWBOARD',footCm:26}),'2035-04-02');
  const booking=await bookings.create(randomUUID(),r.quote.id,{displayName:'SYNTHETIC Guest',email:'synthetic-guest@example.invalid',termsAccepted:true});await recordSyntheticBookingProfile(db.pool,booking.id);
  const paid=await bookings.startPayment(booking.id,randomUUID());assert.equal(paid.state,'CONFIRMED_DEV');
  const custody=new CustodyService(ops!.operationsPool,roles!.authPool,identity);const view=await custody.checkoutView(booking.id);
  await assert.rejects(custody.prepare(randomUUID(),{bookingId:booking.id,expectedBookingVersion:view.bookingVersion,expectedHoldVersion:view.holdVersion,selections:[{requirementKey:'p:SNOWBOARD',assetId:randomUUID(),poleId:null}],fitEvidence:'SYNTHETIC fit note'}),{code:'PROVISIONAL_PHYSICAL_ASSIGNMENT_REQUIRED'});
 });
 await check('A2 after the matrix: fake assets 0, pole stock untouched, Source A/B quantities unchanged, every Premium claim is bound',async()=>{
  assert.deepEqual(await counts(),before);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM provisional_capacity_claims c WHERE c.promise_variant_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM provisional_model_bindings x WHERE x.variant_id=c.promise_variant_id AND x.bucket_id=c.bucket_id)')).rows[0].n,0);
 });
 console.log(`R67 bookable real PostgreSQL: ${count} passed, no skipped. Synthetic people only.`);
}catch(e){failed=true;console.error('R67_BOOKABLE_FAILED '+stage+' '+((e as Error).stack??String(e)).slice(0,1500));}finally{await ops?.close();await flow?.close();await roles?.close();await db.stop();}
if(failed)process.exit(1);
