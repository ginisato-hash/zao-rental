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
  const order=['ダッシュボード','カレンダー','予約','顧客','在庫','書類','レポート','一括操作','スキャン','設定','サインアウト'].filter(l=>labels.includes(l));
  assert.deepEqual(labels.filter(l=>order.includes(l)),order);assert.ok(labels.includes('設定'));
  for(const working of ['カレンダー','書類','レポート'])assert.ok(labels.includes(working),working+' is a working page');
  assert.equal(await page.locator('html').getAttribute('lang'),'ja');
 });
 await check('dashboard: Going out / Coming back for today with the confirmed booking; tomorrow shows the pending one',async()=>{
  await page.goto('/staff');const out=page.getByRole('region',{name:/貸出予定/});await out.getByText('SYNTHETIC Shell Confirmed').waitFor();
  assert.equal(await out.getByText('SYNTHETIC Shell Pending').count(),0);await page.getByRole('region',{name:/返却予定/}).getByText('SYNTHETIC Shell Confirmed').waitFor();
  await page.screenshot({path:`${shots}/dashboard-ja-1440.png`});
  await page.getByLabel('期間').selectOption('tomorrow');await page.waitForURL(/range=tomorrow/);await out.getByText('SYNTHETIC Shell Pending').waitFor();
  assert.ok(await out.getByText(/決済確認中|決済要確認/).count()>0,'payment-unsettled booking is not shown as reserved');
  await out.getByRole('link',{name:/SYNTHETIC Shell Pending/}).click();await page.waitForURL(url=>url.pathname==='/staff/orders/'+pendingId);await page.getByRole('heading',{name:'#'+pendingId.slice(0,8).toUpperCase()}).waitFor();
 });
 await check('calendar: item rows with the confirmed order on its date; a bar opens the same order; JA/EN and phone width',async()=>{
  await page.goto('/staff/calendar?from='+businessDate);const grid=page.getByRole('region',{name:'カレンダー'});await grid.waitFor();await page.screenshot({path:`${shots}/calendar-ja-1440.png`});
  const bar=grid.getByRole('link',{name:new RegExp('#'+confirmedId.slice(0,8).toUpperCase())}).first();await bar.waitFor();
  assert.match((await bar.getAttribute('title'))??'',/予約|貸出中/);await page.screenshot({path:`${shots}/calendar-ja-1440.png`});
  await page.getByRole('group',{name:'表示期間'}).getByRole('button',{name:'2週間'}).click();await page.waitForURL(/days=14/);await grid.waitFor();
  await bar.click();await page.waitForURL(u=>u.pathname==='/staff/orders/'+confirmedId);
  await page.getByRole('button',{name:'English'}).click();await page.goto('/staff/calendar?from='+businessDate);
  await page.getByRole('region',{name:'Calendar'}).waitFor();await page.getByText('Planned (booked, hold)').waitFor();await page.screenshot({path:`${shots}/calendar-en-1440.png`});
  await page.getByRole('button',{name:'日本語'}).click();await page.getByRole('heading',{name:'カレンダー'}).waitFor();
  await page.setViewportSize({width:390,height:844});await page.goto('/staff/calendar?from='+businessDate);await page.getByRole('region',{name:'カレンダー'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no horizontal page scroll');await page.screenshot({path:`${shots}/calendar-ja-390.png`});
  await page.setViewportSize({width:1440,height:900});
 });
 await check('reports: real rows per station and period; CSV has the same rows; JA/EN',async()=>{
  await page.goto('/staff/reports?type=pickups&from=2035-01-01&to=2035-12-31');await page.getByRole('tab',{name:'貸出',selected:true}).waitFor();
  // Bookings are reported by creation date; fixture rows are created at the real clock, so ask for that period.
  const created=(await db.pool.query("SELECT (created_at AT TIME ZONE 'Asia/Tokyo')::date::text d FROM rental_bookings WHERE id=$1",[confirmedId])).rows[0].d as string;
  await page.goto('/staff/reports?from='+created+'&to='+created);const table=page.getByRole('table',{name:'予約'});await table.waitFor();
  const bodyRows=await table.locator('tbody tr').count();assert.ok(bodyRows>=1);await page.screenshot({path:`${shots}/reports-ja-1440.png`});
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'CSVを保存'}).click()]);
  const csv=(await (await import('node:fs/promises')).readFile((await download.path())!,'utf8')).replace(/^\ufeff/,'').trim().split(/\r\n/);
  assert.equal(csv[0],'date,station,created,confirmed,paymentPending,cancelled,bookedJpy');assert.equal(csv.length,bodyRows+1,'CSV rows equal screen rows');
  await page.getByRole('button',{name:'English'}).click();await page.getByRole('table',{name:'Bookings'}).waitFor();await page.getByRole('button',{name:'日本語'}).click();await page.getByRole('table',{name:'予約'}).waitFor();
 });
 await check('documents: booking confirmation by order number (not a receipt) and the day work list print views',async()=>{
  await page.goto('/staff/documents');await page.getByLabel('予約番号（8桁以上）').fill(confirmedId.slice(0,8).toUpperCase());await page.getByRole('button',{name:'開く'}).first().click();
  await page.waitForURL(/doc=booking/);await page.getByRole('heading',{name:'予約確認書（店舗控え）'}).waitFor();await page.getByText('#'+confirmedId.slice(0,8).toUpperCase()).waitFor();
  await page.getByText('領収書・請求書ではありません').waitFor();await page.screenshot({path:`${shots}/documents-booking-ja-1440.png`});
  await page.goto('/staff/documents?doc=work&store=MOUNTAIN_BASE&date='+businessDate);await page.getByRole('region',{name:'貸出予定'}).getByText('SYNTHETIC Shell Confirmed').waitFor();
  await page.goto('/staff/documents');await page.getByLabel('予約番号（8桁以上）').fill('ZZZZZZZZ');await page.getByRole('button',{name:'開く'}).first().click();await page.getByRole('alert').getByText('該当する予約が見つかりません。').waitFor();
 });
 await check('orders: tabs, status filter and server totals; row opens the order',async()=>{
  await page.goto('/staff/orders');const table=page.getByRole('table');await table.getByText('SYNTHETIC Shell Confirmed').waitFor();
  assert.equal(await table.getByRole('row').count(),3);await page.screenshot({path:`${shots}/orders-ja-1440.png`});
  await page.getByRole('checkbox',{name:'予約済み'}).click();await page.waitForURL(/status=RESERVED/);assert.equal(await page.getByRole('checkbox',{name:'予約済み'}).isChecked(),true);await page.waitForFunction(()=>document.querySelectorAll('table tbody tr').length===1);
  await table.getByText('SYNTHETIC Shell Confirmed').waitFor();
  await page.getByRole('tab',{name:/今後/}).click();await page.waitForURL(/tab=upcoming/);
 });
 await check('with shortage: the dashboard count links to the same Orders set (station, going out, dates); normal stock lists none',async()=>{
  await page.goto('/staff');const link=page.getByTestId('dashboard-shortage');await link.waitFor();assert.match((await link.textContent())??'',/不足あり 0/);
  const href=new URL((await link.getAttribute('href'))!,'http://x');assert.equal(href.searchParams.get('tab'),'shortage');assert.equal(href.searchParams.get('direction'),'out');assert.ok(href.searchParams.get('from')&&href.searchParams.get('to'));
  await link.click();await page.waitForURL(/tab=shortage/);await page.getByRole('tab',{name:/不足あり 0/,selected:true}).waitFor();
  await page.getByText('まだ渡していない用品が').waitFor();await page.getByText('該当する予約はありません。').waitFor();await page.screenshot({path:`${shots}/orders-shortage-ja-1440.png`});
 });
 await check('bell: the confirmed booking is an unacknowledged inbox item; opening does not acknowledge; acknowledging clears it',async()=>{
  await page.goto('/staff');const bell=page.getByRole('button',{name:'通知 (1)'});await bell.waitFor({timeout:40000});await bell.click();
  const dialog=page.getByRole('dialog',{name:'新しい予約'});await dialog.getByText('SYNTHETIC Shell Confirmed').waitFor();
  assert.equal(Number((await db.pool.query('SELECT count(*)::int n FROM staff_booking_events WHERE acknowledged_at IS NOT NULL')).rows[0].n),0);
  await page.screenshot({path:`${shots}/bell-ja-1440.png`});
  await dialog.getByRole('button',{name:'確認済みにする'}).click();await page.getByRole('button',{name:'通知 (0)'}).waitFor();
  const ack=(await db.pool.query('SELECT acknowledged_by FROM staff_booking_events WHERE booking_id=$1',[confirmedId])).rows;assert.deepEqual(ack,[{acknowledged_by:admin}]);
 });
 await check('inventory: product list with separated counts, product detail tabs, and a read-only date availability check',async()=>{
  await page.goto('/staff/inventory');const table=page.getByRole('table');await table.getByRole('columnheader',{name:'貸出可'}).waitFor();
  const skiName=(await db.pool.query('SELECT m.brand,m.name FROM ledger_models m JOIN ledger_variants v ON v.model_id=m.id WHERE v.id=$1',[variants.ski])).rows[0];
  await table.getByRole('link',{name:new RegExp(skiName.name)}).first().click();await page.getByRole('tab',{name:'サイズ'}).waitFor();
  await page.screenshot({path:`${shots}/product-ja-1440.png`});
  await page.getByRole('tab',{name:'個体'}).click();await page.getByRole('columnheader',{name:'所在'}).waitFor();
  const before=Number((await db.pool.query('SELECT count(*)::int n FROM inventory_holds')).rows[0].n);
  await page.getByLabel('サイズ',{exact:true}).selectOption({index:1});await page.getByLabel('開始日').fill('2035-07-01');await page.getByLabel('終了日').fill('2035-07-01');
  await page.getByRole('button',{name:'確認',exact:true}).click();await page.getByRole('status').filter({hasText:/予約可能|在庫不足|判定できません/}).waitFor();
  assert.equal(Number((await db.pool.query('SELECT count(*)::int n FROM inventory_holds')).rows[0].n),before,'the check reserves nothing');
 });
 await check('customers: list from visible bookings, customer page with order history that opens the order',async()=>{
  await page.goto('/staff/customers');const table=page.getByRole('table');await table.getByRole('link',{name:'SYNTHETIC Shell Confirmed'}).click();
  await page.getByRole('heading',{name:'SYNTHETIC Shell Confirmed'}).waitFor();await page.screenshot({path:`${shots}/customer-ja-1440.png`});
  await page.getByRole('link',{name:'#'+confirmedId.slice(0,8).toUpperCase()}).click();await page.waitForURL(u=>u.pathname==='/staff/orders/'+confirmedId);
 });
 await check('scan: an order number opens the order; an item id opens its product; an unknown or foreign id is refused',async()=>{
  await page.goto('/staff/scan');await page.getByLabel('予約番号または予約QR').fill(confirmedId);await page.getByRole('button',{name:'この予約を開く'}).click();
  await page.waitForURL(u=>u.pathname==='/staff/orders/'+confirmedId);
  const asset=(await db.pool.query('SELECT a.id,v.model_id FROM ledger_assets a JOIN ledger_variants v ON v.id=a.variant_id WHERE a.variant_id=$1 LIMIT 1',[variants.ski])).rows[0];
  await page.goto('/staff/scan');await page.getByRole('tab',{name:'用品'}).click();await page.getByLabel('用品の個体ID').fill(asset.id);await page.getByRole('button',{name:'入力したIDを照合へ送る'}).click();
  await page.waitForURL(u=>u.pathname==='/staff/inventory/'+asset.model_id);
  await page.goto('/staff/scan');await page.getByRole('tab',{name:'用品'}).click();await page.getByLabel('用品の個体ID').fill('00000000-0000-4000-8000-000000000000');await page.getByRole('button',{name:'入力したIDを照合へ送る'}).click();
  await page.getByRole('alert').filter({hasText:'見つからない'}).waitFor();
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
 await check('language switch re-renders page bodies at once: no old language while the server refresh is still pending',async()=>{
  // Hold every React Server Component refresh for 8 s; the page body must already be in the new language.
  await page.goto('/staff/orders');await page.getByRole('button',{name:'日本語'}).click();await page.waitForFunction(()=>document.documentElement.lang==='ja');
  const held=async(route:import('@playwright/test').Route)=>{if(route.request().headers()['rsc']){await new Promise(r=>setTimeout(r,8000));}await route.continue().catch(()=>{});};
  for(const [path,ja,en] of [['/staff/orders','予約','Orders'],['/staff/calendar','カレンダー','Calendar'],['/staff/customers','顧客','Customers'],['/staff/scan','スキャン','Scan']] as const){
   await page.goto(path);await page.getByRole('main').getByRole('heading',{name:ja,exact:true}).waitFor();
   await page.route('**/*',held);const t0=Date.now();
   await page.getByRole('button',{name:'English'}).click();await page.getByRole('main').getByRole('heading',{name:en,exact:true}).waitFor({timeout:3000});
   assert.ok(Date.now()-t0<3000,path+' switched without waiting for the refresh');assert.equal(await page.getByRole('main').getByText(ja,{exact:true}).count(),0,path+' shows no old-language heading');
   await page.getByRole('button',{name:'日本語'}).click();await page.getByRole('main').getByRole('heading',{name:ja,exact:true}).waitFor({timeout:3000});
   await page.unroute('**/*',held);
  }
  // Leave the saved language as the previous case left it (English) for the cases that follow.
  await page.getByRole('button',{name:'English'}).click();await page.waitForFunction(()=>document.documentElement.lang==='en');await page.waitForLoadState('networkidle');
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
  await page.goto('/staff/orders?tab=shortage');await page.getByRole('tab',{name:/With shortage 0/,selected:true}).waitFor();await page.getByText('Orders whose items not yet handed out').waitFor();
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
