import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {chromium,expect,type BrowserContext} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {writeAccount} from '../../packages/auth/src/accounts';
import {seedRecommendation} from '../recommendation/fixture';
import {requestFor} from '../inventory/fixture';
import {provisionFlowRole} from '../../scripts/flow-roles';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import {FakeGateway,simulation} from '../flow/fixture';
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,flow:Awaited<ReturnType<typeof provisionFlowRole>>|undefined,failed=false,stage='startup',count=0,external=0;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url');
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 app=await startDevelopmentApp({built:true,operations:true});const {origin,db,roles}=app;await seedRecommendation(db.pool,true);
 const now=new Date('2035-01-01T10:00:00+09:00');await db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${now.toISOString()}'::timestamptz$$`);
 const root=await bootstrapDevelopmentAdmin(db.pool,{email:'m17-root@example.invalid',displayName:'SYNTHETIC Admin',password}),admin=(await loadStaff(db.pool,root))!;
 const base={active:true,role:'ADMIN' as const,password};
 const actor=(await writeAccount(roles.authPool,admin,undefined,{...base,email:'m17-operator@example.invalid',displayName:'SYNTHETIC Operator',scope:'ALL',storeIds:[],permissions:{INVENTORY_VIEW:true,HOLD_VIEW:true,HOLD_EDIT:true,QUOTE_VIEW:true,QUOTE_CREATE:true,PRICE_EDIT:true,BOOKING_VIEW:true,BOOKING_CREATE:true,OPERATIONS_VIEW:true,OPERATIONS_ACKNOWLEDGE:true}})).id!;
 await writeAccount(roles.authPool,admin,undefined,{...base,email:'m17-reader@example.invalid',displayName:'SYNTHETIC Reader',role:'VIEWER',scope:'ASSIGNED',storeIds:['ONSEN_BASE'],permissions:{BOOKING_VIEW:true,OPERATIONS_VIEW:true}});
 await writeAccount(roles.authPool,admin,undefined,{...base,email:'m17-plain@example.invalid',displayName:'SYNTHETIC Plain',role:'VIEWER',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{BOOKING_VIEW:true}});
 for(let i=0;i<150;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}if(i===149)throw Error('LOCAL_START_TIMEOUT');await new Promise(r=>setTimeout(r,100));}
 async function context(){const c=await browser.newContext({baseURL:origin,viewport:{width:1440,height:1000}});c.setDefaultTimeout(15000);await c.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('data:'))return route.continue();external++;return route.abort();});return c;}
 async function login(c:BrowserContext,email:string){const p=await c.newPage();await p.goto('/staff/login');await p.getByLabel('メールアドレス',{exact:true}).fill(email);await p.getByLabel('パスワード',{exact:true}).fill(password);await p.getByRole('button',{name:'ログイン',exact:true}).click();await p.waitForURL('**/staff/ledger');return p;}
 const owner=await context(),reader=await context(),plain=await context(),anonymous=await context();
 const page=await login(owner,'m17-operator@example.invalid'),readerPage=await login(reader,'m17-reader@example.invalid'),plainPage=await login(plain,'m17-plain@example.invalid');

 flow=await provisionFlowRole(db.pool,db.identity);const principal=(await loadStaff(db.pool,actor))!,sessionId=(await db.pool.query('SELECT id FROM auth_session WHERE "userId"=$1',[actor])).rows[0].id as string;
 const holds=new HoldService(roles.holdPool,principal,()=>now),quotes=new QuoteService(roles.pricingPool,principal,()=>now);await quotes.initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 const conditions=requestFor('2035-02-05'),held=await holds.command('create',randomUUID(),conditions),q=(await quotes.create(randomUUID(),{conditions,holdId:held.holdId,couponCode:null,wantAdvance:false})).quote;
 const fake=new FakeGateway(()=>now);fake.status='PENDING';
 const bookings=new BookingService(flow.flowPool,roles.authPool,{subject:actor,sessionId},fake,simulation);
 const booking=await bookings.create(randomUUID(),q.id,{displayName:'SYNTHETIC Guest',email:'synthetic-m17-guest@example.invalid',termsAccepted:true});await bookings.startPayment(booking.id,randomUUID());
 const snapshot=async()=>(await db.pool.query('SELECT to_jsonb(b) value FROM rental_bookings b WHERE id=$1',[booking.id])).rows[0].value;

 await check('anonymous and unprivileged staff never reach the operations console',async()=>{
  const p=await anonymous.newPage();await p.goto('/admin/ops');await expect(p.getByRole('heading',{name:'運用状況の閲覧権限が必要です'})).toBeVisible();
  await expect(p.getByRole('heading',{name:'運用例外'})).toHaveCount(0);
  await plainPage.goto('/admin/ops');await expect(plainPage.getByRole('heading',{name:'運用状況の閲覧権限が必要です'})).toBeVisible();
  assert.equal((await anonymous.request.get('/api/operations/exceptions?store=MOUNTAIN_BASE&ageHours=0&status=UNACKNOWLEDGED')).status(),401);
  assert.equal((await plain.request.get('/api/operations/exceptions?store=MOUNTAIN_BASE&ageHours=0&status=UNACKNOWLEDGED')).status(),403);
 });

 await check('normal console lists the pending payment exception without customer material',async()=>{
  await page.goto('/admin/ops');await page.getByRole('button',{name:'読み込む',exact:true}).click();
  await expect(page.getByRole('heading',{name:'PAYMENT_PENDING'}).first()).toBeVisible();
  const body=await page.locator('section[aria-label="例外一覧"]').innerText();
  for(const secret of ['synthetic-m17-guest@example.invalid','SYNTHETIC Guest','sim_','SYNTHETIC-MERCHANT'])assert.ok(!body.includes(secret),secret);
  assert.ok(body.includes('現在も継続中'));
 });

 await check('readiness reuses the existing safe component status only',async()=>{
  await page.getByRole('button',{name:'稼働状況',exact:true}).click();
  const health=page.locator('section[aria-label="稼働状況"]');await expect(health).toBeVisible();
  const text=await health.innerText();for(const c of ['APP','DB','GUEST','PAYMENT_ADAPTER','MEDIA','NOTIFICATION'])assert.ok(text.includes(c),c);
  for(const leak of ['postgres','127.0.0.1','password','zr_','sk_','Error'])assert.ok(!text.includes(leak),leak);
 });

 await check('acknowledge needs its own permission and changes no business state',async()=>{
  await readerPage.goto('/admin/ops');await readerPage.getByRole('button',{name:'読み込む',exact:true}).click();
  await expect(readerPage.getByRole('button',{name:'確認済みにする'})).toHaveCount(0);
  assert.equal((await reader.request.get('/api/operations/exceptions?store=MOUNTAIN_BASE&ageHours=0&status=UNACKNOWLEDGED')).status(),403);
  assert.equal((await reader.request.post('/api/operations/exception-acknowledge',{headers:{origin},data:{requestKey:randomUUID(),input:{id:randomUUID(),store:'ONSEN_BASE',reason:'TRIAGED'}}})).status(),403);
  const before=await snapshot();
  await page.getByRole('button',{name:'確認済みにする'}).first().click();
  await expect(page.getByRole('status')).toContainText('入金・返金・在庫・予約の状態は変わりません');
  assert.deepEqual(await snapshot(),before);
  assert.equal((await db.pool.query('SELECT state FROM rental_payment_attempts WHERE booking_id=$1',[booking.id])).rows[0].state,'PENDING');
  assert.equal((await db.pool.query("SELECT count(*)::int n FROM ops_exceptions WHERE status='ACKNOWLEDGED'")).rows[0].n,1);
 });

 await check('console is operable at 390, 768 and 1440 and starts no external request',async()=>{
  for(const width of [390,768,1440]){
   await page.setViewportSize({width,height:900});await page.goto('/admin/ops');
   await page.getByLabel('状態',{exact:true}).selectOption('ALL');
   await page.getByRole('button',{name:'読み込む',exact:true}).click();
   await expect(page.getByRole('heading',{name:'運用例外'})).toBeVisible();
   await expect(page.locator('section[aria-label="例外一覧"] article').first()).toBeVisible();
   assert.ok((await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)),'width '+width);
  }
  assert.equal(external,0);
 });

 console.log(JSON.stringify({status:'PASS',cases:count,externalRequests:external,actualProviderCalls:0,businessMutations:0,normalApp:'apps/web'}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'UI_ASSERTION',detail:stage==='startup'?'STARTUP_DETAILS_WITHHELD':(e as Error).message.split('Call log:')[0]!.slice(0,1200)}));}finally{await browser.close();await flow?.close();await app?.stop();}
if(failed)process.exit(1);
