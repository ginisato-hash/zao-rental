import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {writeAccount} from '../../packages/auth/src/accounts';
import {seedRecommendation} from '../recommendation/fixture';
import {startFlowApp} from '../flow/launcher';
import {newQuietContext} from '../flow/dev-hmr';

// Day-level sales stop in real browsers (Owner request 2026-11-22). Synthetic local PostgreSQL and apps only.
// Staff app: an administrator stops two days at both stations at once from the new screen (confirm dialog), sees the
// stopped days, the screen in English and at 390 px; New order on a stopped day shows the warning and continues only after
// the acknowledgement; the Orders list shows the booking time column. Guest app: the public booking page names the stopped
// day and does not continue; another date continues.
let staffApp:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,guestApp:Awaited<ReturnType<typeof startFlowApp>>|undefined;
let failed=false,stage='startup',count=0;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url'),shots='.local/evidence/sales-stop-ui';
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 await mkdir(shots,{recursive:true});
 staffApp=await startDevelopmentApp({operations:true});const {origin,db}=staffApp;
 for(let i=0;i<180;i++){try{if((await fetch(origin+'/staff/login')).status<500)break;}catch{/* starting */}await new Promise(r=>setTimeout(r,1000));}
 const root=await bootstrapDevelopmentAdmin(db.pool,{email:'stop-root@example.invalid',displayName:'SYNTHETIC Stop Root',password}),rootPrincipal=(await loadStaff(db.pool,root))!;
 await writeAccount(staffApp.roles.authPool,rootPrincipal,undefined,{active:true,role:'ADMIN',password,email:'stop-admin@example.invalid',displayName:'SYNTHETIC Stop Admin',scope:'ALL',storeIds:[],
  permissions:{HOLD_VIEW:true,HOLD_EDIT:true,QUOTE_VIEW:true,QUOTE_CREATE:true,BOOKING_VIEW:true,BOOKING_CREATE:true,INVENTORY_VIEW:true,INVENTORY_EDIT:true}});
 await seedRecommendation(db.pool);
 await db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-06-16T01:00:00Z'::timestamptz$$`);
 const context=await browser.newContext({baseURL:origin,viewport:{width:1440,height:900}}),page=await context.newPage(),errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/staff/login');await page.getByLabel('メールアドレス',{exact:true}).fill('stop-admin@example.invalid');await page.getByLabel('パスワード',{exact:true}).fill(password);
 await page.getByRole('button',{name:'ログイン',exact:true}).click();await page.waitForURL(u=>!u.pathname.startsWith('/staff/login'),{timeout:60000});

 await check('the sidebar links to the sales stop screen; an administrator stops two days at both stations at once',async()=>{
  await page.goto('/staff');await page.getByRole('link',{name:'売り止め（臨時休業）'}).click();await page.waitForURL('**/staff/sales-stops');
  await expect(page.getByRole('heading',{name:'売り止め（臨時休業）',level:1})).toBeVisible();
  await expect(page.getByText('売り止め日にかかっている予約はありません。')).toBeVisible({timeout:20000});
  await page.getByLabel('開始日').first().fill('2035-06-20');await page.getByLabel('終了日').first().fill('2035-06-21');
  await page.getByLabel('理由（スタッフのみ表示）').fill('SYNTHETIC 臨時休業');
  const dialogs:string[]=[];page.once('dialog',d=>{dialogs.push(d.message());void d.accept();});
  const save=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/operations/sales-stops'&&r.request().method()==='POST',{timeout:60000});
  await page.getByRole('button',{name:'売り止めにする',exact:true}).click();
  const answer=await save.catch(async e=>{console.error('PAGE_TEXT '+(await page.locator('main').innerText()).slice(0,800));throw e;});assert.equal(answer.status(),200,await answer.text());
  assert.match(dialogs[0]??'',/売り止めを設定します/);
  await expect(page.getByRole('status').filter({hasText:'4件の日を変更しました。'})).toBeVisible();
  const table=page.locator('#ss-list').locator('..').locator('table');await expect(table).toContainText('6月20日');await expect(table).toContainText('6月21日');
  await expect(table).toContainText('Mountain Station');await expect(table).toContainText('SYNTHETIC 臨時休業');
  assert.equal(Number((await db.pool.query('SELECT count(*)::int n FROM store_sales_stops')).rows[0].n),4);
  await page.screenshot({path:shots+'/stop-screen-ja-1440.png',fullPage:true});
 });

 await check('a MANAGER assigned only to Mountain sees only Mountain, stops and releases it from the screen; without BOOKING_VIEW the bookings section says so (PR74-UI-01, PR74-AUTH-01)',async()=>{
  const login=async(email:string,permissions:Record<string,boolean>,role:'MANAGER'|'STAFF')=>{
   await writeAccount(staffApp!.roles.authPool,rootPrincipal,undefined,{active:true,role,password,email,displayName:'SYNTHETIC '+role,scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions});
   const ctx=await browser.newContext({baseURL:origin,viewport:{width:1440,height:900}}),p=await ctx.newPage();
   await p.goto('/staff/login');await p.getByLabel('メールアドレス',{exact:true}).fill(email);await p.getByLabel('パスワード',{exact:true}).fill(password);
   await p.getByRole('button',{name:'ログイン',exact:true}).click();await p.waitForURL(u=>!u.pathname.startsWith('/staff/login'),{timeout:60000});return {ctx,p};
  };
  const {ctx,p}=await login('stop-manager@example.invalid',{INVENTORY_VIEW:true,INVENTORY_EDIT:true,BOOKING_VIEW:true},'MANAGER');
  await p.goto('/staff/sales-stops');await expect(p.getByRole('button',{name:'売り止めにする',exact:true})).toBeVisible({timeout:30000});
  await expect(p.getByRole('checkbox',{name:'Mountain Station'})).toBeChecked();await expect(p.getByRole('checkbox',{name:'Onsen Station'})).toHaveCount(0);
  await p.getByLabel('開始日').first().fill('2035-07-01');await p.getByLabel('終了日').first().fill('2035-07-01');await p.getByLabel('理由（スタッフのみ表示）').fill('SYNTHETIC manager closure');
  for(const [button,stop] of [['売り止めにする',true],['売り止めを解除',false]] as const){
   const dialogs:string[]=[];p.once('dialog',d=>{dialogs.push(d.message());void d.accept();});
   const res=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/operations/sales-stops'&&r.request().method()==='POST');
   await p.getByRole('button',{name:button,exact:true}).click();const answer=await res;assert.equal(answer.status(),200,await answer.text());
   assert.deepEqual(JSON.parse(answer.request().postData()!).input.stores,['MOUNTAIN_BASE'],'only the assigned station is sent');
   assert.match(dialogs[0]??'',/Mountain Station/);assert.doesNotMatch(dialogs[0]??'',/Onsen/);
   await expect(p.getByRole('status').filter({hasText:'1件の日を変更しました。'})).toBeVisible();
   assert.equal(Number((await db.pool.query("SELECT count(*)::int n FROM store_sales_stops WHERE day='2035-07-01'")).rows[0].n),stop?1:0);
  }
  await ctx.close();
  const viewer=await login('stop-nobooking@example.invalid',{INVENTORY_VIEW:true,BOOKING_VIEW:false},'STAFF');
  await viewer.p.goto('/staff/sales-stops');await expect(viewer.p.getByText('予約の表示には予約閲覧の権限が必要です',{exact:false})).toBeVisible({timeout:30000});
  await expect(viewer.p.getByText('売り止め日にかかっている予約はありません。')).toHaveCount(0);await viewer.ctx.close();
 });

 await check('English and 390 px: same screen, no horizontal scroll',async()=>{
  const small=await browser.newContext({baseURL:origin,viewport:{width:390,height:844},storageState:await context.storageState()});const p=await small.newPage();
  await small.addCookies([{name:'zao_staff_locale',value:'en',url:origin}]);
  await p.goto('/staff/sales-stops');await expect(p.getByRole('heading',{name:'Sales stops (closures)',level:1})).toBeVisible();
  await expect(p.getByRole('button',{name:'Stop sales',exact:true})).toBeVisible();
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false);
  await p.screenshot({path:shots+'/stop-screen-en-390.png',fullPage:true});await small.close();
 });

 await check('New order on a stopped day warns and continues only after the acknowledgement',async()=>{
  // Local development has no staff order composition (Production-only, it would charge); as in acceptance-ui the draft API is
  // answered by the test, and options carry the stopped days exactly as GuestBookingService.options() returns them.
  const draftId='00000000-0000-4000-8000-000000000062';
  const view=()=>({checkout:null,id:draftId,revision:1,input:null,locked:false,priceReviewRequired:false,selection:null,preview:null,hold:null,estimate:null,reviewHash:null,quote:null,booking:null,simulation:false,customerProfileId:null});
  await page.route('**/api/staff-orders/**',async r=>{const path=new URL(r.request().url()).pathname;
   if(path.endsWith('/options'))return r.fulfill({json:{salesStops:[{store:'MOUNTAIN_BASE',day:'2035-06-20'},{store:'ONSEN_BASE',day:'2035-06-20'}],revision:'synthetic',models:[],sizes:[]}});return r.fulfill({json:view()});});
  await page.goto('/staff/orders/new');await page.getByRole('heading',{name:'新規予約',level:1}).waitFor();
  const start=page.getByLabel('利用開始日',{exact:true});await expect(start).toBeEnabled({timeout:30000});
  await start.fill('2035-06-20');await page.getByLabel('利用終了日',{exact:true}).fill('2035-06-20');
  await expect(page.getByText('この期間は売り止め日を含みます：')).toBeVisible();
  const ack=page.getByLabel('売り止め日と承知のうえで予約を作成する');await expect(ack).toBeVisible();
  await page.getByRole('button',{name:'CONTINUE',exact:true}).click();
  await expect(page.getByText('売り止め日を含みます。確認のうえ、チェックを入れてください。')).toBeVisible();
  await expect(page.getByLabel('利用人数')).toHaveCount(0);
  await page.screenshot({path:shots+'/new-order-warning.png',fullPage:true});
  await ack.check();await page.getByRole('button',{name:'CONTINUE',exact:true}).click();
  await expect(page.getByLabel('利用人数')).toBeVisible();
  await page.unroute('**/api/staff-orders/**');
 });

 await check('Orders list shows the booking time column',async()=>{
  // This development database has no booking; the row comes from the test so the column and its JST rendering are visible.
  // The real read (createdAt from rental_bookings) and CSV column are proven in tests/operations/sales-stop-postgres.ts.
  await page.route(/\/api\/operations\/orders\?/,r=>r.fulfill({json:{today:'2035-06-16',tab:'all',total:1,page:1,pageSize:50,counts:{all:1,upcoming:1,late:0,lateOut:0,lateBack:0,shortage:0,shortageIndeterminate:0},paymentOptions:[],
   rows:[{id:'00000000-0000-4000-8000-0000000000aa',ref:'0000AAAA',customer:'SYNTHETIC Guest',email:null,status:'RESERVED',paymentStatus:null,pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',startDate:'2035-06-22',endDate:'2035-06-22',totalJpy:12000,createdAt:'2035-06-15T23:05:00Z',lateOut:false,lateBack:false}]}}));
  await page.goto('/staff/orders');await expect(page.getByRole('columnheader',{name:'受付日時'})).toBeVisible({timeout:30000});
  await expect(page.locator('td.ox-booked').first()).toHaveText(/6\/16.*08:05/);
  await page.unroute(/\/api\/operations\/orders\?/);
  await page.screenshot({path:shots+'/orders-booked-at.png'});
 });
 assert.deepEqual(errors,[],'no page errors');
 await context.close();await staffApp.stop();staffApp=undefined;

 stage='guest app';
 guestApp=await startFlowApp({publicP0:true,publicP1:true,warmRoutes:true});
 const g=guestApp.db.pool;
 // This app runs on the real clock: the booking page lists stopped days for the next 400 days, so use dates ten days ahead.
 const jstDay=(n:number)=>{const t=new Date(Date.now()+9*3600_000);t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
 const [d1,d2,d3]=[jstDay(10),jstDay(11),jstDay(12)];
 await g.query("BEGIN;SELECT set_config('zao.actor','synthetic-staff',true);SELECT store_sales_stop_set(ARRAY['MOUNTAIN_BASE'],$1::date,$1::date,true,'SYNTHETIC closure');COMMIT".replace('$1::date,$1::date',`'${d2}'::date,'${d2}'::date`));
 await check('the public booking page names the stopped day and does not continue; another date continues',async()=>{
  const ctx=await newQuietContext(browser,{baseURL:guestApp!.origin,viewport:{width:390,height:844}});const p=await ctx.newPage();const pageErrors:string[]=[];p.on('pageerror',e=>pageErrors.push(e.message));
  await p.goto('/ja/book');const start=p.getByLabel('利用開始日',{exact:true});await expect(start).toBeEnabled({timeout:30000});
  await start.fill(d1);await p.getByLabel('利用終了日',{exact:true}).fill(d3);
  const notice=p.getByRole('alert').filter({hasText:'次の日は受付を停止しています'});await expect(notice).toBeVisible();await expect(notice).toContainText(d2.slice(5).replace('-','/'));
  await p.getByRole('button',{name:'CONTINUE',exact:true}).click();await expect(p.getByLabel('利用人数')).toHaveCount(0);
  await p.screenshot({path:shots+'/guest-stopped-day-390.png',fullPage:true});
  await p.getByLabel('利用開始日',{exact:true}).fill(d3);await p.getByLabel('利用終了日',{exact:true}).fill(d3);
  await expect(notice).toHaveCount(0);await p.getByRole('button',{name:'CONTINUE',exact:true}).click();await expect(p.getByLabel('利用人数')).toBeVisible();
  assert.deepEqual(pageErrors,[]);await ctx.close();
 });
 console.log(JSON.stringify({status:'PASS',checks:count,screenshots:shots}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage}));console.error((e as Error).message?.slice(0,1200));}
finally{await browser.close();await staffApp?.stop();await guestApp?.stop();}
if(failed)process.exitCode=1;
