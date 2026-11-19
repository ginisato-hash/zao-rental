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
  await p.getByLabel('メールアドレス',{exact:true}).fill(email);await p.getByLabel('パスワード',{exact:true}).fill(password);await p.getByRole('button',{name:'ログイン',exact:true}).click();await p.waitForURL(u=>u.pathname.startsWith('/staff/')&&!u.pathname.startsWith('/staff/login'),{timeout:60000});return {ctx,p};}

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
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'PASS',cases:count,screenshots:shots,externalRequests:0}));
 await context.close();
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,message:(e as Error).message?.slice(0,500)}));}
finally{await browser.close();await flow?.close();await app?.stop();}
if(failed)process.exitCode=1;
