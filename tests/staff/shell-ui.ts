import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {chromium} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {randomUUID} from 'node:crypto';
import {recordSyntheticBookingProfile} from '../custody/preparation-fixture';
import {provisionFlowRole} from '../../scripts/flow-roles';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {writeAccount} from '../../packages/auth/src/accounts';
import {seedRecommendation,lengthVariants} from '../recommendation/fixture';
import {requestFor,variants} from '../inventory/fixture';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import {FakeGateway,simulation} from '../flow/fixture';

// Issue #47 §2A/§3/§6: shared staff shell (Booqable order, Apple look), JA/EN switch, /admin unified, settings and inbox.
// Synthetic local PostgreSQL and a local browser only. Screenshots go to .local/evidence/issue47-shell (not committed).
const built=process.argv.includes('--built');
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,flow:Awaited<ReturnType<typeof provisionFlowRole>>|undefined,failed=false,stage='startup',count=0;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url'),shots='.local/evidence/issue47-shell';
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 await mkdir(shots,{recursive:true});
 app=await startDevelopmentApp({built,operations:true});const {origin,db}=app;
 for(let i=0;i<180;i++){try{if((await fetch(origin+'/staff/login')).status<500)break;}catch{/* starting */}await new Promise(r=>setTimeout(r,1000));}
 const root=await bootstrapDevelopmentAdmin(db.pool,{email:'shell-root@example.invalid',displayName:'SYNTHETIC Shell Root',password}),rootPrincipal=(await loadStaff(db.pool,root))!;
 // A staff member with the booking permissions the dashboard and orders need (same grants as tests/staff/home-ui.ts).
 const admin=(await writeAccount(app.roles.authPool,rootPrincipal,undefined,{active:true,role:'ADMIN',password,email:'shell-admin@example.invalid',displayName:'SYNTHETIC Shell Admin',scope:'ALL',storeIds:[],permissions:{HOLD_VIEW:true,HOLD_EDIT:true,QUOTE_VIEW:true,QUOTE_CREATE:true,PRICE_EDIT:true,BOOKING_VIEW:true,BOOKING_CREATE:true,RENTAL_CHECKOUT:true,RENTAL_RETURN:true,INVENTORY_VIEW:true}})).id!;
 await seedRecommendation(db.pool);
 const seed=await db.pool.connect();try{await seed.query('BEGIN');await seed.query("SELECT set_config('zao.actor','synthetic-shell',true),set_config('zao.reason','SYNTHETIC shell booking fixture',true)");
  await seed.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator)
   SELECT gen_random_uuid(),id,family,'MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE','NOT_APPLICABLE','','SYNTHETIC shell','SYNTHETIC','tests/staff/shell-ui.ts','shell-'||id FROM ledger_variants WHERE id=ANY($1::uuid[])`,[[variants.ski,variants.skiAlt,lengthVariants.ski135]]);await seed.query('COMMIT');
 }catch(e){await seed.query('ROLLBACK');throw e;}finally{seed.release();}
 const businessDate='2035-06-16',now=new Date(businessDate+'T10:00:00+09:00');
 await db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${now.toISOString()}'::timestamptz$$`);
 const context=await browser.newContext({baseURL:origin,viewport:{width:1440,height:900}}),page=await context.newPage();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/staff/login');await page.getByLabel('メールアドレス',{exact:true}).fill('shell-admin@example.invalid');await page.getByLabel('パスワード',{exact:true}).fill(password);
 await page.getByRole('button',{name:'ログイン',exact:true}).click();await page.waitForURL('**/staff/ledger',{timeout:60000});
 const principal=(await loadStaff(db.pool,admin))!,sessionId=(await db.pool.query('SELECT id FROM auth_session WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',[admin])).rows[0].id as string;
 const holds=new HoldService(app.roles.holdPool,principal,()=>now),quotes=new QuoteService(app.roles.pricingPool,principal,()=>now);
 await quotes.initializePrivate(randomUUID(),'2032-01-01','2038-12-31');flow=await provisionFlowRole(db.pool,db.identity);
 const fake=new FakeGateway(()=>now),bookings=new BookingService(flow.flowPool,app.roles.authPool,{subject:admin,sessionId},fake,simulation);
 async function makeBooking(status:'COMPLETED'|'PENDING',variantId:string,displayName:string,date:string){
  const conditions=requestFor(date,[variantId]),held=await holds.command('create',randomUUID(),conditions),q=(await quotes.create(randomUUID(),{conditions,holdId:held.holdId,couponCode:null,wantAdvance:false})).quote;
  const booking=await bookings.create(randomUUID(),q.id,{displayName,email:'synthetic-shell-guest@example.invalid',termsAccepted:true});
  await recordSyntheticBookingProfile(db.pool,booking.id);fake.status=status;await bookings.startPayment(booking.id,randomUUID());return booking.id;
 }
 const confirmedId=await makeBooking('COMPLETED',variants.ski,'SYNTHETIC Shell Confirmed',businessDate);
 const pendingId=await makeBooking('PENDING',variants.skiAlt,'SYNTHETIC Shell Pending','2035-06-17');
 assert.equal((await db.pool.query('SELECT state FROM rental_bookings WHERE id=$1',[confirmedId])).rows[0].state,'CONFIRMED_DEV');

 await check('the shell lists only working destinations in Booqable order with settings at the bottom',async()=>{
  await page.goto('/staff');const nav=page.getByRole('complementary');
  const labels=(await nav.getByRole('link').allInnerTexts()).map(s=>s.trim()).filter(Boolean);
  const order=['ダッシュボード','予約','在庫','一括操作','設定','ログアウト'].filter(l=>labels.includes(l));
  assert.deepEqual(labels.filter(l=>order.includes(l)),order);assert.ok(labels.includes('設定'));
  for(const missing of ['カレンダー','顧客','書類','レポート','スキャン'])assert.ok(!labels.includes(missing),'no placeholder '+missing);
  assert.equal(await page.locator('html').getAttribute('lang'),'ja');
 });
 await check('dashboard: Going out / Coming back for today with the confirmed booking; tomorrow shows the pending one',async()=>{
  await page.goto('/staff');const out=page.getByRole('region',{name:/貸出予定/});await out.getByText('SYNTHETIC Shell Confirmed').waitFor();
  assert.equal(await out.getByText('SYNTHETIC Shell Pending').count(),0);await page.getByRole('region',{name:/返却予定/}).getByText('SYNTHETIC Shell Confirmed').waitFor();
  await page.screenshot({path:`${shots}/dashboard-ja-1440.png`});
  await page.getByLabel('期間').selectOption('tomorrow');await page.waitForURL(/range=tomorrow/);await out.getByText('SYNTHETIC Shell Pending').waitFor();
  assert.ok(await out.getByText(/決済確認中|決済要確認/).count()>0,'payment-unsettled booking is not shown as reserved');
  await out.getByRole('link',{name:/SYNTHETIC Shell Pending/}).click();await page.waitForURL(url=>url.searchParams.get('booking')===pendingId);
 });
 await check('orders: tabs, status filter and server totals; row opens the order',async()=>{
  await page.goto('/staff/orders');const table=page.getByRole('table');await table.getByText('SYNTHETIC Shell Confirmed').waitFor();
  assert.equal(await table.getByRole('row').count(),3);await page.screenshot({path:`${shots}/orders-ja-1440.png`});
  await page.getByRole('checkbox',{name:'予約済み'}).click();await page.waitForURL(/status=RESERVED/);assert.equal(await page.getByRole('checkbox',{name:'予約済み'}).isChecked(),true);await page.waitForFunction(()=>document.querySelectorAll('table tbody tr').length===1);
  await table.getByText('SYNTHETIC Shell Confirmed').waitFor();
  await page.getByRole('tab',{name:/今後/}).click();await page.waitForURL(/tab=upcoming/);
 });
 await check('bell: the confirmed booking is an unacknowledged inbox item; opening does not acknowledge; acknowledging clears it',async()=>{
  await page.goto('/staff');const bell=page.getByRole('button',{name:'通知 (1)'});await bell.waitFor({timeout:40000});await bell.click();
  const dialog=page.getByRole('dialog',{name:'新しい予約'});await dialog.getByText('SYNTHETIC Shell Confirmed').waitFor();
  assert.equal(Number((await db.pool.query('SELECT count(*)::int n FROM staff_booking_events WHERE acknowledged_at IS NOT NULL')).rows[0].n),0);
  await page.screenshot({path:`${shots}/bell-ja-1440.png`});
  await dialog.getByRole('button',{name:'確認済みにする'}).click();await page.getByRole('button',{name:'通知 (0)'}).waitFor();
  const ack=(await db.pool.query('SELECT acknowledged_by FROM staff_booking_events WHERE booking_id=$1',[confirmedId])).rows;assert.deepEqual(ack,[{acknowledged_by:admin}]);
 });
 await check('/admin opens the same working shell instead of a placeholder',async()=>{
  await page.goto('/admin');await page.waitForURL('**/staff');assert.equal(await page.getByText('準備中').count(),0);
 });
 await check('language switch keeps the URL and query, persists, and sets html lang',async()=>{
  await page.goto('/staff/notifications?keep=1');await page.getByRole('button',{name:'English'}).click();
  await page.getByRole('heading',{name:'New bookings'}).waitFor();assert.match(page.url(),/\/staff\/notifications\?keep=1$/);
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  await page.reload();await page.getByRole('heading',{name:'New bookings'}).waitFor();assert.equal(await page.locator('html').getAttribute('lang'),'en');
  await page.screenshot({path:`${shots}/notifications-en-1440.png`});
 });
 await check('settings: own email opt-in saves on the server and reads back after reload',async()=>{
  await page.goto('/staff/settings');const box=page.getByRole('checkbox',{name:/Email me at my sign-in address/});await box.waitFor();
  assert.equal(await box.isChecked(),false);await box.check();await page.getByRole('button',{name:'Save'}).click();await page.getByText('Saved.').waitFor();
  await page.reload();assert.equal(await page.getByRole('checkbox',{name:/Email me at my sign-in address/}).isChecked(),true);
  const row=(await db.pool.query('SELECT r.email_enabled,u.email FROM staff_notification_recipients r JOIN auth_user u ON u.id=r.staff_id')).rows;
  assert.deepEqual(row,[{email_enabled:true,email:'shell-admin@example.invalid'}]);
  await page.screenshot({path:`${shots}/settings-en-1440.png`});
 });
 await check('English dashboard and orders',async()=>{
  await page.goto('/staff');await page.getByRole('region',{name:/Going out/}).waitFor();await page.screenshot({path:`${shots}/dashboard-en-1440.png`});
  await page.goto('/staff/orders');await page.getByRole('columnheader',{name:'Payment'}).waitFor();await page.screenshot({path:`${shots}/orders-en-1440.png`});
 });
 await check('phone width: menu button opens the sidebar; no horizontal page scroll',async()=>{
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'English'}).waitFor();await page.getByRole('button',{name:'日本語'}).click();
  await page.goto('/staff');await page.getByRole('button',{name:'メニュー'}).waitFor();await page.getByRole('region',{name:/貸出予定/}).waitFor();await page.screenshot({path:`${shots}/dashboard-ja-390.png`});
  await page.getByRole('button',{name:'返却予定'}).click();assert.equal(await page.getByRole('region',{name:/貸出予定/}).isVisible(),false);await page.getByRole('button',{name:'すべて'}).click();
  await page.getByRole('button',{name:'メニュー'}).click();await page.getByRole('link',{name:'設定'}).waitFor();await page.screenshot({path:`${shots}/menu-ja-390.png`});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);assert.equal(overflow,false);
 });
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'PASS',cases:count,screenshots:shots,externalRequests:0}));
 await context.close();
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,message:(e as Error).message?.slice(0,500)}));}
finally{await browser.close();await flow?.close();await app?.stop();}
if(failed)process.exitCode=1;
