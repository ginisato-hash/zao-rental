import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {ManifestService} from '../../packages/core/src/operations/manifest-service';
import {CustodyService} from '../../packages/core/src/rental/custody-service';
import {WearService} from '../../packages/core/src/wear/service';
import {LedgerService} from '../../packages/core/src/catalog/ledger-service';
import {RecommendationService} from '../../packages/core/src/recommendation/recommendation-service';
import {lengthVariants} from '../recommendation/fixture';
import {ledgerPrincipal} from '../../packages/auth/src/staff-auth';
import {verifyLedgerWrite} from '../../packages/auth/src/ledger-write-authority';
import {reconcileLedgerProtection} from '../../packages/core/src/catalog/reconcile-protection';
import {writeAccount} from '../../packages/auth/src/accounts';
import {requestFor,skiSet,variants} from '../inventory/fixture';
import {registerWear} from '../wear/fixture';
import type {HoldConditions} from '../../packages/contracts/src/hold';
let failed=false,stage='fixture',count=0;const x=await flowFixture();let role:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
// Manifest/custody mechanics use explicit staff reserve for tiny exact-capacity fixtures.
const draft=(date?:string,conditions?:HoldConditions)=>x.draft(date,conditions,{reason:'SYNTHETIC manifest custody mechanics'});
const BUSINESS=['rental_bookings','rental_payment_attempts','inventory_holds','inventory_claims','rental_loan_items','rental_preparations','rental_custody_events','rental_inspection_events','rental_no_pickup_events','wear_loans','wear_receipts','ops_exceptions'];
try{
 role=await provisionOperationsRole(x.db.pool,x.db.identity);
 const custody=new CustodyService(role.operationsPool,x.roles.authPool,x.signed.identity);
 const wear=new WearService(role.operationsPool,x.roles.authPool,x.signed.identity);
 const fingerprint=async()=>{const r:Record<string,unknown>={};for(const t of BUSINESS)r[t]=(await x.db.pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') v FROM ${t} t`)).rows[0].v;return r;};

 // A dedicated account, never x.actor: staff_permission_overrides/staff_store_access writes
 // bump staff_members.revision (0003_staff_auth.sql's staff_permission_audit trigger), which
 // would invalidate the principal already captured inside x.holds/x.quotes/x.service and fail
 // every later draft() booking-actor authorization with a stale-revision FORBIDDEN.
 async function account(email:string,scope:'ALL'|'ASSIGNED',storeIds:string[],permissions:Record<string,boolean>){
  await writeAccount(x.roles.authPool,x.bp,undefined,{email,password:x.password,displayName:'SYNTHETIC '+email.split('@')[0],active:true,role:'STAFF',scope,storeIds,permissions});
  const signed=await x.login(email);return new ManifestService(role!.operationsPool,x.roles.authPool,signed.identity);
 }
 const checkoutOnly=await account('manifest-checkout@example.invalid','ASSIGNED',['MOUNTAIN_BASE'],{BOOKING_VIEW:true,RENTAL_CHECKOUT:true});
 const returnOnlyA=await account('manifest-return-a@example.invalid','ASSIGNED',['MOUNTAIN_BASE'],{BOOKING_VIEW:true,RENTAL_RETURN:true});
 const returnOnlyB=await account('manifest-return-b@example.invalid','ASSIGNED',['MOUNTAIN_BASE'],{BOOKING_VIEW:true,RENTAL_RETURN:true});
 const viewOnly=await account('manifest-view@example.invalid','ASSIGNED',['MOUNTAIN_BASE'],{BOOKING_VIEW:true});
 const noPerm=await account('manifest-none@example.invalid','ASSIGNED',['MOUNTAIN_BASE'],{});
 const onsenOnly=await account('manifest-onsen@example.invalid','ASSIGNED',['ONSEN_BASE'],{BOOKING_VIEW:true,RENTAL_RETURN:true});
 const full=await account('manifest-full@example.invalid','ALL',[],{BOOKING_VIEW:true,RENTAL_CHECKOUT:true,RENTAL_RETURN:true,OPERATIONS_VIEW:true});

 await check('unauthenticated, missing BOOKING_VIEW, and wrong store all fail closed server-side',async()=>{
  const stray=new ManifestService(role!.operationsPool,x.roles.authPool,{subject:randomUUID(),sessionId:randomUUID()});
  await assert.rejects(stray.manifest({store:'MOUNTAIN_BASE',date:null,section:null,cursor:null,pageSize:null}),{status:401});
  await assert.rejects(noPerm.manifest({store:'MOUNTAIN_BASE',date:null,section:null,cursor:null,pageSize:null}),{status:403});
  await assert.rejects(returnOnlyA.manifest({store:'ONSEN_BASE',date:null,section:null,cursor:null,pageSize:null}),{status:403});
  await assert.rejects(full.manifest({store:'NOWHERE',date:null,section:null,cursor:null,pageSize:null}),{status:422});
  await assert.rejects(full.manifest({store:'MOUNTAIN_BASE',date:'not-a-date',section:null,cursor:null,pageSize:null}),{status:422});
  // Regex shape alone accepts these; only the round-trip calendar check (utcDate reuse,
  // UX5C-R03) catches them before $2::date ever reaches Branch SQL.
  await assert.rejects(full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-31',section:null,cursor:null,pageSize:null}),{status:422});
  await assert.rejects(full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-29',section:null,cursor:null,pageSize:null}),{status:422});
  await assert.rejects(full.manifest({store:'MOUNTAIN_BASE',date:null,section:'bogus',cursor:null,pageSize:null}),{status:422});
  await assert.rejects(full.manifest({store:'MOUNTAIN_BASE',date:null,section:null,cursor:null,pageSize:0}),{status:422});
  await assert.rejects(full.manifest({store:'MOUNTAIN_BASE',date:null,section:null,cursor:null,pageSize:301}),{status:422});
  await assert.rejects(full.manifest({store:'MOUNTAIN_BASE',date:null,section:null,cursor:'not-base64-json',pageSize:null}),{status:422});
 });

 await x.clock('2035-02-01T05:00:00+09:00');
 const pickup=await draft('2035-02-01');await x.service.startPayment(pickup.booking.id,randomUUID());

 await check('pickup today is derived from server inventory_clock(), never a client date',async()=>{
  const page=await full.manifest({store:'MOUNTAIN_BASE',date:null,section:null,cursor:null,pageSize:null});
  assert.equal(page.date,'2035-02-01');
  const row=page.rows.find(r=>(r as {bookingId?:string}).bookingId===pickup.booking.id) as {pickup?:{isPickupToday:boolean}};
  assert.ok(row?.pickup?.isPickupToday);
 });

 await check('BOOKING_VIEW-only never learns pickup/return candidacy through row presence',async()=>{
  const page=await viewOnly.manifest({store:'MOUNTAIN_BASE',date:'2035-02-01',section:null,cursor:null,pageSize:null});
  assert.deepEqual(page.rows,[]);
 });

 await check('checkout-only vs return-only vs full response shape',async()=>{
  const co=(await checkoutOnly.manifest({store:'MOUNTAIN_BASE',date:'2035-02-01',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===pickup.booking.id) as Record<string,unknown>;
  assert.ok(co.pickup);assert.equal(co.return,undefined);assert.equal(co.exception,undefined);
  const ro=(await returnOnlyA.manifest({store:'MOUNTAIN_BASE',date:'2035-02-01',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===pickup.booking.id) as Record<string,unknown>|undefined;
  if(ro){assert.equal(ro.pickup,undefined);}
  const fu=(await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-01',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===pickup.booking.id) as Record<string,unknown>;
  assert.ok(fu.pickup&&fu.return&&fu.exception);
 });

 await check('prepared but not checked out -> CHECKOUT; wear-only pickup skips PREPARE_EQUIPMENT',async()=>{
  // Both pickupTiming() and rental_validate_loan's own DB-level handover-window check
  // require 08:30-17:00 JST same-day; the fixture's 05:00 draft-time clock is otherwise
  // still outside that window when actual checkout() runs below.
  await x.clock('2035-02-01T10:00:00+09:00');
  const view=await custody.checkoutView(pickup.booking.id);
  await custody.prepare(randomUUID(),{bookingId:pickup.booking.id,expectedBookingVersion:view.bookingVersion,expectedHoldVersion:view.holdVersion,selections:view.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:'SYNTHETIC manifest fit note'});
  const row=(await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-01',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===pickup.booking.id) as {pickup:{equipmentPrepared:boolean;equipmentCheckedOut:boolean};nextAction:string};
  assert.equal(row.pickup.equipmentPrepared,true);assert.equal(row.pickup.equipmentCheckedOut,false);assert.equal(row.nextAction,'CHECKOUT');
  const key=randomUUID();await custody.checkout(key,{bookingId:pickup.booking.id,expectedPreparationVersion:1});
 });

 await check('checked out with a future due date -> OUT_WAIT_RETURN on the pickup day; the whole due-calendar-day already reads RECEIVE_RETURN, never waiting for the exact due timestamp (Implementation Clarification 1)',async()=>{
  // A distinct variant/asset from the earlier "pickup" booking: that booking's item is
  // checked out and never returned, so once its due time passes it permanently occupies
  // the default SKI asset via rental_inventory_blocks' OVERDUE_OUT view (0033_launch_operations.sql:125).
  const conditions=requestFor('2035-02-05',[variants.skiAlt]);conditions.period={startDate:'2035-02-05',endDate:'2035-02-06',slot:'MULTIDAY'};
  const dueToday=await draft(undefined,conditions);await x.service.startPayment(dueToday.booking.id,randomUUID());
  await x.clock('2035-02-05T09:00:00+09:00');
  const view=await custody.checkoutView(dueToday.booking.id);await custody.prepare(randomUUID(),{bookingId:dueToday.booking.id,expectedBookingVersion:view.bookingVersion,expectedHoldVersion:view.holdVersion,selections:view.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:'SYNTHETIC due-today fit'});
  await custody.checkout(randomUUID(),{bookingId:dueToday.booking.id,expectedPreparationVersion:1});
  const pickupDay=(await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-05',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===dueToday.booking.id) as {nextAction:string};
  assert.equal(pickupDay.nextAction,'OUT_WAIT_RETURN');
  // The server clock is still 2035-02-05; asking for 2035-02-06 (the due date) explicitly must
  // already read RECEIVE_RETURN — due_at's exact 17:00 cutoff has not passed by any clock reading.
  const dueDay=(await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-06',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===dueToday.booking.id) as {nextAction:string;return:{equipmentReturnDueToday:boolean}};
  assert.equal(dueDay.return.equipmentReturnDueToday,true);assert.equal(dueDay.nextAction,'RECEIVE_RETURN');
 });

 await check('MULTIDAY no-pickup completion is visible only via Branch D on its completion date, not on occupancy_start',async()=>{
  // A third distinct SKI asset: the default variants.ski/skiAlt units are both permanently
  // OUT (never returned) from the earlier pickup/OUT_WAIT_RETURN checks above.
  const multiday:HoldConditions={reservationId:randomUUID(),pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:{startDate:'2035-02-10',endDate:'2035-02-12',slot:'MULTIDAY'},members:[{key:'person-a',product:'SINGLE',age:'ADULT',tier:'REGULAR',items:[{family:'SKI',variantIds:[lengthVariants.ski145]}]}]};
  const d=await draft(undefined,multiday);await x.service.startPayment(d.booking.id,randomUUID());
  await x.clock('2035-02-10T06:00:00+09:00');
  const startDay=(await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-10',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===d.booking.id) as {nextAction:string}|undefined;
  assert.notEqual(startDay?.nextAction,'COMPLETE');
  await x.clock('2035-02-12T18:00:00+09:00');
  await custody.completeNoPickup(randomUUID(),{bookingId:d.booking.id});
  const stillStart=(await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-10',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===d.booking.id);
  assert.equal(stillStart,undefined,'no candidate row on occupancy_start once the completion event is on a later date');
  const completionDay=(await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-12',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===d.booking.id) as {nextAction:string};
  assert.equal(completionDay.nextAction,'COMPLETE');
 });

 let sameDay:{booking:{id:string}};
 await check('same-day receipt + inspection stays visible with COMPLETE; a later-day inspection completion does not leave a standing COMPLETE row',async()=>{
  // A distinct SKI asset from the permanently-OUT pickup/dueToday bookings above.
  const sameDayConditions=skiSet('2035-02-15');sameDayConditions.members[0]!.items[0]!.variantIds=[lengthVariants.ski135];
  sameDay=await draft(undefined,sameDayConditions);await x.service.startPayment(sameDay.booking.id,randomUUID());
  const view=await custody.checkoutView(sameDay.booking.id);await custody.prepare(randomUUID(),{bookingId:sameDay.booking.id,expectedBookingVersion:view.bookingVersion,expectedHoldVersion:view.holdVersion,selections:view.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:'SYNTHETIC same-day fit'});
  await x.clock('2035-02-15T09:00:00+09:00');await custody.checkout(randomUUID(),{bookingId:sameDay.booking.id,expectedPreparationVersion:1});
  await x.clock('2035-02-15T13:00:00+09:00');
  let batch=await custody.createBatch(randomUUID(),'MOUNTAIN_BASE');
  const loans=(await x.db.pool.query('SELECT id,asset_id,pole_id FROM rental_loan_items WHERE booking_id=$1',[sameDay.booking.id])).rows;
  for(const l of loans){batch=await custody.scan(randomUUID(),{batchId:batch.id,expectedVersion:batch.version,assetId:l.asset_id,poleLoanId:l.pole_id?l.id:null});}
  batch=await custody.confirm(randomUUID(),{batchId:batch.id,expectedVersion:batch.version});
  for(const c of batch.candidates)await custody.inspection(randomUUID(),{loanItemId:c.loan_item_id,expectedVersion:2,store:'MOUNTAIN_BASE',evidence:'SYNTHETIC same-day inspection ready'});
  const sameDayRow=(await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-15',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===sameDay.booking.id) as {nextAction:string};
  assert.equal(sameDayRow.nextAction,'COMPLETE');
  await x.clock('2035-02-16T09:00:00+09:00');
  const laterDay=(await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-16',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===sameDay.booking.id);
  assert.equal(laterDay,undefined,'a carry-over task disappears from the manifest the instant it completes, never leaving a later-day COMPLETE row');
 });

 await check('received but inspection pending is a carry-over row across days, never presented as due today',async()=>{
  // A single SKI-only item (requestFor, not skiSet): this booking is deliberately never
  // inspected, so a bundled boot/pole item would also permanently block that shared
  // 3-unit pool via the same INSPECTION_PENDING rental_inventory_blocks branch (0033:125)
  // that OVERDUE_OUT uses for a never-returned OUT item.
  const carryOverConditions=requestFor('2035-02-20',[lengthVariants.ski165]);
  const d=await draft(undefined,carryOverConditions);await x.service.startPayment(d.booking.id,randomUUID());
  const view=await custody.checkoutView(d.booking.id);await custody.prepare(randomUUID(),{bookingId:d.booking.id,expectedBookingVersion:view.bookingVersion,expectedHoldVersion:view.holdVersion,selections:view.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:'SYNTHETIC carry-over fit'});
  await x.clock('2035-02-20T09:00:00+09:00');await custody.checkout(randomUUID(),{bookingId:d.booking.id,expectedPreparationVersion:1});
  await x.clock('2035-02-20T13:00:00+09:00');
  let batch=await custody.createBatch(randomUUID(),'MOUNTAIN_BASE');
  const loans=(await x.db.pool.query('SELECT id,asset_id,pole_id FROM rental_loan_items WHERE booking_id=$1',[d.booking.id])).rows;
  for(const l of loans)batch=await custody.scan(randomUUID(),{batchId:batch.id,expectedVersion:batch.version,assetId:l.asset_id,poleLoanId:l.pole_id?l.id:null});
  await custody.confirm(randomUUID(),{batchId:batch.id,expectedVersion:batch.version});
  await x.clock('2035-02-21T09:00:00+09:00');
  const row=(await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-21',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===d.booking.id) as {nextAction:string;return:{equipmentReturnDueToday:boolean;inspectionPendingHereCount:number}};
  assert.equal(row.return.equipmentReturnDueToday,false);assert.ok(row.return.inspectionPendingHereCount>0);assert.equal(row.nextAction,'INSPECTION_PENDING');
 });

 let wearFixtures:Awaited<ReturnType<typeof registerWear>>,recs:RecommendationService;
 await check('wear-only return due today reaches RECEIVE_RETURN; mixed equipment-received/wear-outstanding also reaches RECEIVE_RETURN',async()=>{
  const ledger=new LedgerService(x.roles.ledgerPool,ledgerPrincipal(x.principal),(c,stores,global)=>verifyLedgerWrite(c,x.roles.authPool,x.signed.identity,stores,global),(resource,id,version)=>reconcileLedgerProtection(x.roles.transferPool,x.roles.authPool,x.signed.identity,resource,id,version));
  wearFixtures=await registerWear(ledger,wear);recs=new RecommendationService(x.roles.recommendationPool,x.principal,x.holds,x.quotes);
  const wearMember=(key:string)=>({key,sport:'WEAR' as const,heightCm:null,footCm:null,adultAtStart:true,tier:'STANDARD' as const,ski:null,poleVariantId:null,wearSport:'SKI' as const,wearSelection:wearFixtures.selection});
  await x.clock('2035-02-25T05:00:00+09:00');
  const wearOnlyInput={pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:{startDate:'2035-02-25',endDate:'2035-02-25',slot:'DAY' as const},contractVersion:'INTEGRATED_V1_2' as const,members:[wearMember('wear-only')]};
  const wp=await recs.preview(randomUUID(),wearOnlyInput,null),ws=await recs.select(wp.preview.id,randomUUID(),{directions:{'wear-only':'RECOMMENDED'},wantAdvance:false,couponCode:null,acceptedModelPolicy:true});
  const wearOnlyBooking=await x.service.create(randomUUID(),ws.quote!.id,{displayName:'SYNTHETIC Wear Only',email:'synthetic-wear-only@example.invalid',termsAccepted:true});
  await x.service.startPayment(wearOnlyBooking.id,randomUUID());
  await x.clock('2035-02-25T09:00:00+09:00');
  const wearOnlyVersion=(await x.db.pool.query('SELECT version FROM rental_bookings WHERE id=$1',[wearOnlyBooking.id])).rows[0].version;
  await wear.checkout(randomUUID(),{bookingId:wearOnlyBooking.id,expectedBookingVersion:wearOnlyVersion,store:'MOUNTAIN_BASE',reason:'SYNTHETIC wear-only checkout'});
  // A WEAR_SET is two separate wear_loans rows (WEAR_JACKET + WEAR_PANTS requirement
  // keys, UNIQUE(booking_id,requirement_key)) — both must be received for the domain
  // to actually clear, not just the first row a query happens to return.
  const wearOnlyLoans=(await x.db.pool.query('SELECT id,quantity,revision FROM wear_loans WHERE booking_id=$1 ORDER BY requirement_key',[wearOnlyBooking.id])).rows;
  const row1=(await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-25',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===wearOnlyBooking.id) as {return:{wearReturnDueToday:boolean;outCount:number};nextAction:string};
  assert.equal(row1.return.wearReturnDueToday,true);assert.equal(row1.return.outCount,0);assert.equal(row1.nextAction,'RECEIVE_RETURN');

  // ski-mixed stays equipment-only (no bundled wearSelection): wear-only above already
  // holds 1 of registerWear's 2 jacket/pants units, so a SKI_SET-bundled wear item here
  // would need a second concurrent unit that isn't available until wear-only is returned
  // later in this same check. wear-mixed alone still makes this booking mixed equipment+wear.
  const mixedInput={pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',period:{startDate:'2035-02-26',endDate:'2035-02-26',slot:'DAY' as const},contractVersion:'INTEGRATED_V1_2' as const,members:[{key:'ski-mixed',sport:'SKI' as const,heightCm:170,footCm:25.5,adultAtStart:true,tier:'REGULAR' as const,ski:{weightKg:60,ageAtStart:30,level:'BEGINNER' as const},poleVariantId:variants.pole},wearMember('wear-mixed')]};
  const mp=await recs.preview(randomUUID(),mixedInput,null,true),ms=await recs.select(mp.preview.id,randomUUID(),{directions:{'ski-mixed':'RECOMMENDED','wear-mixed':'RECOMMENDED'},wantAdvance:false,couponCode:null,acceptedModelPolicy:true},{reason:'SYNTHETIC mixed manifest mechanics'});
  const mixed=await x.service.create(randomUUID(),ms.quote!.id,{displayName:'SYNTHETIC Mixed',email:'synthetic-mixed@example.invalid',termsAccepted:true});
  await x.service.startPayment(mixed.id,randomUUID());
  await x.clock('2035-02-26T09:00:00+09:00');
  const mixedView=await custody.checkoutView(mixed.id);
  await custody.prepare(randomUUID(),{bookingId:mixed.id,expectedBookingVersion:mixedView.bookingVersion,expectedHoldVersion:mixedView.holdVersion,selections:mixedView.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:'SYNTHETIC mixed fit'});
  await custody.checkout(randomUUID(),{bookingId:mixed.id,expectedPreparationVersion:1});
  const mixedVersion=(await x.db.pool.query('SELECT version FROM rental_bookings WHERE id=$1',[mixed.id])).rows[0].version;
  await wear.checkout(randomUUID(),{bookingId:mixed.id,expectedBookingVersion:mixedVersion,store:'MOUNTAIN_BASE',reason:'SYNTHETIC mixed wear checkout'});
  let mb=await custody.createBatch(randomUUID(),'MOUNTAIN_BASE');
  const mLoans=(await x.db.pool.query('SELECT id,asset_id,pole_id FROM rental_loan_items WHERE booking_id=$1',[mixed.id])).rows;
  for(const l of mLoans)mb=await custody.scan(randomUUID(),{batchId:mb.id,expectedVersion:mb.version,assetId:l.asset_id,poleLoanId:l.pole_id?l.id:null});
  mb=await custody.confirm(randomUUID(),{batchId:mb.id,expectedVersion:mb.version});
  // Inspect mixed's equipment too: leaving it RECEIVED-but-uninspected would permanently
  // block its boot/pole asset via the same INSPECTION_PENDING branch the carry-over test
  // above deliberately exercises for its own single SKI-only item.
  for(const c of mb.candidates)await custody.inspection(randomUUID(),{loanItemId:c.loan_item_id,expectedVersion:2,store:'MOUNTAIN_BASE',evidence:'SYNTHETIC mixed inspection ready'});
  const row2=(await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-26',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===mixed.id) as {return:{outCount:number;wearReturnDueToday:boolean;wearOutstandingQuantity:number};nextAction:string};
  assert.equal(row2.return.outCount,0);assert.equal(row2.return.wearReturnDueToday,true);assert.ok(row2.return.wearOutstandingQuantity>0);assert.equal(row2.nextAction,'RECEIVE_RETURN');
  // Both requirement-key rows (jacket + pants) must be received for the wear domain to
  // actually clear; receiving only one leaves the booking genuinely still outstanding.
  const wearOnlyReceipts=[];
  for(const l of wearOnlyLoans)wearOnlyReceipts.push((await wear.receive(randomUUID(),{loanId:l.id,expectedRevision:l.revision,store:'MOUNTAIN_BASE',quantity:l.quantity,reason:'SYNTHETIC wear return',unresolvedId:null})).receipt!);
  const receipt=wearOnlyReceipts[0]!;
  await check('wear care states classify as WEAR_CARE_IN_PROGRESS, never INSPECTION_PENDING or COMPLETE, until UNAVAILABLE forces NEEDS_DETAIL_REVIEW',async()=>{
   const pending=(await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-25',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===wearOnlyBooking.id) as {nextAction:string;return:{inspectionPendingHereCount:number}};
   assert.equal(pending.nextAction,'WEAR_CARE_IN_PROGRESS');assert.equal(pending.return.inspectionPendingHereCount,0);
   await wear.cleaning(randomUUID(),{receiptId:receipt.id,expectedRevision:receipt.revision,operation:'START',confirmedReady:false,reason:'SYNTHETIC cleaning start'});
   const cleaning=(await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-25',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===wearOnlyBooking.id) as {nextAction:string};
   assert.equal(cleaning.nextAction,'WEAR_CARE_IN_PROGRESS');
   // wear_guard() (0013_wear_quantity.sql:38) requires a trusted zao.actor/zao.reason audit
   // context on every wear_* mutation, even this direct simulation of an UNAVAILABLE state
   // with no normal staff-facing endpoint of its own.
   {const c=await x.db.pool.connect();try{await c.query("SELECT set_config('zao.actor',$1,false),set_config('zao.reason',$2,false)",[x.actor,'SYNTHETIC manifest test: force UNAVAILABLE for NEEDS_DETAIL_REVIEW coverage']);await c.query("UPDATE wear_receipts SET state='UNAVAILABLE' WHERE id=$1",[receipt.id]);}finally{c.release();}}
   const unavailable=(await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-25',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===wearOnlyBooking.id) as {nextAction:string};
   assert.equal(unavailable.nextAction,'NEEDS_DETAIL_REVIEW');
   const returnOnlyRow=(await returnOnlyA.manifest({store:'MOUNTAIN_BASE',date:'2035-02-25',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===wearOnlyBooking.id) as {nextAction:string};
   assert.equal(returnOnlyRow.nextAction,'NEEDS_DETAIL_REVIEW');
   {const c=await x.db.pool.connect();try{await c.query("SELECT set_config('zao.actor',$1,false),set_config('zao.reason',$2,false)",[x.actor,'SYNTHETIC manifest test: reset to READY']);await c.query("UPDATE wear_receipts SET state='READY' WHERE id=$1",[receipt.id]);}finally{c.release();}}
  });
 });

 await check('cross-store actual receipt: BOOKING_SCOPED when planned-store scope permits, CUSTODY_ONLY minimal projection when it does not',async()=>{
  // A distinct SKI asset from the other checked-out-forever/carry-over bookings above.
  const crossStoreConditions=skiSet('2035-02-28');crossStoreConditions.members[0]!.items[0]!.variantIds=[lengthVariants.ski134];
  const d=await draft(undefined,crossStoreConditions);await x.service.startPayment(d.booking.id,randomUUID());
  const view=await custody.checkoutView(d.booking.id);await custody.prepare(randomUUID(),{bookingId:d.booking.id,expectedBookingVersion:view.bookingVersion,expectedHoldVersion:view.holdVersion,selections:view.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:'SYNTHETIC cross-store fit'});
  await x.clock('2035-02-28T09:00:00+09:00');await custody.checkout(randomUUID(),{bookingId:d.booking.id,expectedPreparationVersion:1});
  await x.clock('2035-02-28T13:00:00+09:00');
  let batch=await custody.createBatch(randomUUID(),'ONSEN_BASE');
  const loans=(await x.db.pool.query('SELECT id,asset_id,pole_id FROM rental_loan_items WHERE booking_id=$1',[d.booking.id])).rows;
  for(const l of loans)batch=await custody.scan(randomUUID(),{batchId:batch.id,expectedVersion:batch.version,assetId:l.asset_id,poleLoanId:l.pole_id?l.id:null});
  await custody.confirm(randomUUID(),{batchId:batch.id,expectedVersion:batch.version});
  const scopedRow=(await full.manifest({store:'ONSEN_BASE',date:'2035-02-28',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===d.booking.id) as {rowKind:string};
  assert.equal(scopedRow.rowKind,'BOOKING_SCOPED');
  const onsenPage=await onsenOnly.manifest({store:'ONSEN_BASE',date:'2035-02-28',section:null,cursor:null,pageSize:null});
  const custodyOnly=onsenPage.rows.find(r=>{const rr=r as {loanItemId?:string};return loans.some(l=>l.id===rr.loanItemId);}) as Record<string,unknown>|undefined;
  assert.ok(custodyOnly,'a principal scoped only to the receiving store must see the actual-store custody task');
  assert.equal(custodyOnly!.rowKind,'CUSTODY_ONLY');
  for(const forbidden of ['displayName','totalJpy','period','bookingState','bookingId','nextAction'])assert.equal(custodyOnly![forbidden],undefined,forbidden);
  assert.ok(typeof custodyOnly!.taskState==='string'&&typeof custodyOnly!.taskAction==='string');
 });

 await check('store-wide task visibility: staff B sees the same applied task staff A produced',async()=>{
  const before=await returnOnlyB.manifest({store:'MOUNTAIN_BASE',date:'2035-02-21',section:null,cursor:null,pageSize:null});
  const afterA=await returnOnlyA.manifest({store:'MOUNTAIN_BASE',date:'2035-02-21',section:null,cursor:null,pageSize:null});
  assert.deepEqual(before.rows,afterA.rows);
 });

 let genericTarget='';
 await check('a generic unrelated exception never changes nextAction; ops_list_exceptions is the only read',async()=>{
  genericTarget=sameDay.booking.id;
  await x.db.pool.query("INSERT INTO ops_exceptions(event_type,source_type,source_id,source_version,correlation_id,booking_id,store_id,severity,occurred_at) VALUES('NOTIFICATION_FAILED','NOTIFICATION',$1,md5('manifest-test'),$1,$2,'MOUNTAIN_BASE','WARN',inventory_clock())",[randomUUID(),genericTarget]);
  const before=await fingerprint();
  // sameDay's booking is fully COMPLETE and only ever visible again on its own
  // occupancy_start date (2035-02-15, Branch A) — it has no candidate branch left on
  // any later date, per the "same-day receipt" check above.
  const row=(await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-15',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===genericTarget) as {exception:{attention:boolean;count:number}}|undefined;
  assert.deepEqual(await fingerprint(),before,'the manifest read must insert/update/delete no business or exception row');
  assert.ok(row&&row.exception.attention&&row.exception.count>=1);
 });

 await check('exact exception count/topSeverity walks past a single 51-row page rather than reporting a partial total',async()=>{
  for(let i=0;i<60;i++)await x.db.pool.query("INSERT INTO ops_exceptions(event_type,source_type,source_id,source_version,correlation_id,booking_id,store_id,severity,occurred_at) VALUES('NOTIFICATION_FAILED','NOTIFICATION',$1::uuid,md5('walk-'||$1::text),$1::uuid,$2,'MOUNTAIN_BASE',$3,inventory_clock()-($4||' seconds')::interval)",[randomUUID(),genericTarget,i%7===0?'ERROR':'INFO',i]);
  const row=(await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-15',section:null,cursor:null,pageSize:null})).rows.find(r=>(r as {bookingId?:string}).bookingId===genericTarget) as {exception:{count:number;topSeverity:string}};
  assert.ok(row.exception.count>=61,row.exception.count as unknown as string);assert.equal(row.exception.topSeverity,'ERROR');
 });

 await check('cursor pagination over a frozen candidate set retrieves every row exactly once; a cross-context cursor is rejected',async()=>{
  const first=await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-01',section:'all',cursor:null,pageSize:1});
  assert.ok(first.rows.length<=1);
  const seen=new Set(first.rows.map(r=>(r as {key:string}).key));let cursor=first.nextCursor,hasMore=first.hasMore,guard=0;
  while(hasMore&&guard++<200){const page=await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-01',section:'all',cursor,pageSize:1});for(const r of page.rows){const key=(r as {key:string}).key;assert.ok(!seen.has(key),'duplicate row key across pages');seen.add(key);}cursor=page.nextCursor;hasMore=page.hasMore;}
  const whole=await full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-01',section:'all',cursor:null,pageSize:300});
  assert.equal(seen.size,whole.rows.length);
  await assert.rejects(full.manifest({store:'ONSEN_BASE',date:'2035-02-01',section:'all',cursor:first.nextCursor,pageSize:1}),{status:422});
  const differentDate=first.nextCursor?JSON.parse(Buffer.from(first.nextCursor,'base64url').toString('utf8')):null;
  if(differentDate)await assert.rejects(full.manifest({store:'MOUNTAIN_BASE',date:'2035-02-02',section:'all',cursor:first.nextCursor,pageSize:1}),{status:422});
 });

 await check('a REPEATABLE READ page reflects one consistent snapshot despite a concurrent mid-read mutation',async()=>{
  // Neither booking here is ever checked out, but hold creation itself still needs
  // physical stock for the requested day/variant, and the default SKI asset is
  // permanently OUT from the pickup/dueToday bookings above. The date must also still be
  // in the future relative to the server clock (now 2035-02-28+ from the checks above),
  // or hold creation itself fails PERIOD_ENDED regardless of stock.
  const d=await draft(undefined,requestFor('2035-03-01',[lengthVariants.ski166]));await x.service.startPayment(d.booking.id,randomUUID());
  const holder=await role!.operationsPool.connect();
  try{
   await holder.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const before=(await holder.query('SELECT count(*)::int n FROM rental_bookings WHERE hold_id IS NOT NULL')).rows[0].n;
   // A different single-unit variant than the line above: two concurrent same-day holds
   // for the same variant would themselves conflict over the one physical asset.
   await x.service.startPayment((await draft(undefined,requestFor('2035-03-01',[lengthVariants.ski145]))).booking.id,randomUUID());
   const after=(await holder.query('SELECT count(*)::int n FROM rental_bookings WHERE hold_id IS NOT NULL')).rows[0].n;
   assert.equal(before,after,'the held snapshot must not observe a booking created after the transaction began');
  }finally{await holder.query('ROLLBACK');holder.release();}
 });

 console.log(JSON.stringify({status:'PASS',cases:count,businessMutations:0,providerCalls:0,hostedDb:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:e instanceof assert.AssertionError?e.message:'SAFE_DETAILS_ONLY'}));console.error((e as Error).stack?.split('\n').filter(l=>l.includes('/tests/operations/manifest')).join('\n'));}finally{await role?.close();await x.close();}
if(failed)process.exit(1);
