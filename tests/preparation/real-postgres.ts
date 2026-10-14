import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture,simulation} from '../flow/fixture';
import {seedInventory,fid,variants as fixtureVariants} from '../inventory/fixture';
import {seedRecommendation} from '../recommendation/fixture';
import {provisionGuestRole} from '../../scripts/guest-roles';
import {provisionCustodyRole} from '../../scripts/custody-roles';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {GuestContexts} from '../../packages/core/src/guest/context';
import {GuestBookingService,type GuestCatalog} from '../../packages/core/src/guest/service';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {RecommendationService} from '../../packages/core/src/recommendation/recommendation-service';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import {CustodyService} from '../../packages/core/src/rental/custody-service';
import {ManifestService} from '../../packages/core/src/operations/manifest-service';
import {writeAccount} from '../../packages/auth/src/accounts';
import {guestVariants} from '../../packages/core/src/content/public-catalog';
import {syntheticPreparation} from '../custody/preparation-fixture';
const x=await flowFixture('2035-01-01T10:00:00+09:00',false);let guest:Awaited<ReturnType<typeof provisionGuestRole>>|undefined,ops:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined,custodyRole:Awaited<ReturnType<typeof provisionCustodyRole>>|undefined,stage='setup';
try{
 await seedRecommendation(x.db.pool,true,false);guest=await provisionGuestRole(x.db.pool,x.db.identity);ops=await provisionOperationsRole(x.db.pool,x.db.identity);custodyRole=await provisionCustodyRole(x.db.pool,x.db.identity);
 await x.db.pool.query("SELECT set_config('zao.actor',$1,false),set_config('zao.reason','SYNTHETIC R65 physical metadata',false)",[x.actor]);
 // Deliberately no usable pole catalogue size. No fictitious variant or foot→BSL default.
 await x.db.pool.query("UPDATE ledger_assets SET bsl_status='RECORDED',bsl_mm=304,bsl_evidence='SYNTHETIC individually observed marking',version=version+1 WHERE family='SKI_BOOT'");
 const contexts=new GuestContexts(guest.guestPool),variants=await x.holds.recommendationCatalog();
 const catalog:GuestCatalog={revision:'r65-synthetic',models:[],sizes:[]};
 const custody=new CustodyService(custodyRole.custodyPool,x.roles.authPool,x.signed.identity),manifest=new ManifestService(ops.operationsPool,x.roles.authPool,x.signed.identity);
 const member={key:'person-1',itemFamily:null,sport:'SKI',heightCm:170,footCm:25.5,adultAtStart:true,tier:'REGULAR',ski:{weightKg:60,ageAtStart:30,skierType:'TYPE_I'},poleSize:null,premiumModel:null,jacketSize:null,pantsSize:null,wearSport:null};
 async function reserve(date:string,patch:Record<string,unknown>={},pay=true,store='MOUNTAIN_BASE',unavailable=false){
  const actor=await contexts.resolve((await contexts.create()).token),h=new HoldService(x.roles.holdPool,actor),q=new QuoteService(x.roles.pricingPool,actor),r=new RecommendationService(x.roles.recommendationPool,actor,h,q,async v=>guestVariants(catalog,v)),b=new BookingService(x.flow.flowPool,guest!.guestPool,actor,x.fake,simulation),s=new GuestBookingService(contexts,actor,r,b,async()=>catalog);
  let d=await s.get();const input={contractVersion:'INTEGRATED_V1_3',pickupStore:store,returnStore:store,period:{startDate:date,endDate:date,slot:'DAY'},members:[{...member,...patch}]};
  await assert.rejects(s.save({draftId:d.id,expectedRevision:d.revision,input:{...input,members:[{...input.members[0],poleSize:'forged-authoritative-pole'}]}}),{code:'INVALID_POLE_INPUT'});
  d=await s.save({draftId:d.id,expectedRevision:d.revision,input});d=await s.preview({draftId:d.id,expectedRevision:d.revision});if(unavailable){assert.equal(d.preview?.members[0]?.candidates.RECOMMENDED,null);assert.equal(d.preview?.members[0]?.price,null);await assert.rejects(s.choose({draftId:d.id,expectedRevision:d.revision,directions:{'person-1':'RECOMMENDED'},wantAdvance:false,couponCode:null,acceptedModelPolicy:true}));await assert.rejects(s.checkout({draftId:d.id,expectedRevision:d.revision,reviewHash:null,contact:{displayName:'SYNTHETIC Rejected',email:'synthetic-rejected@example.invalid',termsAccepted:true}}));return {s,d};}assert.ok(d.preview?.members[0]?.candidates.RECOMMENDED);assert.equal(d.hold,null);
  // A standalone pole sends no length choice: the server derives its single candidate and refuses any other.
  const pole=patch.itemFamily==='POLE';if(pole)for(const forged of ['LONGER','SHORTER'])await assert.rejects(s.choose({draftId:d.id,expectedRevision:d.revision,directions:{'person-1':forged},wantAdvance:false,couponCode:null,acceptedModelPolicy:true}),{code:'SELECTION_INVALID'});
  d=await s.choose({draftId:d.id,expectedRevision:d.revision,directions:pole?{}:{'person-1':'RECOMMENDED'},wantAdvance:false,couponCode:null,acceptedModelPolicy:true});if(pole)assert.deepEqual(d.selection?.directions,{'person-1':'RECOMMENDED'});
  if(pay)d=await s.checkout({draftId:d.id,expectedRevision:d.revision,reviewHash:d.reviewHash,contact:{displayName:'SYNTHETIC R65 Guest',email:'synthetic-r65@example.invalid',termsAccepted:true}});
  else{const selected=await r.select((await contexts.read(actor)).preview_id!,randomUUID(),{directions:{'person-1':'RECOMMENDED'},wantAdvance:false,couponCode:null,acceptedModelPolicy:true});await b.create(randomUUID(),selected.quote!.id,{displayName:'SYNTHETIC R65 Unpaid',email:'synthetic-unpaid@example.invalid',termsAccepted:true});}
  return {s,d};
 }
 stage='untouched or generic-level V1.3 input rejected by the server';{
  const actor=await contexts.resolve((await contexts.create()).token),h=new HoldService(x.roles.holdPool,actor),q=new QuoteService(x.roles.pricingPool,actor),r=new RecommendationService(x.roles.recommendationPool,actor,h,q,async v=>guestVariants(catalog,v)),s=new GuestBookingService(contexts,actor,r,null,async()=>catalog);
  const d=await s.get(),save=(patch:Record<string,unknown>)=>s.save({draftId:d.id,expectedRevision:d.revision,input:{contractVersion:'INTEGRATED_V1_3',pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:{startDate:'2035-01-02',endDate:'2035-01-02',slot:'DAY'},members:[{...member,...patch}]}});
  // The guest form's untouched state: nothing entered, so nothing authoritative to save.
  await assert.rejects(save({heightCm:null,footCm:null,ski:{weightKg:null,ageAtStart:null,skierType:null}}));
  for(const ski of [{weightKg:60,ageAtStart:30,skierType:null},{weightKg:null,ageAtStart:30,skierType:'TYPE_I'},{weightKg:60,ageAtStart:null,skierType:'TYPE_I'}])await assert.rejects(save({ski}),JSON.stringify(ski));
  await assert.rejects(save({heightCm:null}));await assert.rejects(save({footCm:null}));
  // The retired synthetic default (generic BEGINNER level, no declared skier type) is refused.
  await assert.rejects(save({ski:{weightKg:60,ageAtStart:30,level:'BEGINNER'}}),{code:'SKIER_TYPE_REQUIRED'});
  assert.equal((await s.get()).input,null);
 }
 console.log('PASS server refuses untouched null body/safety input and generic-level V1.3 ski profiles; nothing saved');
 stage='V1.3 no-pole-inventory booking';const booked=await reserve('2035-01-02'),id=booked.d.booking!.id;assert.equal(booked.d.booking!.state,'CONFIRMED_DEV');assert.equal(booked.d.booking!.priceSnapshot.totalJpy,7500);
 const row=(await x.db.pool.query('SELECT conditions,hold_id FROM rental_bookings WHERE id=$1',[id])).rows[0];assert.equal(row.conditions.contractVersion,'INTEGRATED_V1_3');assert.deepEqual(row.conditions.members[0].items.find((i:{family:string})=>i.family==='POLE').variantIds,[]);
 assert.equal((await x.db.pool.query('SELECT cardinality(variant_ids) n FROM inventory_pole_exemptions WHERE hold_id=$1 AND active',[row.hold_id])).rows[0].n,0);
 console.log('PASS public V1.3 full booking and durable empty pole witness; existing price; no customer pole input');
 stage='tomorrow inclusion and exclusions';await reserve('2035-01-02',{},false);const cancelled=await reserve('2035-01-02');const cancel=await cancelled.s.cancellationPreview();await cancelled.s.cancel({requestKey:randomUUID(),previewHash:(cancel as {previewHash:string}).previewHash});
 const query={store:'MOUNTAIN_BASE',date:null,section:'preparation',cursor:null,pageSize:100};
 let tomorrow=await manifest.manifest(query);assert.equal(tomorrow.date,'2035-01-02');assert.deepEqual(tomorrow.rows.map(r=>(r as Record<string,unknown>).bookingId),[id]);assert.equal((await manifest.manifest({...query,store:'ONSEN_BASE'})).rows.length,0);
 const restricted=(await writeAccount(x.roles.authPool,x.bp,undefined,{email:'prep-view@example.invalid',password:x.password,displayName:'SYNTHETIC View Only',active:true,role:'STAFF',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{BOOKING_VIEW:true,RENTAL_CHECKOUT:false}})).id!;assert.ok(restricted);const signed=await x.login('prep-view@example.invalid');await assert.rejects(new ManifestService(ops.operationsPool,x.roles.authPool,signed.identity).manifest(query),{code:'FORBIDDEN'});
 console.log('PASS Tokyo tomorrow queue includes paid/confirmed only; unpaid/cancelled/wrong store/permission excluded');
 stage='actual boot evidence and idempotency';let view=await custody.checkoutView(id);assert.equal(view.preparationMembers[0]?.bslMm,304);assert.equal(view.preparationMembers[0]?.din?.value,4.5);assert.equal(view.preparationMembers[0]?.profile?.footCm,25.5);
 const body=()=>({bookingId:id,expectedBookingVersion:view.bookingVersion,expectedHoldVersion:view.holdVersion,selections:view.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:syntheticPreparation(view)});
 const missing=body();missing.fitEvidence.members[0]!.bindingSetupConfirmed=false;await assert.rejects(custody.prepare(randomUUID(),missing),{code:'BINDING_CONFIRMATION_REQUIRED'});
 const forged=body();forged.fitEvidence.members[0]!.bootAssetId=randomUUID();await assert.rejects(custody.prepare(randomUUID(),forged),{code:'PREPARED_ASSIGNMENT_CHANGED'});
 const key=randomUUID(),input=body();input.fitEvidence.members[0]!.poleSelectedCm=115;view=await custody.prepare(key,input);assert.equal(view.preparationValid,true);await custody.prepare(key,input);assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM rental_preparations WHERE id=$1',[id])).rows[0].n,1);
 const evidence=view.preparation.fit_evidence;assert.equal(evidence.members[0].bslSource,'ASSET');assert.equal(evidence.members[0].confirmedBy,x.actor);assert.equal(evidence.members[0].confirmedAt,x.now().toISOString());assert.equal(evidence.members[0].dinReferenceValue,4.5);assert.equal(evidence.members[0].poleSelectedCm,115);
 tomorrow=await manifest.manifest(query);assert.equal(((tomorrow.rows[0] as Record<string,unknown>)?.pickup as {equipmentPrepared:boolean}).equipmentPrepared,true);
 console.log('PASS actual assigned 304 mm boot → DIN 4.5; server audit; physical pole override; duplicate prepare exactly once');
 stage='changed actual BSL invalidates ready and recalculates';const boot=view.items.find(i=>i.family==='SKI_BOOT')!;
 await x.db.pool.query("UPDATE ledger_assets SET bsl_mm=314,bsl_evidence='SYNTHETIC corrected actual marking',version=version+1 WHERE id=$1",[boot.asset_id]);
 view=await custody.checkoutView(id);assert.equal(view.preparationValid,false);assert.equal(view.preparationMembers[0]?.din?.value,4);await assert.rejects(custody.checkout(randomUUID(),{bookingId:id,expectedPreparationVersion:1}),{code:'PREPARED_ASSIGNMENT_CHANGED'});
 const renewed=await custody.prepare(randomUUID(),body());assert.equal(renewed.preparation.version,2);assert.equal(renewed.preparation.fit_evidence.members[0].bslMm,314);
 stage='day-of ready and checkout';await x.clock('2035-01-02T09:00:00+09:00');const today=await manifest.manifest({...query,date:null,section:'pickup'});assert.equal(((today.rows.find(r=>(r as Record<string,unknown>).bookingId===id) as Record<string,unknown>)?.pickup as {equipmentPrepared:boolean}).equipmentPrepared,true);
 const checked=await custody.checkout(randomUUID(),{bookingId:id,expectedPreparationVersion:2});assert.equal(checked.loans.length,2);assert.equal(checked.loans.find(l=>l.family==='SKI_BOOT').asset_id,boot.asset_id);
 console.log('PASS BSL 304→314 recalculates 4.5→4; invalidates old ready; renewed ready persists next day; exact assigned boot checkout');
 stage='standalone pole without catalogue or pool';
 const polePatch={itemFamily:'POLE',footCm:null,ski:null};
 const counts=async()=>(await x.db.pool.query('SELECT (SELECT count(*) FROM price_quotes)::int quotes,(SELECT count(*) FROM rental_bookings)::int bookings,(SELECT count(*) FROM rental_payment_attempts)::int payments')).rows[0];
 const before=await counts();await reserve('2035-02-05',polePatch,true,'MOUNTAIN_BASE',true);assert.deepEqual(await counts(),before);
 // Even a catalogue-only pole cannot get an exemption or a paid booking.
 await x.db.pool.query("INSERT INTO ledger_variants(id,model_id,family,age,tier,size,notes,source_kind,source_document,source_locator) VALUES($1,$2,'POLE','ADULT','REGULAR','110 cm','','SYNTHETIC','tests/preparation/real-postgres.ts','pole-variant')",[fixtureVariants.pole,fid(1003)]);
 await reserve('2035-02-05',polePatch,true,'MOUNTAIN_BASE',true);assert.deepEqual(await counts(),before);
 console.log('PASS standalone POLE rejects no catalogue and catalogue without pool; quote/booking/payment counts unchanged');
 stage='tracked standalone pole complete custody';await seedInventory(x.db.pool,false,true);await x.db.pool.query('UPDATE ledger_poles SET quantity=20,version=version+1 WHERE id=$1',[fid(1301)]);
 const poleBooking=(await reserve('2035-02-05',polePatch)).d.booking!;let pv=await custody.checkoutView(poleBooking.id);assert.equal(pv.items.length,1);assert.equal(pv.items[0]!.family,'POLE');assert.ok(pv.items[0]!.pole_id);
 const ph=(await x.db.pool.query('SELECT hold_id FROM rental_bookings WHERE id=$1',[poleBooking.id])).rows[0].hold_id;assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM inventory_pole_exemptions WHERE hold_id=$1 AND active',[ph])).rows[0].n,0);assert.ok((await x.db.pool.query('SELECT 1 FROM inventory_claims WHERE hold_id=$1 AND pole_id IS NOT NULL AND active',[ph])).rowCount);
 pv=await custody.prepare(randomUUID(),{bookingId:pv.bookingId,expectedBookingVersion:pv.bookingVersion,expectedHoldVersion:pv.holdVersion,selections:pv.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:syntheticPreparation(pv)});
 await assert.rejects(custody.checkout(randomUUID(),{bookingId:pv.bookingId,expectedPreparationVersion:pv.preparation.version}),{code:'FLOW_CONFLICT'});await x.clock('2035-02-05T09:00:00+09:00');
 const pc=await custody.checkout(randomUUID(),{bookingId:pv.bookingId,expectedPreparationVersion:pv.preparation.version});assert.equal(pc.loans.length,1);const loan=pc.loans[0]!;assert.equal(loan.family,'POLE');assert.equal(loan.state,'OUT');
 let batch=await custody.createBatch(randomUUID(),'MOUNTAIN_BASE');batch=await custody.scan(randomUUID(),{batchId:batch.id,expectedVersion:batch.version,assetId:null,poleLoanId:loan.id});assert.equal(batch.candidates.length,1);await custody.confirm(randomUUID(),{batchId:batch.id,expectedVersion:batch.version});
 await custody.inspection(randomUUID(),{loanItemId:loan.id,expectedVersion:2,store:'MOUNTAIN_BASE',evidence:'SYNTHETIC standalone pole physical inspection'});
 const terminal=(await x.db.pool.query('SELECT l.state,l.version,(SELECT count(*)::int FROM rental_custody_events WHERE loan_item_id=l.id) receipts,(SELECT count(*)::int FROM rental_inspection_events WHERE loan_item_id=l.id) inspections FROM rental_loan_items l WHERE id=$1',[loan.id])).rows[0];assert.equal(terminal.state,'RECEIVED');assert.equal(terminal.receipts,1);assert.equal(terminal.inspections,1);
 console.log('PASS standalone POLE preview→quote→paid booking→claim→preparation→exactly 1 POLE loan→scan→receipt→inspection '+JSON.stringify(terminal));
 stage='other individual products';for(const itemFamily of ['SKI','SKI_BOOT','SNOWBOARD','SNOWBOARD_BOOT']){const snowboard=itemFamily.startsWith('SNOWBOARD'),r=await reserve('2035-02-05',{itemFamily,sport:snowboard?'SNOWBOARD':'SKI',heightCm:itemFamily.endsWith('_BOOT')?null:170,footCm:itemFamily.endsWith('_BOOT')?25.5:null,ski:itemFamily==='SKI'?member.ski:null});assert.ok(r.d.booking);
  if(itemFamily==='SKI_BOOT'){let bv=await custody.checkoutView(r.d.booking!.id);await x.db.pool.query("UPDATE ledger_assets SET bsl_status='UNVERIFIED',bsl_mm=NULL,bsl_evidence='',version=version+1 WHERE id=$1",[bv.items[0]!.asset_id]);bv=await custody.checkoutView(r.d.booking!.id);const fitEvidence=syntheticPreparation(bv);fitEvidence.members[0]!.bslMm=null;
   const ready=await custody.prepare(randomUUID(),{bookingId:bv.bookingId,expectedBookingVersion:bv.bookingVersion,expectedHoldVersion:bv.holdVersion,selections:bv.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence});assert.equal(ready.preparationValid,true);assert.equal(ready.preparation.fit_evidence.members[0].bslMm,null);assert.equal(ready.preparation.fit_evidence.members[0].dinReferenceValue,null);
  }
 }
 const board=await reserve('2035-02-06',{sport:'SNOWBOARD',ski:null}),bv=await custody.checkoutView(board.d.booking!.id);assert.equal(bv.preparationMembers[0]?.din,null);const bp=await custody.prepare(randomUUID(),{bookingId:bv.bookingId,expectedBookingVersion:bv.bookingVersion,expectedHoldVersion:bv.holdVersion,selections:bv.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:syntheticPreparation(bv)});assert.equal(bp.preparation.fit_evidence.members[0].dinReferenceValue,null);
 assert.ok(variants.length);console.log('PASS minimal individual profiles; boots-only ready with null BSL and no DIN; snowboard preparation');
 stage='legacy preparation is history only; V2 re-preparation restores checkout';{
  const legacyBooking=(await reserve('2035-02-05')).d.booking!.id;let lv=await custody.checkoutView(legacyBooking);
  const selections=lv.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})).sort((a,b)=>a.requirementKey.localeCompare(b.requirementKey));
  const legacyEvidence={selections,note:'SYNTHETIC legacy free-form fit record'};
  const c=await x.db.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','SYNTHETIC legacy preparation fixture',true)",[x.actor]);
   await c.query('INSERT INTO rental_preparations(id,store_id,checked_in_at,checked_in_by,prepared_at,prepared_by,fit_evidence) VALUES($1,$2,$3,$4,$3,$4,$5)',[legacyBooking,'MOUNTAIN_BASE',x.now(),x.actor,JSON.stringify(legacyEvidence)]);
   await c.query("UPDATE inventory_holds SET allocation_stage='PREPARATION_FIXED',version=version+1 WHERE id=(SELECT hold_id FROM rental_bookings WHERE id=$1)",[legacyBooking]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  lv=await custody.checkoutView(legacyBooking);assert.ok(lv.preparation?.prepared_at);assert.deepEqual(lv.preparation.fit_evidence,legacyEvidence);assert.equal(lv.preparationValid,false);
  const legacyRows=await manifest.manifest({...query,date:'2035-02-05',section:'pickup'});assert.equal(((legacyRows.rows.find(r=>(r as Record<string,unknown>).bookingId===legacyBooking) as Record<string,unknown>)?.pickup as {equipmentPrepared:boolean}).equipmentPrepared,false);
  await assert.rejects(custody.checkout(randomUUID(),{bookingId:legacyBooking,expectedPreparationVersion:lv.preparation.version}),{code:'REPREPARATION_REQUIRED'});
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM rental_loan_items WHERE booking_id=$1',[legacyBooking])).rows[0].n,0);
  const again=await custody.prepare(randomUUID(),{bookingId:lv.bookingId,expectedBookingVersion:lv.bookingVersion,expectedHoldVersion:lv.holdVersion,selections:lv.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:syntheticPreparation(lv)});
  assert.equal(again.preparationValid,true);assert.equal(again.preparation.fit_evidence.version,'ZAO_PREP_V2');
  const out=await custody.checkout(randomUUID(),{bookingId:legacyBooking,expectedPreparationVersion:again.preparation.version});assert.ok(out.loans.length);
  // The retired record is not erased: the append-only rental history keeps it as the prior state.
  const history=(await x.db.pool.query("SELECT before_data->'fit_evidence' AS evidence FROM rental_history WHERE entity_id=$1 AND event='rental_preparations_UPDATE' ORDER BY id",[legacyBooking])).rows;assert.deepEqual(history[0]?.evidence,legacyEvidence);
 }
 console.log('PASS legacy evidence + matching assignment: not ready, manifest not prepared, checkout REPREPARATION_REQUIRED, V2 re-prepare then checkout, legacy kept in history');
}catch(e){console.error('R65_PREPARATION_FAILED '+stage+' '+String((e as {code?:string}).code??(e as Error).message));throw e;}finally{await custodyRole?.close();await guest?.close();await ops?.close();await x.close();}
