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

// Issue #47 FB #7000732468 / #7001130803 / #7008569703: results never outlive their request (failure, late answer, target
// change), customer linking needs explicit confirmation, Scan refuses other stations and stale answers. Synthetic only.
const built=process.argv.includes('--built');
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,flow:Awaited<ReturnType<typeof provisionFlowRole>>|undefined,failed=false,stage='startup',count=0;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url'),shots='.local/evidence/issue47-accept';
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 await mkdir(shots,{recursive:true});
 app=await startDevelopmentApp({built,operations:true});const {origin,db}=app;
 for(let i=0;i<180;i++){try{if((await fetch(origin+'/staff/login')).status<500)break;}catch{/* starting */}await new Promise(r=>setTimeout(r,1000));}
 const root=await bootstrapDevelopmentAdmin(db.pool,{email:'accept-root@example.invalid',displayName:'SYNTHETIC Shell Root',password}),rootPrincipal=(await loadStaff(db.pool,root))!;
 // A staff member with the booking permissions the dashboard and orders need (same grants as tests/staff/home-ui.ts).
 const admin=(await writeAccount(app.roles.authPool,rootPrincipal,undefined,{active:true,role:'ADMIN',password,email:'accept-admin@example.invalid',displayName:'SYNTHETIC Shell Admin',scope:'ALL',storeIds:[],permissions:{HOLD_VIEW:true,HOLD_EDIT:true,QUOTE_VIEW:true,QUOTE_CREATE:true,PRICE_EDIT:true,BOOKING_VIEW:true,BOOKING_CREATE:true,RENTAL_CHECKOUT:true,RENTAL_RETURN:true,INVENTORY_VIEW:true}})).id!;
 await seedRecommendation(db.pool);
 const seed=await db.pool.connect();try{await seed.query('BEGIN');await seed.query("SELECT set_config('zao.actor','synthetic-shell',true),set_config('zao.reason','SYNTHETIC shell booking fixture',true)");
  await seed.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator)
   SELECT gen_random_uuid(),id,family,'MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE','NOT_APPLICABLE','','SYNTHETIC shell','SYNTHETIC','tests/staff/shell-ui.ts','shell-'||id FROM ledger_variants WHERE id=ANY($1::uuid[])`,[[variants.ski,variants.skiAlt,lengthVariants.ski135]]);await seed.query('COMMIT');
 }catch(e){await seed.query('ROLLBACK');throw e;}finally{seed.release();}
 const businessDate='2035-06-16',now=new Date(businessDate+'T10:00:00+09:00');
 await db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${now.toISOString()}'::timestamptz$$`);
 const context=await browser.newContext({baseURL:origin,viewport:{width:1440,height:900}}),page=await context.newPage();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/staff/login');await page.getByLabel('メールアドレス',{exact:true}).fill('accept-admin@example.invalid');await page.getByLabel('パスワード',{exact:true}).fill(password);
 await page.getByRole('button',{name:'ログイン',exact:true}).click();await page.waitForURL(u=>u.pathname.startsWith('/staff')&&!u.pathname.startsWith('/staff/login'),{timeout:60000});
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


 // A legacy booking (created before customer records) for the link confirmation case.
 await db.pool.query('ALTER TABLE rental_bookings DISABLE TRIGGER customer_capture_booking');
 let legacyId='';try{legacyId=await makeBooking('COMPLETED',variants.ski,'SYNTHETIC Accept Legacy','2035-06-18');}finally{await db.pool.query('ALTER TABLE rental_bookings ENABLE TRIGGER customer_capture_booking');}
 // An item at the other station, and two narrow staff members.
 const foreign=(await db.pool.query(`WITH s AS (SELECT set_config('zao.actor','synthetic-shell',true),set_config('zao.reason','SYNTHETIC foreign item',true))
   INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator)
   SELECT gen_random_uuid(),$1,'SKI','ONSEN_BASE','ONSEN_BASE','AVAILABLE','NOT_APPLICABLE','','SYNTHETIC accept','SYNTHETIC','tests/staff/acceptance-ui.ts','accept-onsen-'||gen_random_uuid() FROM s RETURNING id`,[variants.ski])).rows[0].id as string;
 const mountainItem=(await db.pool.query("SELECT id FROM ledger_assets WHERE variant_id=$1 AND store_id='MOUNTAIN_BASE' LIMIT 1",[variants.ski])).rows[0].id as string;
 const invOnly=(await writeAccount(app.roles.authPool,rootPrincipal,undefined,{active:true,role:'STAFF',password,email:'accept-inv@example.invalid',displayName:'SYNTHETIC Inventory Only',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{BOOKING_VIEW:false}})).id!;
 await writeAccount(app.roles.authPool,rootPrincipal,undefined,{active:true,role:'VIEWER',password,email:'accept-book@example.invalid',displayName:'SYNTHETIC Booking Only',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{BOOKING_VIEW:true,INVENTORY_VIEW:false}});
 async function login(email:string){const ctx=await browser.newContext({baseURL:origin,viewport:{width:1440,height:900}}),p=await ctx.newPage();await p.goto('/staff/login');
  await p.getByLabel('メールアドレス',{exact:true}).fill(email);await p.getByLabel('パスワード',{exact:true}).fill(password);await p.getByRole('button',{name:'ログイン',exact:true}).click();await p.waitForURL(u=>u.pathname.startsWith('/staff')&&!u.pathname.startsWith('/staff/login'),{timeout:60000});return {ctx,p};}

 await check('orders: a failed refresh with new filters hides the previous rows instead of leaving them usable',async()=>{
  await page.goto('/staff/orders');await page.getByRole('table').getByText('SYNTHETIC Shell Confirmed').waitFor();
  await page.route(/\/api\/operations\/orders\?.*status=RESERVED/,r=>r.fulfill({status:500,body:'{}',contentType:'application/json'}));
  await page.getByRole('checkbox',{name:'予約済み'}).click();await page.getByRole('alert').filter({hasText:'読み込めませんでした'}).waitFor();
  assert.equal(await page.getByRole('table').count(),0,'no stale table while the current query failed');await page.unroute(/\/api\/operations\/orders\?.*status=RESERVED/);
 });
 await check('dashboard: a slow earlier answer cannot overwrite a newer range; links keep late direction',async()=>{
  await page.goto('/staff');await page.getByRole('region',{name:/貸出予定/}).waitFor();
  await page.route(/\/api\/operations\/dashboard\?.*range=tomorrow/,async r=>{await new Promise(res=>setTimeout(res,2500));await r.continue();});
  await page.getByLabel('期間').selectOption('tomorrow');await page.getByLabel('期間').selectOption('today');
  await page.getByRole('region',{name:/貸出予定/}).getByText('SYNTHETIC Shell Confirmed').waitFor();await page.waitForTimeout(3000);
  assert.equal(await page.getByLabel('期間').inputValue(),'today');assert.ok(await page.getByRole('region',{name:/貸出予定/}).getByText('SYNTHETIC Shell Confirmed').isVisible(),'today still shown after the late tomorrow answer');
  const late=await page.getByRole('link',{name:/貸出遅れ/}).getAttribute('href');assert.match(late!,/late=out/);assert.match(late!,/direction=out/);
  const back=await page.getByRole('link',{name:/返却遅れ/}).getAttribute('href');assert.match(back!,/late=back/);assert.match(back!,/direction=back/);
  await page.unroute(/\/api\/operations\/dashboard\?.*range=tomorrow/);
 });
 await check('order detail: a failing target hides the previous order and its actions',async()=>{
  await page.goto('/staff/orders/'+confirmedId);await page.getByRole('heading',{name:'#'+confirmedId.slice(0,8).toUpperCase()}).waitFor();
  await page.route('**/api/operations/orders/'+pendingId,r=>r.fulfill({status:404,body:'{}',contentType:'application/json'}));
  await page.goto('/staff/orders/'+pendingId);
  await page.getByRole('alert').filter({hasText:'見つからない'}).waitFor();assert.equal(await page.getByRole('heading',{name:'#'+confirmedId.slice(0,8).toUpperCase()}).count(),0);
  await page.unroute('**/api/operations/orders/'+pendingId);
 });
 await check('product: a bookability answer disappears when its dates change',async()=>{
  const model=(await db.pool.query('SELECT model_id FROM ledger_variants WHERE id=$1',[variants.ski])).rows[0].model_id;
  await page.goto('/staff/inventory/'+model+'?store=MOUNTAIN_BASE');await page.getByLabel('サイズ',{exact:true}).selectOption({index:1});
  await page.getByLabel('開始日').fill('2035-07-01');await page.getByLabel('終了日').fill('2035-07-01');await page.getByRole('button',{name:'確認',exact:true}).click();
  const answer=page.getByRole('status').filter({hasText:/予約可能|在庫不足|判定できません/});await answer.waitFor();
  await page.getByLabel('終了日').fill('2035-07-02');assert.equal(await answer.count(),0,'old answer is not shown for new dates');
 });
 await check('customer link: nothing is sent before confirmation; cancel sends nothing; confirm sends exactly once',async()=>{
  let posts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/operations/customers/link'))posts++;});
  await page.goto('/staff/customers/'+encodeURIComponent('legacy:'+legacyId));await page.getByRole('heading',{name:'SYNTHETIC Accept Legacy'}).waitFor();
  await page.getByRole('searchbox',{name:'氏名・メールで検索'}).fill('SYNTHETIC Shell Confirmed');await page.getByRole('button',{name:'氏名・メールで検索'}).click();
  await page.getByLabel('関連付け先').selectOption({index:1});assert.equal(posts,0);
  await page.getByRole('button',{name:'内容を確認'}).click();await page.getByRole('group',{name:'内容を確認'}).waitFor();assert.equal(posts,0,'review shows the order, target and result without sending');
  await page.getByRole('button',{name:'取消'}).click();assert.equal(posts,0);
  await page.getByRole('button',{name:'内容を確認'}).click();await page.getByRole('button',{name:'関連付ける'}).click();await page.waitForURL(u=>/\/staff\/customers\/[0-9a-f-]{36}$/.test(u.pathname));
  assert.equal(posts,1);assert.ok((await db.pool.query('SELECT customer_id FROM customer_booking_links WHERE booking_id=$1',[legacyId])).rows[0]);
 });
 await check('scan: another station’s real item is refused; inventory-only staff get only the item tab; a station change applies immediately',async()=>{
  const {ctx,p}=await login('accept-inv@example.invalid');
  await p.goto('/staff/scan');assert.equal(await p.getByRole('tab',{name:'予約'}).count(),0,'no order tab without BOOKING_VIEW');
  await p.getByLabel('用品の個体ID').fill(foreign);await p.getByRole('button',{name:'入力したIDを照合へ送る'}).click();await p.getByRole('alert').filter({hasText:'見つからない'}).waitFor();
  assert.equal((await p.request.get('/api/operations/assets/'+mountainItem)).status(),200);
  await db.pool.query("UPDATE staff_store_access SET store_id='ONSEN_BASE' WHERE staff_id=$1",[invOnly]);
  assert.equal((await p.request.get('/api/operations/assets/'+mountainItem)).status(),404,'the live session no longer reaches Mountain');
  await ctx.close();
 });
 await check('scan: a late item answer after switching to an order cannot navigate away; booking-only staff get only the order tab; English input text',async()=>{
  await page.route('**/api/operations/assets/*',async r=>{await new Promise(res=>setTimeout(res,2500));await r.continue();});
  await page.goto('/staff/scan');await page.getByRole('tab',{name:'用品'}).click();await page.getByLabel('用品の個体ID').fill(mountainItem);await page.getByRole('button',{name:'入力したIDを照合へ送る'}).click();
  await page.getByRole('tab',{name:'予約'}).click();await page.getByLabel('予約番号または予約QR').fill(confirmedId);await page.getByRole('button',{name:'この予約を開く'}).click();
  await page.waitForURL(u=>u.pathname==='/staff/orders/'+confirmedId);await page.waitForTimeout(3500);assert.equal(new URL(page.url()).pathname,'/staff/orders/'+confirmedId);
  await page.unroute('**/api/operations/assets/*');
  const {ctx,p}=await login('accept-book@example.invalid');await p.goto('/staff/scan');assert.equal(await p.getByRole('tab',{name:'用品'}).count(),0);
  await p.getByRole('button',{name:'English'}).click();await p.getByLabel('Booking number or booking QR').waitFor();await p.getByRole('button',{name:'Open this booking'}).waitFor();
  await p.screenshot({path:`${shots}/scan-en-1440.png`});await ctx.close();
 });
 await check('DOC-01: a document never shows the previous session’s booking or print button after a session switch on the same URL',async()=>{
  await writeAccount(app!.roles.authPool,rootPrincipal,undefined,{active:true,role:'VIEWER',password,email:'accept-docb@example.invalid',displayName:'SYNTHETIC Docs B',scope:'ASSIGNED',storeIds:['ONSEN_BASE'],permissions:{BOOKING_VIEW:true}});
  const a=await login('accept-admin@example.invalid'),b=await login('accept-docb@example.invalid');const cookiesA=await a.ctx.cookies(),cookiesB=await b.ctx.cookies();await b.ctx.close();
  const p=a.p,url='/staff/documents?doc=booking&id='+confirmedId;await p.goto(url);
  await p.getByText('SYNTHETIC Shell Confirmed').waitFor();await p.getByRole('button',{name:'印刷'}).waitFor();
  // Session B (cannot see this MOUNTAIN booking) takes over the same tab; its answer for the same URL is held back.
  let release=()=>{};const held=new Promise<void>(f=>{release=f;});
  await p.route('**/api/operations/orders/'+confirmedId,async r=>{await held;await r.continue();});
  await a.ctx.clearCookies();await a.ctx.addCookies(cookiesB);
  // Sampling starts once the refreshed server payload (which carries B's stamp) has arrived; before that the tab still shows
  // A's own render, which B has not received.
  const refreshed=p.waitForResponse(r=>r.request().headers()['rsc']==='1'&&new URL(r.url()).pathname==='/staff/documents');
  await p.evaluate(()=>(window as unknown as {next:{router:{refresh():void}}}).next.router.refresh());await refreshed;await p.waitForTimeout(50);
  const leaks:string[]=[];for(let i=0;i<25;i++){if(await p.getByText('SYNTHETIC Shell Confirmed').count())leaks.push('customer@'+i);if(await p.getByRole('button',{name:'印刷'}).count())leaks.push('print@'+i);await p.waitForTimeout(100);}
  release();await p.waitForTimeout(1500);
  for(let i=0;i<10;i++){if(await p.getByText('SYNTHETIC Shell Confirmed').count())leaks.push('customer-after@'+i);if(await p.getByRole('button',{name:'印刷'}).count())leaks.push('print-after@'+i);await p.waitForTimeout(100);}
  assert.deepEqual(leaks,[],'session B never sees A’s booking content or print button');
  await p.unroute('**/api/operations/orders/'+confirmedId);
  // Back to A: a fresh, correctly authorized read shows it again.
  await a.ctx.clearCookies();await a.ctx.addCookies(cookiesA);await p.goto(url);await p.getByText('SYNTHETIC Shell Confirmed').waitFor();await p.getByRole('button',{name:'印刷'}).waitFor();
  await a.ctx.close();
 });
 await check('REP-02: a CSV is saved only for the session, conditions and page it was requested from; one at a time',async()=>{
  const a=await login('accept-admin@example.invalid'),b=await login('accept-docb@example.invalid');const cookiesA=await a.ctx.cookies(),cookiesB=await b.ctx.cookies();await b.ctx.close();
  const p=a.p;let downloads=0;p.on('download',()=>{downloads++;});
  const csv=/\/api\/operations\/reports\?.*format=csv/;let release=()=>{};
  const hold=async()=>{let f=()=>{};const held=new Promise<void>(r=>{f=r;});release=f;await p.route(csv,async r=>{await held;await r.continue();});};
  const open=async()=>{await p.goto('/staff/reports?type=bookings&stores=MOUNTAIN_BASE&from=2035-06-01&to=2035-06-30');await p.getByRole('button',{name:'CSV',exact:false}).first().waitFor();};
  const csvButton=()=>p.locator('main').getByRole('button',{name:/CSV/}).first();
  // 1. Session switch while the CSV is held: the late 200 saves nothing.
  await open();await hold();await csvButton().click();await a.ctx.clearCookies();await a.ctx.addCookies(cookiesB);
  const refreshed=p.waitForResponse(r=>r.request().headers()['rsc']==='1'&&new URL(r.url()).pathname==='/staff/reports');
  await p.evaluate(()=>(window as unknown as {next:{router:{refresh():void}}}).next.router.refresh());await refreshed.catch(()=>{});
  release();await p.waitForTimeout(1500);await p.unroute(csv);assert.equal(downloads,0,'no CSV after the session changed');
  // 2. Back to A: a normal CSV downloads exactly once, even with a double click.
  await a.ctx.clearCookies();await a.ctx.addCookies(cookiesA);await open();
  const one=p.waitForEvent('download');await csvButton().dblclick();await one;await p.waitForTimeout(1000);assert.equal(downloads,1,'double click saves one CSV');
  // 3. Conditions change while the CSV is held: the old-condition file is never saved.
  await hold();await csvButton().click();await p.getByLabel('開始日',{exact:true}).fill('2035-06-10');await p.waitForURL(/from=2035-06-10/);
  release();await p.waitForTimeout(1500);await p.unroute(csv);assert.equal(downloads,1,'no CSV for the previous conditions');
  // 4. Leaving the page while the CSV is held: nothing is saved.
  await hold();await csvButton().click();await p.goto('/staff/orders');release();await p.waitForTimeout(1500);await p.unroute(csv);assert.equal(downloads,1,'no CSV after leaving Reports');
  await a.ctx.close();
 });
 await check('DASH-PRINT-01: the Dashboard print link opens the complete work list for the same station and period; an incomplete list cannot be printed',async()=>{
  const {ctx,p}=await login('accept-admin@example.invalid');await p.goto('/staff');const link=p.getByRole('link',{name:'作業リストを印刷'});await link.waitFor();
  const href=new URL((await link.getAttribute('href'))!,origin);assert.equal(href.pathname,'/staff/documents');assert.equal(href.searchParams.get('doc'),'work');
  assert.ok(href.searchParams.get('store')&&href.searchParams.get('from')&&href.searchParams.get('to'),'station and period carried over');
  await link.click();await p.waitForURL(u=>u.pathname==='/staff/documents');await p.getByRole('button',{name:'印刷'}).waitFor();assert.equal(await p.getByRole('button',{name:'印刷'}).isEnabled(),true);
  // Over the bound (stubbed): no rows, no print button, one complete list per day, and ⌘P prints only the refusal.
  await p.route('**/api/operations/work-list?*',r=>{const u=new URL(r.request().url());return u.searchParams.get('from')!==u.searchParams.get('to')
   ?r.fulfill({json:{store:'MOUNTAIN_BASE',from:'2035-06-16',to:'2035-06-17',goingOut:[],comingBack:[],goingOutTotal:1500,comingBackTotal:0,max:1000,complete:false,days:[{date:'2035-06-16',goingOut:700,comingBack:0,complete:true},{date:'2035-06-17',goingOut:800,comingBack:0,complete:true}]}})
   :r.fulfill({json:{store:'MOUNTAIN_BASE',from:'2035-06-17',to:'2035-06-17',goingOut:[{id:crypto.randomUUID(),ref:'SYNTH001',customer:'SYNTHETIC Day',status:'RESERVED',startDate:'2035-06-17',endDate:'2035-06-17',slot:'DAY',people:1,pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE'}],comingBack:[],goingOutTotal:1,comingBackTotal:0,max:1000,complete:true,days:[{date:'2035-06-17',goingOut:1,comingBack:0,complete:true}]}});});
  await p.goto('/staff/documents?doc=work&store=MOUNTAIN_BASE&from=2035-06-16&to=2035-06-17');await p.getByRole('alert').filter({hasText:'収まりません'}).waitFor();
  assert.equal(await p.getByRole('button',{name:'印刷'}).count(),0,'no print button for an over-limit period');assert.equal(await p.locator('.ox-paper').count(),0,'no partial work list on the page');
  await p.emulateMedia({media:'print'});assert.equal(await p.locator('.ox-print-refusal').isVisible(),true,'printing the page shows only the refusal');assert.equal(await p.locator('.ox-split').isVisible(),false);await p.emulateMedia({media:'screen'});
  const dayLinks=p.getByRole('link',{name:'作業リストを開く'});assert.equal(await dayLinks.count(),2);await dayLinks.nth(1).click();
  await p.waitForURL(u=>u.searchParams.get('from')==='2035-06-17'&&u.searchParams.get('to')==='2035-06-17');await p.getByText('#SYNTH001').waitFor();assert.equal(await p.getByRole('button',{name:'印刷'}).isEnabled(),true);
  await ctx.close();
 });
 await check('BROWSER-01: opt-in browser notifications fire for a new booking while the tab is hidden, once across tabs; never for the backlog, after opt-out or without a session',async()=>{
  const {ctx}=await login('accept-admin@example.invalid');let shown=0;await ctx.exposeFunction('__notified',()=>{shown++;});
  const reads:string[]=[];ctx.on('request',r=>{if(r.url().includes('/api/operations/inbox?'))reads.push(new URL(r.url()).search);});
  // tsx adds __name(...) calls to serialized functions; define it in the page so the init script really runs.
  await ctx.addInitScript({content:'window.__name=window.__name||(f=>f);'});
  await ctx.addInitScript(()=>{const w=window as unknown as {__hidden:boolean;__notified:()=>void;Notification:unknown};w.__hidden=false;
   Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>w.__hidden?'hidden':'visible'});Object.defineProperty(document,'hidden',{configurable:true,get:()=>w.__hidden});
   class FakeNotification{static permission='granted';static requestPermission=async()=>'granted';constructor(){void w.__notified();}}w.Notification=FakeNotification;
   try{localStorage.setItem('zao-staff-browser-alerts','1');}catch{/* blocked */}});
  // Stable event ids per timestamp (as the real inbox has); `source` lets a step serve a historical import instead.
  let latest='2035-06-16T01:00:00.000Z',status=200,source:'LIVE'|'HISTORY_IMPORT'='LIVE';const idFor=(at:string,n:number)=>'00000000-0000-4000-8000-'+(Date.parse(at)/1000+n).toString(16).padStart(12,'0');
  const item=(at:string,n:number)=>({id:idFor(at,n),bookingId:idFor(at,n+7),state:'CONFIRMED',kind:'BOOKING_CONFIRMED',source:n===0?source:'LIVE',store:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',createdAt:n===0?at:'2035-06-16T00:00:00.000Z',acknowledgedAt:null,acknowledgedBy:null,startDate:'2035-06-17',endDate:'2035-06-17',slot:'DAY',people:1,customer:'SYNTHETIC Bell'});
  await ctx.route('**/api/operations/inbox?*',r=>status===200?r.fulfill({json:{unacknowledged:3,attention:0,total:3,latest,items:[item(latest,0),item(latest,1),item(latest,2)],next:null}}):r.fulfill({status,json:{error:'UNAUTHENTICATED'}}));
  const open=async()=>{const p=await ctx.newPage();await p.clock.install();await p.goto('/staff/settings');await p.locator('.sx-bell').waitFor();return p;};
  const hide=(p:import('@playwright/test').Page,hidden:boolean)=>p.evaluate(h=>{(window as unknown as {__hidden:boolean}).__hidden=h;document.dispatchEvent(new Event('visibilitychange'));},hidden);
  const p1=await open();await p1.clock.fastForward(1000);assert.equal(shown,0,'the first read (backlog) never notifies');
  await hide(p1,true);latest='2035-06-16T02:00:00.000Z';await p1.clock.fastForward(61000);await p1.waitForTimeout(300);assert.equal(shown,1,'a new booking while hidden notifies once; inbox reads='+reads.length+' '+JSON.stringify(await p1.evaluate(()=>({vis:document.visibilityState,flag:localStorage.getItem('zao-staff-browser-alerts'),perm:(window as unknown as {Notification:{permission:string}}).Notification.permission,bell:!!document.querySelector('.sx-bell')}))));
  await p1.clock.fastForward(61000);await p1.waitForTimeout(300);assert.equal(shown,1,'the same booking does not notify again');
  const p2=await open();await p2.clock.fastForward(1000);await hide(p2,true);latest='2035-06-16T03:00:00.000Z';
  await p1.clock.fastForward(61000);await p2.clock.fastForward(61000);await p1.waitForTimeout(300);assert.equal(shown,2,'two hidden tabs: one notification for one new booking');
  await p1.evaluate(()=>localStorage.removeItem('zao-staff-browser-alerts'));latest='2035-06-16T04:00:00.000Z';await p1.clock.fastForward(61000);await p2.clock.fastForward(61000);await p1.waitForTimeout(300);
  assert.equal(shown,2,'after opt-out: none');
  await p1.evaluate(()=>localStorage.setItem('zao-staff-browser-alerts','1'));source='HISTORY_IMPORT';latest='2035-06-16T05:00:00.000Z';await p1.clock.fastForward(61000);await p2.clock.fastForward(61000);await p1.waitForTimeout(300);
  assert.equal(shown,2,'a newer historical import never notifies');source='LIVE';
  await p1.evaluate(()=>{(window as unknown as {Notification:{permission:string}}).Notification.permission='denied';});await p2.close();latest='2035-06-16T06:00:00.000Z';await p1.clock.fastForward(61000);await p1.waitForTimeout(300);
  assert.equal(shown,2,'browser permission denied: none');await p1.evaluate(()=>{(window as unknown as {Notification:{permission:string}}).Notification.permission='granted';});
  status=401;latest='2035-06-16T07:00:00.000Z';await p1.clock.fastForward(61000);await p1.waitForTimeout(300);
  assert.equal(shown,2,'without a session: none');
  assert.ok(reads.length<=40,'bounded reads while hidden: '+reads.length);await ctx.close();
 });
 await check('CSV export: Orders, Customers and Inventory save the screen’s full row set in the staff language, never cached; a CSV requested before a filter change is never saved',async()=>{
  const {ctx,p}=await login('accept-admin@example.invalid');let session='';p.on('request',r=>{const h=r.headers()['x-zao-session'];if(h&&r.url().includes('/api/operations/'))session=h;});
  const rows=(body:string)=>body.replace(/^\uFEFF/,'').split('\r\n').filter(Boolean);
  for(const [path,api,head,total] of [['/staff/orders','orders','予約番号',(j:{total:number})=>j.total],['/staff/customers','customers','お名前',(j:{total:number})=>j.total],['/staff/inventory','products','店舗',(j:{rows:unknown[]})=>j.rows.length]] as const){
   const listed=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/operations/'+api&&!r.url().includes('format=csv')&&r.ok());await p.goto(path);const listResponse=await listed;const json=await listResponse.json();
   const button=p.locator('main').getByRole('button',{name:'CSVを保存'});await button.waitFor();
   const dl=p.waitForEvent('download');const csvResponse=p.waitForResponse(r=>r.url().includes('format=csv'));await button.click();const [download,res]=await Promise.all([dl,csvResponse]);
   assert.match(res.headers()['cache-control']??'',/no-store/,path+' no-store');assert.match(res.headers()['content-disposition']??'',/^attachment; filename="[a-z0-9_-]+\.csv"$/i,path);
   const body=await (await import('node:fs/promises')).readFile((await download.path())!,'utf8');const lines=rows(body);
   assert.equal(lines[0]!.split(',')[0],head,path+' Japanese header');assert.equal(lines.length-1,(total as (j:unknown)=>number)(json),path+' every row of the screen’s filters (all pages)');
   const url=new URL(res.url());url.searchParams.set('page','1');const paged=await ctx.request.get(url.toString(),{headers:{'x-zao-session':session}});assert.equal(paged.status(),422,path+' paging keys are refused with CSV');
  }
  // English header follows the staff language.
  const en=new URL('/api/operations/customers?format=csv&lang=en',origin);const enBody=await (await ctx.request.get(en.toString(),{headers:{'x-zao-session':session}})).text();assert.equal(rows(enBody)[0]!.split(',')[0],'Name');
  // REP-02 on the new screens: the CSV is held, the filter changes, the late 200 saves nothing.
  let downloads=0;p.on('download',()=>{downloads++;});let release=()=>{};const held=new Promise<void>(r=>{release=r;});
  await p.goto('/staff/orders');const button=p.locator('main').getByRole('button',{name:'CSVを保存'});await button.waitFor();
  await p.route(/format=csv/,async r=>{await held;await r.continue();});await button.click();
  await p.getByRole('tab',{name:/今後|Upcoming/}).click();await p.waitForURL(u=>u.searchParams.get('tab')==='upcoming');
  release();await p.waitForTimeout(1500);await p.unroute(/format=csv/);assert.equal(downloads,0,'no CSV after the filter changed');
  await ctx.close();
 });
 await check('UX-02: real order, customer, product and item screens read correctly at 1440, 390 and 200% zoom in Japanese and English, and their main actions are reachable by keyboard',async()=>{
  const {ctx,p}=await login('accept-admin@example.invalid');const errors:string[]=[];p.on('pageerror',e=>errors.push(e.message));
  const ref=confirmedId.slice(0,8).toUpperCase(),customer=(await db.pool.query('SELECT customer_id FROM customer_booking_links WHERE booking_id=$1',[confirmedId])).rows[0].customer_id as string;
  // The profile's name is that of its most recent booking (same email), as the Customers list shows it.
  const customerName=((await (await p.request.get('/api/operations/customers/'+customer)).json()) as {name:string}).name;assert.ok(customerName?.startsWith('SYNTHETIC'));
  const model=(await db.pool.query('SELECT v.model_id FROM ledger_assets a JOIN ledger_variants v ON v.id=a.variant_id WHERE a.id=$1',[mountainItem])).rows[0].model_id as string;
  // Each screen: a real record (never a not-found state), its own heading, and the control a person uses next.
  const screens=[{path:'/staff/orders/'+confirmedId,heading:'#'+ref,name:'order'},{path:'/staff/customers/'+customer,heading:customerName,name:'customer'},
   {path:`/staff/inventory/${model}?store=MOUNTAIN_BASE`,heading:null,name:'product'},{path:'/staff/scan',heading:null,name:'scan'}];
  // 200% browser zoom is the same CSS layout as half the window width (1440 → 720 CSS px at device scale 2).
  for(const [label,width,height,scale] of [['1440',1440,900,1],['390',390,844,1],['zoom200',720,450,2]] as const){
   const z=await ctx.browser()!.newContext({baseURL:origin,viewport:{width,height},deviceScaleFactor:scale,storageState:await ctx.storageState()});const zp=await z.newPage();zp.on('pageerror',e=>errors.push(e.message));
   for(const locale of ['ja','en'] as const){await z.addCookies([{name:'zao_staff_locale',value:locale,url:origin}]);
    for(const sc of screens){
     await zp.goto(sc.path,{waitUntil:'load'});const h1=zp.locator('main h1').first();await h1.waitFor({timeout:20000});
     if(sc.heading)assert.ok((await h1.innerText()).includes(sc.heading),`${label} ${locale} ${sc.name}: heading shows the real record (${await h1.innerText()})`);
     assert.equal(await zp.getByText(/見つかりません|not found/i).count(),0,`${label} ${locale} ${sc.name}: not a not-found state`);
     assert.equal(await zp.evaluate(()=>document.documentElement.lang),locale);
     assert.ok(await zp.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`${label} ${locale} ${sc.name}: no horizontal scroll`);
     // Keyboard: Tab from the top reaches a control inside main with a visible focus indicator.
     await zp.locator('body').focus();let reached=false;
     for(let i=0;i<40&&!reached;i++){await zp.keyboard.press('Tab');reached=await zp.evaluate(()=>{const a=document.activeElement as HTMLElement|null;if(!a||!a.closest('main'))return false;const st=getComputedStyle(a);return st.outlineStyle!=='none'&&st.outlineWidth!=='0px'||st.boxShadow!=='none';});}
     assert.ok(reached,`${label} ${locale} ${sc.name}: a main control is reachable by Tab with a visible focus ring`);
     await zp.screenshot({path:`${shots}/ux02-${label}-${locale}-${sc.name}.png`,fullPage:true});
    }
   }
   await z.close();
  }
  // From the order: the booking confirmation document opens for the same record.
  await p.goto('/staff/documents?doc=booking&id='+confirmedId);await p.getByText('#'+ref).first().waitFor();assert.equal(await p.getByRole('button',{name:'印刷'}).isEnabled(),true);
  assert.deepEqual(errors,[],'no page errors');await ctx.close();
 });
 await check('new order: staff API with the session header only, no browser storage, explicit customer choice; real route refuses without commercial composition',async()=>{
  const seen:{url:string;method:string;session:string|null;body:string|null}[]=[];page.on('request',r=>{if(/\/api\/(guest|staff-orders)/.test(r.url()))seen.push({url:r.url(),method:r.method(),session:r.headers()['x-zao-session']??null,body:r.postData()});});
  await page.goto('/staff/orders');const contextAnswer=page.waitForResponse(r=>r.url().endsWith('/api/staff-orders/context'));await page.locator('a[href="/staff/orders/new"]').first().click();await page.waitForURL('**/staff/orders/new');
  await page.getByRole('heading',{name:'新規予約',level:1}).waitFor();
  const refused=await contextAnswer;assert.equal(refused.status(),503,'the local app has no commercial composition: no simulated staff charge');
  assert.equal(seen.filter(r=>r.url.includes('/api/guest')).length,0,'never the guest cookie API');assert.ok(seen.every(r=>r.session&&/^[0-9a-f]{64}$/.test(r.session)),'every call carries the staff session stamp');
  assert.equal(await page.getByText('予約をお持ちの方はこちら').count(),0,'no guest recovery on the staff screen');
  assert.equal(await page.getByRole('link',{name:'BOOK',exact:true}).count(),0,'no public site header inside the staff shell');
  // UI wiring against a synthetic draft (the payment step itself needs the Production composition and is not exercised).
  const draftId=randomUUID(),customer=randomUUID();let selected:string|null=null,revision=1;const posts:unknown[]=[];
  const view=()=>({checkout:null,id:draftId,revision,input:null,locked:false,priceReviewRequired:false,selection:null,preview:null,hold:null,estimate:null,reviewHash:null,quote:null,booking:null,simulation:false,customerProfileId:selected});
  await page.route('**/api/staff-orders/**',async r=>{const path=new URL(r.request().url()).pathname;if(path.endsWith('/options'))return r.fulfill({json:{revision:'synthetic',models:[],sizes:[]}});
   if(r.request().method()==='POST'&&path.endsWith('/customer')){const b=r.request().postDataJSON();posts.push(b);selected=b.customerId;revision++;}return r.fulfill({json:view()});});
  await page.route(/\/api\/operations\/customers\?/,r=>r.fulfill({json:{rows:[{key:customer,name:'SYNTHETIC Existing',email:'synthetic-existing@example.invalid',bookings:2,lastStart:'2035-06-10',legacy:false},{key:'legacy:'+randomUUID(),name:'SYNTHETIC Legacy',email:null,bookings:1,lastStart:null,legacy:true}],total:2}}));
  await page.reload();const panel=page.getByRole('region',{name:'お客様'});await panel.getByRole('status').filter({hasText:'新しいお客様として登録'}).waitFor();
  await panel.getByRole('searchbox').fill('SYNTHETIC');await panel.getByRole('button',{name:'検索'}).click();
  assert.equal(await panel.getByRole('listitem').filter({hasText:'SYNTHETIC Legacy'}).getByRole('button').count(),0,'unlinked legacy rows cannot be chosen');
  await panel.getByRole('listitem').filter({hasText:'SYNTHETIC Existing'}).getByRole('button',{name:'このお客様にする'}).click();
  await panel.getByRole('status').filter({hasText:'SYNTHETIC Existing'}).waitFor();assert.deepEqual(posts,[{draftId,expectedRevision:1,customerId:customer}]);
  await panel.getByRole('button',{name:'新しいお客様として登録'}).click();await panel.getByRole('status').filter({hasText:'新しいお客様として登録'}).waitFor();assert.deepEqual(posts[1],{draftId,expectedRevision:2,customerId:null});
  assert.equal(await page.evaluate(()=>sessionStorage.length+localStorage.length),0,'nothing is kept in browser storage on the shared staff device');
  await page.screenshot({path:`${shots}/new-order-ja-1440.png`});await page.unroute('**/api/staff-orders/**');await page.unroute(/\/api\/operations\/customers\?/);
 });
 await check('new order isolation: guest/staff flows never share a route, header, pending context, draft or browser storage (TD FB #7010252887)',async()=>{
  const {ctx,p}=await login('accept-admin@example.invalid');
  // Storage instrumentation: count every Storage call made while a /staff page is shown, and make them throw.
  let staffStorage=0;await ctx.exposeFunction('__staffStorageHit',()=>{staffStorage++;});
  await ctx.addInitScript({content:'window.__name=window.__name||(f=>f);'});
  await ctx.addInitScript(()=>{const w=window as unknown as {__staffStorageHit:()=>void};const proto=Storage.prototype as unknown as Record<string,unknown>;
   for(const name of ['getItem','setItem','removeItem','key','clear']){const original=proto[name] as (...a:unknown[])=>unknown;proto[name]=function(this:Storage,...a:unknown[]){if(location.pathname==='/staff/orders/new'){void w.__staffStorageHit();throw new Error('STAFF_STORAGE_FORBIDDEN');}return original.apply(this,a);};}
   const len=Object.getOwnPropertyDescriptor(Storage.prototype,'length')!;Object.defineProperty(Storage.prototype,'length',{configurable:true,get(){if(location.pathname==='/staff/orders/new'){void w.__staffStorageHit();throw new Error('STAFF_STORAGE_FORBIDDEN');}return len.get!.call(this);}});});
  const guestId=randomUUID(),staffId=randomUUID(),customer=randomUUID();
  const view=(id:string,staff:boolean)=>({checkout:null,id,revision:1,input:null,locked:false,priceReviewRequired:false,selection:null,preview:null,hold:null,estimate:null,reviewHash:null,quote:null,booking:null,simulation:false,...(staff?{customerProfileId:null}:{})});
  const log:{route:'guest'|'staff'|'other';method:string;path:string;session:string|null;body:string|null;page:string}[]=[];
  ctx.on('request',r=>{const u=new URL(r.url());const route=u.origin!==origin?'other':u.pathname.startsWith('/api/guest')?'guest':u.pathname.startsWith('/api/staff-orders')?'staff':null;if(route)log.push({route,method:r.method(),path:u.pathname,session:r.headers()['x-zao-session']??null,body:r.postData(),page:r.frame().url()});});
  let releaseGuest=()=>{},releaseStaff=()=>{};const gate={guest:Promise.resolve(),staff:Promise.resolve()};
  await ctx.route('**/api/guest/**',async r=>{const path=new URL(r.request().url()).pathname;if(path.endsWith('/context')){await gate.guest;return r.fulfill({status:201,json:{}});}
   if(path.endsWith('/options'))return r.fulfill({json:{revision:'synthetic',models:[],sizes:[]}});return r.fulfill({json:view(guestId,false)});});
  await ctx.route('**/api/staff-orders/**',async r=>{const path=new URL(r.request().url()).pathname;if(path.endsWith('/context'))await gate.staff;
   if(path.endsWith('/options'))return r.fulfill({json:{revision:'synthetic',models:[],sizes:[]}});return r.fulfill({json:view(staffId,true)});});
  await ctx.route(/\/api\/operations\/customers\?/,r=>r.fulfill({json:{rows:[{key:customer,name:'SYNTHETIC Isolation',email:null,bookings:1,lastStart:null,legacy:false}],total:1}}));
  const push=(to:string)=>p.evaluate(path=>(window as unknown as {next:{router:{push(h:string):void}}}).next.router.push(path),to);
  const staffReady=async()=>{await p.getByRole('heading',{name:'新規予約',level:1}).waitFor();await p.getByRole('region',{name:'お客様'}).getByRole('status').waitFor();};
  const invariants=(label:string)=>{
   assert.equal(log.filter(r=>r.route==='other'&&r.method!=='GET').length,0,label+': no external POST');
   assert.ok(log.filter(r=>r.route==='staff').every(r=>r.session&&/^[0-9a-f]{64}$/.test(r.session)),label+': every staff call carries the session header');
   assert.equal(log.filter(r=>r.route==='guest'&&r.session).length,0,label+': no guest call carries a staff header');
   for(const r of log.filter(r=>r.route==='staff'&&r.body&&r.body.includes('draftId')))assert.equal(JSON.parse(r.body!).draftId,staffId,label+': staff writes only target the staff draft');
   for(const r of log.filter(r=>r.route==='guest'&&r.body&&r.body.includes('draftId')))assert.equal(JSON.parse(r.body!).draftId,guestId,label+': guest writes only target the guest draft');
  };
  // 1. guest /context pending -> client-side switch to the staff New order -> the guest answer arrives late.
  gate.guest=new Promise<void>(f=>{releaseGuest=f;});
  await p.goto('/ja/book');await p.waitForFunction(()=>performance.getEntriesByType('resource').some(e=>e.name.endsWith('/api/guest/context')),undefined,{timeout:30000}).catch(()=>{});
  await push('/staff/orders/new');await staffReady();releaseGuest();await p.waitForTimeout(1500);
  await p.getByRole('region',{name:'お客様'}).getByRole('listitem').waitFor({state:'detached'}).catch(()=>{});
  await p.getByRole('region',{name:'お客様'}).getByRole('searchbox').fill('SYNTHETIC');await p.getByRole('region',{name:'お客様'}).getByRole('button',{name:'検索'}).click();
  await p.getByRole('region',{name:'お客様'}).getByRole('button',{name:'このお客様にする'}).click();await p.waitForTimeout(500);
  assert.ok(log.some(r=>r.route==='staff'&&r.path.endsWith('/customer')&&JSON.parse(r.body!).draftId===staffId),'the selection went to the staff draft');invariants('guest->staff');
  // 2. reverse: staff /context pending -> switch to the public booking -> the staff answer arrives late.
  gate.staff=new Promise<void>(f=>{releaseStaff=f;});await p.reload();await p.waitForTimeout(500);
  await push('/ja/book');await p.getByRole('heading',{name:'レンタル予約',level:1}).waitFor();releaseStaff();await p.waitForTimeout(1500);
  assert.equal(await p.getByRole('region',{name:'お客様'}).count(),0,'a late staff answer never shows staff UI on the guest page');invariants('staff->guest');
  // 3. two mounts at once (guest tab + staff tab in one browser).
  const q=await ctx.newPage();await Promise.all([q.goto('/ja/book'),p.goto('/staff/orders/new')]);await staffReady();await q.getByRole('heading',{name:'レンタル予約',level:1}).waitFor();await p.waitForTimeout(500);invariants('parallel');
  assert.equal(await q.getByRole('region',{name:'お客様'}).count(),0);await q.close();
  // 4. session revoked -> sign in again: the old stamp is never reused; the new flow carries only the new one.
  const before=log.filter(r=>r.route==='staff').at(-1)!.session;
  await db.pool.query('DELETE FROM auth_session WHERE "userId"=$1',[admin]);await p.reload();assert.equal(await p.getByRole('region',{name:'お客様'}).count(),0,'no staff flow without a session');
  await p.goto('/staff/login');await p.getByLabel('メールアドレス',{exact:true}).fill('accept-admin@example.invalid');await p.getByLabel('パスワード',{exact:true}).fill(password);await p.getByRole('button',{name:'ログイン',exact:true}).click();
  await p.waitForURL(u=>!u.pathname.startsWith('/staff/login'),{timeout:60000});const mark=log.length;await p.goto('/staff/orders/new');await staffReady();
  const after=log.slice(mark).filter(r=>r.route==='staff');assert.ok(after.length>0);assert.ok(after.every(r=>r.session&&r.session!==before),'only the new session stamp after re-login');invariants('relogin');
  // The instrumentation is live: a deliberate Storage call on the staff page is counted (then excluded).
  await p.goto('/staff/orders/new');await staffReady();const probe=staffStorage;await p.evaluate(()=>{try{sessionStorage.getItem('x');}catch{/* counted */}});assert.equal(staffStorage,probe+1,'storage probe counted');staffStorage=probe;
  // 5. storage: the staff flow made zero Storage calls even though every Storage API throws there; the guest flow still loads.
  assert.equal(staffStorage,0,'staff flows (all cases above) never touched browser storage');
  await p.goto('/ja/book');await p.getByRole('heading',{name:'レンタル予約',level:1}).waitFor();
  await ctx.close();
 });
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'PASS',cases:count,screenshots:shots,externalRequests:0}));
 await context.close();
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,message:(e as Error).message?.slice(0,500)}));}
finally{await browser.close();await flow?.close();await app?.stop();}
if(failed)process.exitCode=1;
