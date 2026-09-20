import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {chromium,expect,type BrowserContext} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {provisionFlowRole} from '../../scripts/flow-roles';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {writeAccount} from '../../packages/auth/src/accounts';
import {seedRecommendation} from '../recommendation/fixture';
import {requestFor,variants} from '../inventory/fixture';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import {FakeGateway,simulation} from '../flow/fixture';
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,flow:Awaited<ReturnType<typeof provisionFlowRole>>|undefined,failed=false,stage='startup',count=0;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url');
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
function todayJst(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(new Date());}
try{
 app=await startDevelopmentApp({built:true,operations:true});const {origin,db,roles}=app;await seedRecommendation(db.pool);
 // The manifest/dashboard "today" must be the real JST calendar date (Staff Home computes it
 // from browser time, so a synthetic date here would desync from what the page actually shows).
 // But the checkout window (rental_validate_loan) and same-day period-end checks are real
 // business-hour gates (08:30-17:00 JST), so a run that happens to execute outside that window
 // would otherwise fail with PERIOD_ENDED/checkout-time errors that have nothing to do with this
 // batch. Pin inventory_clock() to a fixed, safe time of day on the real, unmodified JST date.
 const today=todayJst();
 const now=new Date(today+'T10:00:00+09:00');
 await db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${now.toISOString()}'::timestamptz$$`);
 const root=await bootstrapDevelopmentAdmin(db.pool,{email:'ux5a-root@example.invalid',displayName:'SYNTHETIC Admin',password}),admin=(await loadStaff(db.pool,root))!;
 const base={active:true,role:'ADMIN' as const,password};
 const full=(await writeAccount(roles.authPool,admin,undefined,{...base,email:'ux5a-full@example.invalid',displayName:'SYNTHETIC Full Staff',scope:'ALL',storeIds:[],permissions:{HOLD_VIEW:true,HOLD_EDIT:true,QUOTE_VIEW:true,QUOTE_CREATE:true,PRICE_EDIT:true,BOOKING_VIEW:true,BOOKING_CREATE:true,RENTAL_CHECKOUT:true,RENTAL_RETURN:true,OPERATIONS_VIEW:true,OPERATIONS_ACKNOWLEDGE:true,INVENTORY_VIEW:true,TRANSFER_VIEW:true}})).id!;
 // VIEWER carries a baseline INVENTORY_VIEW grant for every staff member (staff_role_permissions);
 // explicitly revoke it here so this account is genuinely narrow (BOOKING_VIEW only), the same
 // way an operator would configure a booking-only role in the real staff-management screen.
 await writeAccount(roles.authPool,admin,undefined,{...base,email:'ux5a-narrow@example.invalid',displayName:'SYNTHETIC Narrow Staff',role:'VIEWER',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{BOOKING_VIEW:true,INVENTORY_VIEW:false}});
 // UX5R-04: a valid permission composition where RENTAL_CHECKOUT/RENTAL_RETURN are granted but
 // BOOKING_VIEW is explicitly denied. /staff/rentals and the custody HTTP handler both require
 // BOOKING_VIEW first, so this account cannot actually use pickup or return.
 await writeAccount(roles.authPool,admin,undefined,{...base,email:'ux5a-inverse@example.invalid',displayName:'SYNTHETIC Inverse Staff',role:'STAFF',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{BOOKING_VIEW:false,RENTAL_CHECKOUT:true,RENTAL_RETURN:true}});
 for(let i=0;i<150;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}if(i===149)throw Error('LOCAL_START_TIMEOUT');await new Promise(r=>setTimeout(r,100));}
 async function context(){const c=await browser.newContext({baseURL:origin,viewport:{width:390,height:844}});c.setDefaultTimeout(15000);return c;}
 async function login(c:BrowserContext,email:string){const p=await c.newPage();await p.goto('/staff/login');await p.getByLabel('メールアドレス',{exact:true}).fill(email);await p.getByLabel('パスワード',{exact:true}).fill(password);await p.getByRole('button',{name:'ログイン',exact:true}).click();await p.waitForURL('**/staff/ledger');return p;}
 const owner=await context(),narrow=await context(),inverse=await context();
 const page=await login(owner,'ux5a-full@example.invalid'),narrowPage=await login(narrow,'ux5a-narrow@example.invalid'),inversePage=await login(inverse,'ux5a-inverse@example.invalid');
 const principal=(await loadStaff(db.pool,full))!,sessionId=(await db.pool.query('SELECT id FROM auth_session WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',[full])).rows[0].id as string;
 const holds=new HoldService(roles.holdPool,principal,()=>now),quotes=new QuoteService(roles.pricingPool,principal,()=>now);
 const year=now.getUTCFullYear();
 await quotes.initializePrivate(randomUUID(),(year-3)+'-01-01',(year+3)+'-12-31');
 flow=await provisionFlowRole(db.pool,db.identity);
 const fake=new FakeGateway(()=>now),bookings=new BookingService(flow.flowPool,roles.authPool,{subject:full,sessionId},fake,simulation);
 async function makeBooking(status:'COMPLETED'|'PENDING',variantId:string,displayName:string){
  const conditions=requestFor(today,[variantId]),held=await holds.command('create',randomUUID(),conditions),q=(await quotes.create(randomUUID(),{conditions,holdId:held.holdId,couponCode:null,wantAdvance:false})).quote;
  const booking=await bookings.create(randomUUID(),q.id,{displayName,email:'synthetic-ux5a-guest@example.invalid',termsAccepted:true});
  fake.status=status;await bookings.startPayment(booking.id,randomUUID());return booking.id;
 }
 const confirmedId=await makeBooking('COMPLETED',variants.ski,'SYNTHETIC UX5A Confirmed');await makeBooking('PENDING',variants.skiAlt,'SYNTHETIC UX5A Pending');
 assert.equal((await db.pool.query('SELECT state FROM rental_bookings WHERE id=$1',[confirmedId])).rows[0].state,'CONFIRMED_DEV');

 await check('operational Staff Home replaces the one-link page; narrow (BOOKING_VIEW-only) permission keeps Today read-only and hides every capability-gated section/link',async()=>{
  await page.goto('/staff');await expect(page.getByRole('heading',{name:'スタッフホーム'})).toBeVisible();
  await expect(page.getByRole('region',{name:'予約QR・検索'})).toBeVisible();
  await expect(page.getByRole('region',{name:'本日の予約'})).toBeVisible();
  await expect(page.getByRole('region',{name:'貸出・受付'})).toBeVisible();
  await expect(page.getByRole('region',{name:'返却の進行状況'})).toBeVisible();
  await expect(page.getByRole('region',{name:'運用の注意事項'})).toBeVisible();
  await page.getByText('その他の管理機能').click();
  for(const name of ['道具の台帳','棚卸・CSV投入','店舗間移動','見積','期間在庫・HOLD','サイズ推薦','ウェアの数量貸出・返却'])await expect(page.getByRole('link',{name})).toBeVisible();
  await narrowPage.goto('/staff');
  await expect(narrowPage.getByRole('region',{name:'本日の予約'})).toBeVisible();
  // UX5R-01: a BOOKING_VIEW-only account cannot actually use pickup, so the search/QR
  // entry point and every Today card's action must not be offered to it at all.
  for(const label of ['予約QR・検索','貸出・受付','返却の進行状況','運用の注意事項'])await expect(narrowPage.getByRole('region',{name:label})).toHaveCount(0);
  await expect(narrowPage.locator('.staff-card',{hasText:'SYNTHETIC UX5A Confirmed'}).getByRole('button')).toHaveCount(0);
  // UX5R-03: secondary links must match the destination route's own permission gate, not
  // "every authorized user".
  await narrowPage.getByText('その他の管理機能').click();
  for(const name of ['道具の台帳','棚卸・CSV投入','店舗間移動','見積','期間在庫・HOLD','サイズ推薦','ウェアの数量貸出・返却','スタッフ管理'])await expect(narrowPage.getByRole('link',{name})).toHaveCount(0);
  for(const name of ['変更・返金依頼','パスワード変更'])await expect(narrowPage.getByRole('link',{name})).toBeVisible();
 });

 await check('UX5R-04: RENTAL_CHECKOUT/RENTAL_RETURN without BOOKING_VIEW must not surface pickup/return/search surfaces the destination route would deny',async()=>{
  await inversePage.goto('/staff');await expect(inversePage.getByRole('heading',{name:'スタッフホーム'})).toBeVisible();
  for(const label of ['予約QR・検索','本日の予約','貸出・受付','返却の進行状況'])await expect(inversePage.getByRole('region',{name:label})).toHaveCount(0);
 });

 await check('Today booking card action is gated by RENTAL_CHECKOUT, not by the booking state (UX5R-01), and opens the real booking preselected into the pickup workflow',async()=>{
  await page.goto('/staff');
  const confirmedCard=page.locator('.staff-card',{hasText:'SYNTHETIC UX5A Confirmed'});await expect(confirmedCard).toBeVisible();
  await expect(confirmedCard).toContainText('確定済み');
  // The action is offered for a still-PAYMENT_PENDING booking too: the capability check
  // controls the action, never a client-side allowlist of booking states.
  const pendingCard=page.locator('.staff-card',{hasText:'SYNTHETIC UX5A Pending'});await expect(pendingCard).toContainText('決済照合待ち');
  await expect(pendingCard.getByRole('button',{name:'貸出・受付で状態を確認'})).toBeVisible();
  await confirmedCard.getByRole('button',{name:'貸出・受付で状態を確認'}).click();
  await page.waitForURL(new RegExp('/staff/rentals\\?booking='+confirmedId));
  await expect(page.getByRole('region',{name:'貸出用品'})).toContainText(confirmedId);
 });

 await check('booking search accepts the reservation QR payload text and lands preselected in the pickup workflow',async()=>{
  await page.goto('/staff');
  await page.getByLabel('予約番号または予約QR').fill('zao-rental:reservation:'+confirmedId);
  await page.getByRole('button',{name:'この予約を開く',exact:true}).click();
  await page.waitForURL(new RegExp('/staff/rentals\\?booking='+confirmedId));
  await expect(page.getByRole('region',{name:'貸出用品'})).toContainText(confirmedId);
  await page.getByLabel('準備・最終適合の作業記録').fill('SYNTHETIC UX5A staff fit; no automatic DIN');
  await page.getByLabel('表示された個体と数量を照合した（合成検証）').check();
  await page.getByRole('button',{name:'照合した用品を準備固定'}).click();
  await page.getByRole('button',{name:'道具の貸出を記録'}).click();
  await expect(page.getByRole('region',{name:'貸出用品'})).toContainText('OUT');
 });

 let assetId='';
 await check('returns in progress reflects the real open batch, then real received/inspection-pending after confirmation',async()=>{
  assetId=(await db.pool.query('SELECT asset_id FROM rental_loan_items WHERE booking_id=$1',[confirmedId])).rows[0].asset_id;
  const created=await page.request.post('/api/custody/batch',{headers:{origin},data:{requestKey:randomUUID(),input:{store:'MOUNTAIN_BASE'}}});assert.equal(created.status(),200);
  const batch=await created.json();
  const scanned=await page.request.post('/api/custody/scan',{headers:{origin},data:{requestKey:randomUUID(),input:{batchId:batch.id,expectedVersion:batch.version,assetId,poleLoanId:null}}});assert.equal(scanned.status(),200);
  await page.goto('/staff');await page.getByRole('button',{name:'更新',exact:true}).nth(1).click();
  await expect(page.getByRole('region',{name:'返却の進行状況'})).toContainText('保存済みの返却バッチ 1件');
  await expect(page.getByRole('region',{name:'返却の進行状況'})).toContainText('検品待ち 0件');
  const confirmed=await page.request.post('/api/custody/confirm',{headers:{origin},data:{requestKey:randomUUID(),input:{batchId:batch.id,expectedVersion:(await scanned.json()).version}}});assert.equal(confirmed.status(),200);
  await page.reload();await page.getByRole('button',{name:'更新',exact:true}).nth(1).click();
  await expect(page.getByRole('region',{name:'返却の進行状況'})).toContainText('検品待ち 1件');
 });

 await check('exceptions summary surfaces the real unacknowledged PAYMENT_PENDING exception, hidden without OPERATIONS_VIEW',async()=>{
  await page.goto('/staff');await page.getByRole('button',{name:'更新',exact:true}).nth(2).click();
  await expect(page.getByRole('region',{name:'運用の注意事項'})).toContainText('PAYMENT_PENDING');
  assert.equal((await narrow.request.get('/api/operations/exceptions?store=MOUNTAIN_BASE&ageHours=0&status=UNACKNOWLEDGED')).status(),403);
 });

 await check('Staff Home is usable at 390 and 1440 with no horizontal overflow',async()=>{
  await mkdir('.local/screenshots',{recursive:true});
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:1000});await page.goto('/staff');
   await page.getByRole('button',{name:'更新',exact:true}).first().click();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'width '+width);
   await page.screenshot({path:`.local/screenshots/staff-home-${width}.png`,fullPage:true});
  }
  await page.goto('/staff/rentals?booking='+confirmedId);await expect(page.getByRole('region',{name:'貸出用品'})).toContainText(confirmedId);
  await page.screenshot({path:'.local/screenshots/staff-rentals-preselected-390.png',fullPage:true});
 });

 console.log(`STAFF HOME ordinary UI/real PostgreSQL: ${count} passed, no skipped. Synthetic data only.`);
}catch(e){failed=true;console.error('STAFF_HOME_UI_FAILED '+stage+' '+(e as Error).message.split('Call log:')[0]!.slice(0,800));}finally{await browser.close();await flow?.close();await app?.stop();console.log('Owned Staff Home Web/browser/PostgreSQL stopped.');}
if(failed)process.exit(1);
