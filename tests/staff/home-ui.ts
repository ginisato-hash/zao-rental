import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {chromium,expect,type BrowserContext} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {provisionFlowRole} from '../../scripts/flow-roles';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {writeAccount} from '../../packages/auth/src/accounts';
import {seedRecommendation,lengthVariants} from '../recommendation/fixture';
import {requestFor,variants} from '../inventory/fixture';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import {FakeGateway,simulation} from '../flow/fixture';
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,flow:Awaited<ReturnType<typeof provisionFlowRole>>|undefined,failed=false,stage='startup',count=0;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url');
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const HEADERS={'cache-control':'private, no-store','vary':'Cookie'};
try{
 app=await startDevelopmentApp({built:true,operations:true});const {origin,db,roles}=app;await seedRecommendation(db.pool);
 // UX-5D: Staff Home's business date now comes from the Manifest server's own
 // inventory_clock(), never the browser clock. A fully synthetic business date (divorced
 // from the real wall-clock date) both keeps this suite independent of when it happens to
 // run and, crucially, is the proof itself: if the page ever showed the real current year
 // instead of this fixed 2035 date, that would mean the client silently fell back to
 // browser time.
 const businessDate='2035-06-16';
 const now=new Date(businessDate+'T10:00:00+09:00');
 await db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${now.toISOString()}'::timestamptz$$`);
 const root=await bootstrapDevelopmentAdmin(db.pool,{email:'ux5d-root@example.invalid',displayName:'SYNTHETIC Admin',password}),admin=(await loadStaff(db.pool,root))!;
 const base={active:true,role:'ADMIN' as const,password};
 const full=(await writeAccount(roles.authPool,admin,undefined,{...base,email:'ux5d-full@example.invalid',displayName:'SYNTHETIC Full Staff',scope:'ALL',storeIds:[],permissions:{HOLD_VIEW:true,HOLD_EDIT:true,QUOTE_VIEW:true,QUOTE_CREATE:true,PRICE_EDIT:true,BOOKING_VIEW:true,BOOKING_CREATE:true,RENTAL_CHECKOUT:true,RENTAL_RETURN:true,OPERATIONS_VIEW:true,OPERATIONS_ACKNOWLEDGE:true,INVENTORY_VIEW:true,TRANSFER_VIEW:true}})).id!;
 // VIEWER carries a baseline INVENTORY_VIEW grant for every staff member (staff_role_permissions);
 // explicitly revoke it here so this account is genuinely narrow (BOOKING_VIEW only), the same
 // way an operator would configure a booking-only role in the real staff-management screen.
 await writeAccount(roles.authPool,admin,undefined,{...base,email:'ux5d-narrow@example.invalid',displayName:'SYNTHETIC Narrow Staff',role:'VIEWER',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{BOOKING_VIEW:true,INVENTORY_VIEW:false}});
 // UX5R-04: a valid permission composition where RENTAL_CHECKOUT/RENTAL_RETURN are granted but
 // BOOKING_VIEW is explicitly denied. /staff/rentals and the custody HTTP handler both require
 // BOOKING_VIEW first, so this account cannot actually use pickup or return.
 await writeAccount(roles.authPool,admin,undefined,{...base,email:'ux5d-inverse@example.invalid',displayName:'SYNTHETIC Inverse Staff',role:'STAFF',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{BOOKING_VIEW:false,RENTAL_CHECKOUT:true,RENTAL_RETURN:true}});
 // UX-5D: checkout-only composition, to prove the operational Manifest section is offered
 // independently of RENTAL_RETURN and never shows a return-domain action class to it.
 await writeAccount(roles.authPool,admin,undefined,{...base,email:'ux5d-checkout@example.invalid',displayName:'SYNTHETIC Checkout Staff',role:'STAFF',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{BOOKING_VIEW:true,RENTAL_CHECKOUT:true}});
 // UX-5D: scoped only to ONSEN_BASE (never MOUNTAIN_BASE, where every booking below is
 // planned) — the one principal composition that can ever observe a CUSTODY_ONLY row instead
 // of a BOOKING_SCOPED one.
 await writeAccount(roles.authPool,admin,undefined,{...base,email:'ux5d-onsen@example.invalid',displayName:'SYNTHETIC Onsen Return Staff',role:'STAFF',scope:'ASSIGNED',storeIds:['ONSEN_BASE'],permissions:{BOOKING_VIEW:true,RENTAL_RETURN:true}});
 for(let i=0;i<150;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}if(i===149)throw Error('LOCAL_START_TIMEOUT');await new Promise(r=>setTimeout(r,100));}
 async function context(){const c=await browser.newContext({baseURL:origin,viewport:{width:390,height:844}});c.setDefaultTimeout(15000);return c;}
 async function login(c:BrowserContext,email:string){const p=await c.newPage();await p.goto('/staff/login');await p.getByLabel('メールアドレス',{exact:true}).fill(email);await p.getByLabel('パスワード',{exact:true}).fill(password);await p.getByRole('button',{name:'ログイン',exact:true}).click();await p.waitForURL('**/staff/ledger');return p;}
 const owner=await context(),narrow=await context(),inverse=await context(),checkoutOnly=await context(),onsen=await context();
 const page=await login(owner,'ux5d-full@example.invalid'),narrowPage=await login(narrow,'ux5d-narrow@example.invalid'),inversePage=await login(inverse,'ux5d-inverse@example.invalid'),checkoutPage=await login(checkoutOnly,'ux5d-checkout@example.invalid'),onsenPage=await login(onsen,'ux5d-onsen@example.invalid');
 // Every request Staff Home issues, across every logged-in page, for the whole run: the final
 // check below asserts the two retired summary endpoints never appear here even once.
 const requestedPaths:string[]=[];
 for(const p of [page,narrowPage,inversePage,checkoutPage,onsenPage])p.on('request',r=>{try{const u=new URL(r.url());if(u.origin===origin)requestedPaths.push(u.pathname);}catch{/* ignore non-URL requests */}});
 const principal=(await loadStaff(db.pool,full))!,sessionId=(await db.pool.query('SELECT id FROM auth_session WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',[full])).rows[0].id as string;
 const holds=new HoldService(roles.holdPool,principal,()=>now),quotes=new QuoteService(roles.pricingPool,principal,()=>now);
 const year=now.getUTCFullYear();
 await quotes.initializePrivate(randomUUID(),(year-3)+'-01-01',(year+3)+'-12-31');
 flow=await provisionFlowRole(db.pool,db.identity);
 const fake=new FakeGateway(()=>now),bookings=new BookingService(flow.flowPool,roles.authPool,{subject:full,sessionId},fake,simulation);
 async function makeBooking(status:'COMPLETED'|'PENDING',variantId:string,displayName:string){
  const conditions=requestFor(businessDate,[variantId]),held=await holds.command('create',randomUUID(),conditions),q=(await quotes.create(randomUUID(),{conditions,holdId:held.holdId,couponCode:null,wantAdvance:false})).quote;
  const booking=await bookings.create(randomUUID(),q.id,{displayName,email:'synthetic-ux5d-guest@example.invalid',termsAccepted:true});
  fake.status=status;await bookings.startPayment(booking.id,randomUUID());return booking.id;
 }
 const confirmedId=await makeBooking('COMPLETED',variants.ski,'SYNTHETIC UX5D Confirmed');await makeBooking('PENDING',variants.skiAlt,'SYNTHETIC UX5D Pending');
 assert.equal((await db.pool.query('SELECT state FROM rental_bookings WHERE id=$1',[confirmedId])).rows[0].state,'CONFIRMED_DEV');
 const dailyBusiness=()=>page.getByRole('region',{name:'本日の業務'});
 const todayBooking=()=>page.getByRole('region',{name:'本日の予約'});

 await check('operational Staff Home replaces the one-link page; the Manifest server date (a synthetic year, never the real current year) controls the displayed business date; narrow (BOOKING_VIEW-only) permission keeps Today read-only and hides every capability-gated section/link',async()=>{
  await page.goto('/staff');await expect(page.getByRole('heading',{name:'スタッフホーム'})).toBeVisible();
  await expect(page.getByRole('region',{name:'予約QR・検索'})).toBeVisible();
  await expect(todayBooking()).toBeVisible();
  // Proves the client never derives "today" from the browser: this exact string can only
  // appear if the page used the Manifest response's own server-authoritative `date`.
  await expect(todayBooking()).toContainText(businessDate);
  await expect(dailyBusiness()).toBeVisible();
  await expect(page.getByRole('region',{name:'運用の注意事項'})).toBeVisible();
  await page.getByText('その他の管理機能').click();
  for(const name of ['道具の台帳','棚卸・CSV投入','店舗間移動','見積','期間在庫・HOLD','サイズ推薦','ウェアの数量貸出・返却'])await expect(page.getByRole('link',{name})).toBeVisible();
  await narrowPage.goto('/staff');
  await expect(narrowPage.getByRole('region',{name:'本日の予約'})).toBeVisible();
  // UX5R-01/UX-5D: a BOOKING_VIEW-only account cannot actually use pickup, so the search/QR
  // entry point and the operational Manifest section (and every Today card's action) must
  // not be offered to it at all — even though the account still needs a Manifest call
  // internally just to learn the server's business date.
  for(const label of ['予約QR・検索','本日の業務','運用の注意事項'])await expect(narrowPage.getByRole('region',{name:label})).toHaveCount(0);
  await expect(narrowPage.locator('.staff-card',{hasText:'SYNTHETIC UX5D Confirmed'}).getByRole('button')).toHaveCount(0);
  // UX5R-03: secondary links must match the destination route's own permission gate, not
  // "every authorized user".
  await narrowPage.getByText('その他の管理機能').click();
  for(const name of ['道具の台帳','棚卸・CSV投入','店舗間移動','見積','期間在庫・HOLD','サイズ推薦','ウェアの数量貸出・返却','スタッフ管理'])await expect(narrowPage.getByRole('link',{name})).toHaveCount(0);
  for(const name of ['変更・返金依頼','パスワード変更'])await expect(narrowPage.getByRole('link',{name})).toBeVisible();
 });

 await check('UX5R-04: RENTAL_CHECKOUT/RENTAL_RETURN without BOOKING_VIEW must not surface pickup/return/search surfaces the destination route would deny',async()=>{
  await inversePage.goto('/staff');await expect(inversePage.getByRole('heading',{name:'スタッフホーム'})).toBeVisible();
  for(const label of ['予約QR・検索','本日の予約','本日の業務'])await expect(inversePage.getByRole('region',{name:label})).toHaveCount(0);
 });

 await check('checkout-only composition sees the operational Manifest section but never a return-domain action class',async()=>{
  await checkoutPage.goto('/staff');
  const section=checkoutPage.getByRole('region',{name:'本日の業務'});await expect(section).toBeVisible();
  const card=section.locator('.staff-card',{hasText:'SYNTHETIC UX5D Confirmed'});await expect(card).toBeVisible();
  for(const forbidden of ['返却受付','検品待ち','ウェア整備中'])await expect(card).not.toContainText(forbidden);
 });

 await check('Today booking card action is gated by RENTAL_CHECKOUT, not by the booking state (UX5R-01), the operational Manifest card label matches the server nextAction mapping, and opens the real booking preselected into the pickup workflow',async()=>{
  await page.goto('/staff');
  const confirmedCard=todayBooking().locator('.staff-card',{hasText:'SYNTHETIC UX5D Confirmed'});await expect(confirmedCard).toBeVisible();
  await expect(confirmedCard).toContainText('確定済み');
  // The action is offered for a still-PAYMENT_PENDING booking too: the capability check
  // controls the action, never a client-side allowlist of booking states.
  const pendingCard=todayBooking().locator('.staff-card',{hasText:'SYNTHETIC UX5D Pending'});await expect(pendingCard).toContainText('決済照合待ち');
  await expect(pendingCard.getByRole('button',{name:'貸出・受付で状態を確認'})).toBeVisible();
  // The prepared-but-not-checked-out row in 本日の業務 must read as server nextAction=CHECKOUT
  // -> the presentational label 貸出 (UX-5D action mapping), not a client-derived guess.
  const manifestCard=dailyBusiness().locator('.staff-card',{hasText:'SYNTHETIC UX5D Confirmed'});
  await expect(manifestCard).toContainText('貸出');
  await manifestCard.getByRole('button',{name:'貸出へ進む'}).click();
  await page.waitForURL(new RegExp('/staff/rentals\\?booking='+confirmedId));
  await expect(page.getByRole('region',{name:'貸出用品'})).toContainText(confirmedId);
 });

 await check('booking search accepts the reservation QR payload text and lands preselected in the pickup workflow',async()=>{
  await page.goto('/staff');
  await page.getByLabel('予約番号または予約QR').fill('zao-rental:reservation:'+confirmedId);
  await page.getByRole('button',{name:'この予約を開く',exact:true}).click();
  await page.waitForURL(new RegExp('/staff/rentals\\?booking='+confirmedId));
  await expect(page.getByRole('region',{name:'貸出用品'})).toContainText(confirmedId);
  await page.getByLabel('準備・最終適合の作業記録').fill('SYNTHETIC UX5D staff fit; no automatic DIN');
  await page.getByLabel('表示された個体と数量を照合した（合成検証）').check();
  await page.getByRole('button',{name:'照合した用品を準備固定'}).click();
  await page.getByRole('button',{name:'道具の貸出を記録'}).click();
  await expect(page.getByRole('region',{name:'貸出用品'})).toContainText('OUT');
 });

 let assetId='';
 await check('the operational Manifest reflects the real open batch, then real received/inspection-pending state — replacing the retired /api/custody/returns summary',async()=>{
  assetId=(await db.pool.query('SELECT asset_id FROM rental_loan_items WHERE booking_id=$1',[confirmedId])).rows[0].asset_id;
  const created=await page.request.post('/api/custody/batch',{headers:{origin},data:{requestKey:randomUUID(),input:{store:'MOUNTAIN_BASE'}}});assert.equal(created.status(),200);
  const batch=await created.json();
  const scanned=await page.request.post('/api/custody/scan',{headers:{origin},data:{requestKey:randomUUID(),input:{batchId:batch.id,expectedVersion:batch.version,assetId,poleLoanId:null}}});assert.equal(scanned.status(),200);
  await page.goto('/staff');
  await expect(dailyBusiness().locator('.staff-card',{hasText:'SYNTHETIC UX5D Confirmed'})).toContainText('貸出中');
  const confirmed=await page.request.post('/api/custody/confirm',{headers:{origin},data:{requestKey:randomUUID(),input:{batchId:batch.id,expectedVersion:(await scanned.json()).version}}});assert.equal(confirmed.status(),200);
  await page.goto('/staff');
  await expect(dailyBusiness().locator('.staff-card',{hasText:'SYNTHETIC UX5D Confirmed'})).toContainText('検品待ち');
 });

 await check('a generic exception attached to the booking surfaces as attention metadata but never changes the displayed action (UX5B-D04/UX-5D)',async()=>{
  const before=dailyBusiness().locator('.staff-card',{hasText:'SYNTHETIC UX5D Confirmed'});
  await expect(before).toContainText('検品待ち');await expect(before).not.toContainText('要注意');
  await db.pool.query("INSERT INTO ops_exceptions(event_type,source_type,source_id,source_version,correlation_id,booking_id,store_id,severity,occurred_at) VALUES('NOTIFICATION_FAILED','NOTIFICATION',$1::uuid,md5('ux5d-generic-exception'),$1::uuid,$2,'MOUNTAIN_BASE','WARN',inventory_clock())",[randomUUID(),confirmedId]);
  await page.goto('/staff');
  const after=dailyBusiness().locator('.staff-card',{hasText:'SYNTHETIC UX5D Confirmed'});
  await expect(after).toContainText('検品待ち');await expect(after).toContainText('要注意');
  assert.equal((await narrow.request.get('/api/operations/exceptions?store=MOUNTAIN_BASE&ageHours=0&status=UNACKNOWLEDGED')).status(),403);
 });

 await check("CUSTODY_ONLY: a receiving-store-only principal sees the actual-store task with server taskAction only, never the booking's name/id/price/period/state",async()=>{
  // A distinct SKI asset from the ones already checked out/received above.
  const crossStoreConditions=requestFor(businessDate,[lengthVariants.ski135]);
  const held=await holds.command('create',randomUUID(),crossStoreConditions),q=(await quotes.create(randomUUID(),{conditions:crossStoreConditions,holdId:held.holdId,couponCode:null,wantAdvance:false})).quote;
  const crossStoreId=(await bookings.create(randomUUID(),q.id,{displayName:'SYNTHETIC UX5D Cross Store Secret',email:'synthetic-ux5d-guest@example.invalid',termsAccepted:true})).id;
  fake.status='COMPLETED';await bookings.startPayment(crossStoreId,randomUUID());
  // Owner (ALL scope) runs the normal pickup workflow, planned entirely at MOUNTAIN_BASE.
  await page.goto('/staff/rentals?booking='+crossStoreId);
  await expect(page.getByRole('region',{name:'貸出用品'})).toContainText(crossStoreId);
  await page.getByLabel('準備・最終適合の作業記録').fill('SYNTHETIC UX5D cross-store fit; no automatic DIN');
  await page.getByLabel('表示された個体と数量を照合した（合成検証）').check();
  await page.getByRole('button',{name:'照合した用品を準備固定'}).click();
  await page.getByRole('button',{name:'道具の貸出を記録'}).click();
  await expect(page.getByRole('region',{name:'貸出用品'})).toContainText('OUT');
  const crossAssetId=(await db.pool.query('SELECT asset_id FROM rental_loan_items WHERE booking_id=$1',[crossStoreId])).rows[0].asset_id;
  // Received at ONSEN_BASE — a different store than either planned pickup or return store.
  const created=await page.request.post('/api/custody/batch',{headers:{origin},data:{requestKey:randomUUID(),input:{store:'ONSEN_BASE'}}});assert.equal(created.status(),200);
  const batch=await created.json();
  const scanned=await page.request.post('/api/custody/scan',{headers:{origin},data:{requestKey:randomUUID(),input:{batchId:batch.id,expectedVersion:batch.version,assetId:crossAssetId,poleLoanId:null}}});assert.equal(scanned.status(),200);
  const confirmed=await page.request.post('/api/custody/confirm',{headers:{origin},data:{requestKey:randomUUID(),input:{batchId:batch.id,expectedVersion:(await scanned.json()).version}}});assert.equal(confirmed.status(),200);
  await onsenPage.goto('/staff');
  const custodyCard=onsenPage.getByRole('region',{name:'本日の業務'}).locator('.staff-card',{hasText:'SKI'});
  await expect(custodyCard).toBeVisible();
  await expect(custodyCard).toContainText('MOUNTAIN_BASE');await expect(custodyCard).toContainText('ONSEN_BASE');
  // Not yet inspected: server taskAction=INSPECT -> the 検品 display mapping, read from the
  // server value only, never inferred from inspectionPending/state on the client.
  await expect(custodyCard).toContainText('検品');
  for(const forbidden of ['SYNTHETIC UX5D Cross Store Secret',crossStoreId,'確定済み','決済照合待ち','決済要確認','利用完了',businessDate])await expect(custodyCard).not.toContainText(forbidden);
 });

 await check('an unrecognized future nextAction enum value fails safe to 詳細確認 on the client, never inferred from other fields',async()=>{
  const fakeBookingId=randomUUID();
  await page.route('**/api/operations/manifest*',async route=>{
   const url=new URL(route.request().url());
   await route.fulfill({status:200,contentType:'application/json',headers:HEADERS,body:JSON.stringify({store:url.searchParams.get('store'),date:businessDate,section:'all',generatedAt:now.toISOString(),pageSize:50,nextCursor:null,hasMore:false,rows:[{rowKind:'BOOKING_SCOPED',key:'B:'+fakeBookingId,bookingId:fakeBookingId,displayName:'SYNTHETIC UX5D Unknown Action',period:{startDate:businessDate,endDate:businessDate,slot:'DAY'},pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',bookingState:'CONFIRMED_DEV',equipmentCount:1,nextAction:'FUTURE_ACTION_NOT_YET_INVENTED'}]})});
  });
  await page.goto('/staff');
  const card=dailyBusiness().locator('.staff-card',{hasText:'SYNTHETIC UX5D Unknown Action'});
  await expect(card).toContainText('詳細確認');
  await page.unroute('**/api/operations/manifest*');
 });

 await check('load-more pagination never duplicates a row across pages',async()=>{
  let calls=0;
  const rowA={rowKind:'BOOKING_SCOPED',key:'B:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',bookingId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',displayName:'SYNTHETIC UX5D Page Row A',period:{startDate:businessDate,endDate:businessDate,slot:'DAY'},pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',bookingState:'CONFIRMED_DEV',equipmentCount:1,nextAction:'NO_ACTION'};
  const rowB={...rowA,key:'B:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',bookingId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',displayName:'SYNTHETIC UX5D Page Row B'};
  await page.route('**/api/operations/manifest*',async route=>{
   const url=new URL(route.request().url()),cursor=url.searchParams.get('cursor');calls++;
   const body=cursor
    ?{store:url.searchParams.get('store'),date:businessDate,section:'all',generatedAt:now.toISOString(),pageSize:1,nextCursor:null,hasMore:false,rows:[rowA,rowB]}
    :{store:url.searchParams.get('store'),date:businessDate,section:'all',generatedAt:now.toISOString(),pageSize:1,nextCursor:'ux5d-fake-cursor',hasMore:true,rows:[rowA]};
   await route.fulfill({status:200,contentType:'application/json',headers:HEADERS,body:JSON.stringify(body)});
  });
  await page.goto('/staff');
  const section=dailyBusiness();
  await expect(section.locator('.staff-card',{hasText:'Page Row A'})).toHaveCount(1);
  await section.getByRole('button',{name:'さらに読み込む'}).click();
  await expect(section.locator('.staff-card',{hasText:'Page Row B'})).toHaveCount(1);
  // The mocked second page intentionally repeats row A's key — the client must dedupe by key.
  await expect(section.locator('.staff-card',{hasText:'Page Row A'})).toHaveCount(1);
  assert.ok(calls>=2,'expected an initial load and at least one load-more call');
  await page.unroute('**/api/operations/manifest*');
 });

 await check('switching the active store discards the previous store\'s task cards immediately, never leaving them visible even transiently',async()=>{
  await page.goto('/staff');
  await expect(dailyBusiness().locator('.staff-card',{hasText:'SYNTHETIC UX5D Confirmed'})).toBeVisible();
  await dailyBusiness().getByLabel('対象店舗').selectOption('ONSEN_BASE');
  // No equipment stock exists at ONSEN_BASE in this fixture, so a genuine empty page (not a
  // leftover MOUNTAIN_BASE card) is the only correct outcome here.
  await expect(dailyBusiness().locator('.staff-card',{hasText:'SYNTHETIC UX5D Confirmed'})).toHaveCount(0);
  await expect(dailyBusiness()).toContainText('現在対応が必要な項目はありません');
  await dailyBusiness().getByLabel('対象店舗').selectOption('MOUNTAIN_BASE');
  await expect(dailyBusiness().locator('.staff-card',{hasText:'SYNTHETIC UX5D Confirmed'})).toBeVisible();
 });

 await check('Staff Home is usable at 390 and 1440 with no horizontal overflow',async()=>{
  await mkdir('.local/screenshots',{recursive:true});
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:1000});await page.goto('/staff');
   await page.getByRole('button',{name:'更新',exact:true}).first().click();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'width '+width);
   await page.screenshot({path:`.local/screenshots/staff-home-${width}.png`,fullPage:true});
  }
  await onsenPage.goto('/staff'); // onsenPage's context is already 390x844, set at creation
  assert.ok(await onsenPage.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'CUSTODY_ONLY 390');
  await onsenPage.screenshot({path:'.local/screenshots/staff-home-custody-only-390.png',fullPage:true});
  await page.goto('/staff/rentals?booking='+confirmedId);await expect(page.getByRole('region',{name:'貸出用品'})).toContainText(confirmedId);
  await page.screenshot({path:'.local/screenshots/staff-rentals-preselected-390.png',fullPage:true});
 });

 await check('the retired /api/operations/exceptions and /api/custody/returns summary requests are never issued by Staff Home',async()=>{
  for(const forbidden of ['/api/operations/exceptions','/api/custody/returns'])assert.ok(!requestedPaths.some(p=>p.startsWith(forbidden)),forbidden+' should never be requested by Staff Home');
 });

 console.log(`STAFF HOME ordinary UI/real PostgreSQL: ${count} passed, no skipped. Synthetic data only.`);
}catch(e){failed=true;console.error('STAFF_HOME_UI_FAILED '+stage+' '+(e as Error).message.split('Call log:')[0]!.slice(0,800));}finally{await browser.close();await flow?.close();await app?.stop();console.log('Owned Staff Home Web/browser/PostgreSQL stopped.');}
if(failed)process.exit(1);
