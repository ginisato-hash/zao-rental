import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {chromium,expect,request as apiRequest,type Page} from '@playwright/test';
import {startFlowApp} from '../flow/launcher';
import {seedRecommendation,variants} from '../recommendation/fixture';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {loadStaff} from '../../packages/auth/src/staff-auth';
let app:Awaited<ReturnType<typeof startFlowApp>>|undefined,stage='setup',count=0,failed=false,last:Page|undefined;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url');
async function check(name:string,f:()=>Promise<void>){stage=name;await f();count++;console.log('PASS '+name);}
async function staffLogin(page:Page,email:string){
 await page.goto('/staff/login');await page.getByLabel('メールアドレス',{exact:true}).fill(email);await page.getByLabel('パスワード',{exact:true}).fill(password);
 const [signed]=await Promise.all([page.waitForResponse(r=>r.url()===app!.origin+'/api/auth/sign-in/email'&&r.request().method()==='POST',{timeout:60000}),page.getByRole('button',{name:'ログイン',exact:true}).click()]);
 assert.equal(signed.status(),200);await page.waitForURL(app!.origin+'/staff/ledger',{timeout:60000});
}
try{
 app=await startFlowApp({publicP0:true});await seedRecommendation(app.db.pool,true);await app.db.pool.query("CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-01-01T01:00:00Z'::timestamptz$$");
 const root=await bootstrapDevelopmentAdmin(app.db.pool,{email:'public-root@example.invalid',displayName:'SYNTHETIC Root',password});for(const permission of ['PRICE_EDIT','QUOTE_VIEW'])await app.db.pool.query('INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,$2,true)',[root,permission]);

 await new QuoteService(app.roles.pricingPool,(await loadStaff(app.db.pool,root))!).initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 for(let n=0;n<100;n++){try{if((await fetch(app.origin+'/api/health')).ok)break;}catch{}if(n===99)throw new Error('APP_START_TIMEOUT');await new Promise(r=>setTimeout(r,100));}
 const context=await browser.newContext({baseURL:app.origin,viewport:{width:390,height:844}});context.setDefaultTimeout(15000);const page=await context.newPage();last=page;
 // Finish dev-only cold compilation before any staff form is filled. Anonymous
 // reads must retain their normal status; no staff/session fixture is injected.
 for(const path of ['/staff/login','/staff/ledger','/staff/users'])assert.equal((await context.request.get(path)).status(),200);
 assert.equal((await context.request.get('/api/auth/sign-in/email')).status(),405);
 for(const path of ['/api/session','/api/staff-users','/api/ledger/assets'])assert.equal((await context.request.get(path)).status(),401);
 await check('JA/EN primary content, unique metadata, canonical/hreflang/JSON-LD are in initial HTML; private/query URLs noindex',async()=>{
  const titles=new Set();for(const locale of ['ja','en'])for(const path of ['','rental','rental/ski','rental/snowboard','rental/premium','rental/wear','rental/kids-family','prices','stores/mountain-base','stores/onsen-base','pickup-return','faq']){const response=await context.request.get('/'+locale+(path?'/'+path:''));assert.equal(response.status(),200);const html=await response.text();assert.match(html,/<h1>/);assert.match(html,/rel="canonical"/);assert.match(html,/hrefLang="x-default"/i);assert.match(html,/application\/ld\+json/);assert.match(html,/BreadcrumbList/);const title=/<title>(.*?)<\/title>/.exec(html)?.[1];assert.ok(title&&!titles.has(title));titles.add(title);assert.match(response.headers()['x-robots-tag']??'',/noindex/);}
  assert.doesNotMatch(await (await context.request.get('/sitemap.xml')).text(),/<loc>/);assert.doesNotMatch(await (await context.request.get('/sitemap.xml')).text(),/<loc>[^<]*(?:\/book|\/staff|\?)/);assert.match(await (await context.request.get('/robots.txt')).text(),/Disallow: \//);
  for(const path of ['/ja/book','/api/guest/draft','/staff/login','/ja/rental?date=2035-01-05&people=20'])assert.match((await context.request.get(path)).headers()['x-robots-tag']??'',/noindex/);
  assert.equal((await context.request.get('/en/not-a-page')).status(),404);
  await page.goto('/ja/rental');await expect(page.getByRole('heading',{level:1})).toBeVisible();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await mkdir('.local/screenshots',{recursive:true});await page.screenshot({path:'.local/screenshots/public-ja-mobile.png',fullPage:true});
 });
 await check('Owner-approved legal pages render JA/EN with the confirmed seller facts, are linked from the footer, and the under-review notices are gone',async()=>{
  for(const [locale,doc,fact] of [['ja','commercial-disclosure','株式会社Yuge'],['ja','commercial-disclosure','〒990-2301 山形県山形市蔵王温泉973-7'],['ja','commercial-disclosure','070-4440-4813'],['en','commercial-disclosure','rentalstation@yuge-zao.com'],['ja','terms','利用規約'],['en','terms','Terms of use'],['ja','privacy','Square'],['en','privacy','Resend'],['ja','cancellation','48時間'],['en','cancellation','48 hours']] as const){
   const response=await context.request.get(`/${locale}/legal/${doc}`);assert.equal(response.status(),200,`${locale}/${doc}`);assert.ok((await response.text()).includes(fact),`${locale}/${doc}: ${fact}`);
  }
  assert.equal((await context.request.get('/ja/legal/not-a-doc')).status(),404);
  const faq=await (await context.request.get('/ja/faq')).text();
  for(const doc of ['terms','privacy','commercial-disclosure','cancellation'])assert.ok(faq.includes(`href="/ja/legal/${doc}"`),`footer link ${doc}`);
  assert.ok(!faq.includes('公開文言・利用規約は公開前確認中です'),'the under-review notice disappears once every document is approved');
  const legalHtml=await (await context.request.get('/ja/legal/terms')).text();assert.match(legalHtml,/<meta name="robots" content="noindex/,'not indexable without publication authority');
 });
 await check('P85 mobile home: deliberate horizontal swipe changes campaign (photo/title/VIEW agree), short or vertical touches do not; modal menu traps focus, Escape restores focus and scroll',async()=>{
  for(const width of [390,375]){
   const touch=await browser.newContext({baseURL:app!.origin,viewport:{width,height:width===390?844:812},hasTouch:true,isMobile:true});touch.setDefaultTimeout(15000);const m=await touch.newPage();
   await m.goto('/ja');const cdp=await touch.newCDPSession(m);
   const state=async()=>m.evaluate(()=>({title:document.querySelector('.pc-title-m')?.textContent,view:document.querySelector('.pc-view')?.getAttribute('href'),slide:document.querySelector('.pc-slide.is-active')?.getAttribute('href')}));
   const swipe=async(dx:number,dy:number,ms:number)=>{const x=width/2,y=420,steps=6;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=steps;i++){await new Promise(r=>setTimeout(r,ms/steps));await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/steps,y:y+dy*i/steps}]});}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await new Promise(r=>setTimeout(r,150));};
   await expect(m.locator('.pc-title-m')).toBeVisible();await m.locator('.pc-hero').dispatchEvent('mouseenter');
   const a=await state();assert.equal(a.view,a.slide,'VIEW link and active photo belong to the same campaign');
   await swipe(-20,0,150);assert.deepEqual(await state(),a,'a short touch never switches');
   await swipe(-30,160,300);assert.deepEqual(await state(),a,'a vertical scroll gesture never switches');
   await swipe(-140,8,250);const b=await state();assert.notEqual(b.title,a.title,'left swipe advances');assert.equal(b.view,b.slide);
   await swipe(140,-6,250);assert.deepEqual(await state(),a,'right swipe goes back');
   assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal scroll');
   // Modal menu
   await m.getByRole('button',{name:'メニューを開く'}).click();const dialog=m.getByRole('dialog',{name:'メニュー'});await expect(dialog).toBeVisible();
   assert.equal(await m.evaluate(()=>document.body.style.overflow),'hidden');
   const inside=()=>m.evaluate(()=>{const a=document.activeElement,d=document.querySelector('[role="dialog"][aria-modal="true"]');return !!a&&!!d&&d.contains(a);});
   assert.equal(await inside(),true,'focus starts inside the dialog');await expect(dialog.getByRole('button',{name:'メニューを閉じる'})).toBeVisible();
   for(let i=0;i<30;i++){await m.keyboard.press('Tab');assert.equal(await inside(),true,'Tab stays inside the dialog');}
   for(let i=0;i<30;i++){await m.keyboard.press('Shift+Tab');assert.equal(await inside(),true,'Shift+Tab stays inside the dialog');}
   assert.equal(await m.evaluate(()=>{const f=document.querySelector<HTMLElement>('.pc-footer a');f?.focus();return document.activeElement===f;}),false,'background links are inert while open');
   await m.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
   assert.equal(await m.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'メニューを開く','focus returns to the toggle');
   assert.equal(await m.evaluate(()=>document.body.style.overflow),'','scroll lock released');
   assert.equal(await m.evaluate(()=>!!document.querySelector('.pc-footer a')&&!(document.querySelector('.pc-footer') as HTMLElement).inert),true,'background restored');
   await m.getByRole('button',{name:'メニューを開く'}).click();await m.getByRole('dialog',{name:'メニュー'}).getByRole('button',{name:'メニューを閉じる'}).click();await expect(m.getByRole('dialog')).toHaveCount(0);
   assert.equal(await m.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'メニューを開く','CLOSE returns focus to MENU');assert.equal(await m.evaluate(()=>document.body.style.overflow),'');
   await m.getByRole('button',{name:'メニューを開く'}).click();await m.getByRole('dialog',{name:'メニュー'}).getByRole('link',{name:'SKI',exact:true}).click();
   await m.waitForURL(/\/ja\/rental\/ski$/);assert.equal(await m.evaluate(()=>document.body.style.overflow),'','scroll lock released after navigating from the menu');
   await touch.close();
  }
 });
 await check('guest ordinary mobile UI -> explicit size -> server group total, without early HOLD',async()=>{
  await page.goto('/ja/book');await expect(page.getByLabel('利用開始日',{exact:true})).toBeEnabled();await page.getByLabel('利用開始日',{exact:true}).fill('2035-01-05');await page.getByLabel('利用終了日',{exact:true}).fill('2035-01-06');await page.getByLabel('利用枠',{exact:true}).selectOption('MULTIDAY');await page.getByRole('button',{name:'用品を選ぶ',exact:true}).click();await page.getByLabel('ポールのサイズ 1',{exact:true}).selectOption('pole-'+variants.pole); // option keys come from the server below if catalog prefix differs
  await page.getByRole('button',{name:'候補と参考料金を確認',exact:true}).click();await page.getByRole('radio',{name:/おすすめ/}).check();await page.getByLabel('全員のサイズ・モデル条件・ウェア構成を確認した').check();await page.getByRole('button',{name:'全員分の最終確認へ'}).click();await expect(page.getByRole('region',{name:'全員分の確認'})).toContainText('全員分の参考総額');assert.equal((await app!.db.pool.query('SELECT count(*)::int n FROM inventory_holds')).rows[0].n,0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // CL-02: no wear items and advance was never requested in this flow, so both adjustment
  // rows must stay hidden -- only the subtotal and group-total rows are present.
  await expect(page.locator('dl.guest-price dt')).toHaveText(['小計','全員分の参考総額']);
  await expect(page.locator('dl.guest-price')).not.toContainText('ウェア調整');
  await expect(page.locator('dl.guest-price')).not.toContainText('事前決済調整');
  await page.screenshot({path:'.local/screenshots/guest-review-mobile.png',fullPage:true});
 });
 await check('UX-3A regression: the unsaved-changes banner does not appear on first arrival at a step, only after an actual edit on it',async()=>{
  const ctx=await browser.newContext({baseURL:app!.origin,viewport:{width:390,height:844}});ctx.setDefaultTimeout(15000);const p=await ctx.newPage();last=p;
  await p.goto('/ja/book');await expect(p.getByLabel('利用開始日',{exact:true})).toBeEnabled();
  await expect(p.getByText('保存されていない変更があります')).toHaveCount(0);
  await p.getByLabel('利用開始日',{exact:true}).fill('2035-03-01');await p.getByLabel('利用終了日',{exact:true}).fill('2035-03-01');
  await p.getByRole('button',{name:'用品を選ぶ',exact:true}).click();
  // Filling step 0 and advancing to step 1 is real, unsubmitted progress, but nothing on step
  // 1 itself has been touched yet -- the warning must stay absent immediately on arrival here.
  await expect(p.getByLabel('用品 1',{exact:true})).toBeVisible();
  await expect(p.getByText('保存されていない変更があります')).toHaveCount(0);
  await p.getByLabel('ポールのサイズ 1',{exact:true}).selectOption('pole-'+variants.pole);
  await expect(p.getByText('保存されていない変更があります')).toBeVisible();
  await ctx.close();
 });
 await check('UX3R-01 regression: hiding the unsaved-changes banner on step arrival must never disable the actual guardNav/beforeunload protection',async()=>{
  const ctx=await browser.newContext({baseURL:app!.origin,viewport:{width:390,height:844}});ctx.setDefaultTimeout(15000);const p=await ctx.newPage();last=p;
  await p.goto('/ja/book');await expect(p.getByLabel('利用開始日',{exact:true})).toBeEnabled();
  await p.getByLabel('利用開始日',{exact:true}).fill('2035-04-01');await p.getByLabel('利用終了日',{exact:true}).fill('2035-04-01');
  await p.getByRole('button',{name:'用品を選ぶ',exact:true}).click();
  // Fresh arrival at step 1: the visible banner is hidden (UX-3A), but the entered dates are
  // still real, unsaved input -- a guarded nav must still prompt, and cancelling it must keep
  // the user on the same page with that input intact.
  await expect(p.getByText('保存されていない変更があります')).toHaveCount(0);
  let dialogSeen=false;
  p.once('dialog',async d=>{dialogSeen=true;assert.match(d.message(),/保存されていない入力/);await d.dismiss();});
  await p.getByRole('link',{name:'プランを見る',exact:true}).click();
  await p.waitForTimeout(300);
  assert.ok(dialogSeen,'guardNav must still fire even though the visible banner is hidden right after a step transition');
  await expect(p).toHaveURL(/\/ja\/book$/);
  await expect(p.getByLabel('用品 1',{exact:true})).toBeVisible();
  // Editing step 1, then going back to step 0 (another touched-resetting transition), must not
  // drop protection either -- same guarantee one step earlier in the wizard.
  await p.getByLabel('ポールのサイズ 1',{exact:true}).selectOption('pole-'+variants.pole);
  await expect(p.getByText('保存されていない変更があります')).toBeVisible();
  await p.getByRole('button',{name:'日程に戻る',exact:true}).click();
  await expect(p.getByText('保存されていない変更があります')).toHaveCount(0);
  let secondDialogSeen=false;
  p.once('dialog',async d=>{secondDialogSeen=true;await d.accept();});
  await p.getByRole('link',{name:'プランを見る',exact:true}).click();
  await p.waitForURL(/\/ja\/rental$/);
  assert.ok(secondDialogSeen,'guardNav must still fire after backToStep(0) even though the banner is hidden there too');
  await ctx.close();
 });
 await check('UX-4A regression: a second person card starts collapsed, expands on request, and both reach the candidate step',async()=>{
  const ctx=await browser.newContext({baseURL:app!.origin,viewport:{width:390,height:844}});ctx.setDefaultTimeout(15000);const p=await ctx.newPage();last=p;
  await p.goto('/ja/book');await expect(p.getByLabel('利用開始日',{exact:true})).toBeEnabled();
  await p.getByLabel('利用開始日',{exact:true}).fill('2035-01-07');await p.getByLabel('利用終了日',{exact:true}).fill('2035-01-07');
  await p.getByRole('button',{name:'用品を選ぶ',exact:true}).click();
  await p.getByLabel('ポールのサイズ 1',{exact:true}).selectOption('pole-'+variants.pole);
  await p.getByLabel('利用人数',{exact:true}).fill('2');
  await expect(p.getByLabel('ポールのサイズ 2',{exact:true})).not.toBeVisible();
  await p.getByText('利用者 2').first().click();
  await expect(p.getByLabel('ポールのサイズ 2',{exact:true})).toBeVisible();
  await p.getByLabel('ポールのサイズ 2',{exact:true}).selectOption('pole-'+variants.pole);
  await p.getByRole('button',{name:'候補と参考料金を確認',exact:true}).click();
  await expect(p.getByRole('radio',{name:/おすすめ/})).toHaveCount(2);
  await ctx.close();
 });
 await check('final test payment response loss and reload restore the same booking/QR from real DB without duplicate hold or payment',async()=>{
  await page.getByLabel('合成データによる開発確認であることを確認').check();let done!:()=>void,fail!:(e:unknown)=>void;const lost=new Promise<void>((r,j)=>{done=r;fail=j;});let cm06Checked=false;await page.route('**/api/guest/checkout',async route=>{
   // One fresh local transport avoids reusing the context's idle HTTP connection.
   // This still sends exactly once, proves the server committed, then loses only
   // the browser response; no retry converts an ambiguous result into PASS.
   const forward=await apiRequest.newContext();try{
    // CM-06: this route handler itself is the response gate -- the checkout button's request
    // is genuinely in flight for the whole span between the click and this callback finishing,
    // so the busy UI is observed here rather than via a fixed sleep race.
    await expect(page.getByRole('button',{name:'処理しています…',exact:true})).toHaveAttribute('aria-busy','true');
    await expect(page.getByRole('button',{name:'処理しています…',exact:true})).toBeDisabled();
    await expect(page.getByRole('status').filter({hasText:'処理中です'})).toBeVisible();
    cm06Checked=true;
    assert.equal(new URL(route.request().url()).origin,app!.origin);const response=await forward.fetch(route.request(),{maxRetries:0,maxRedirects:0});assert.equal(response.status(),200);await route.abort('failed');done();}catch(e){fail(e);}finally{await forward.dispose();}
  });await page.getByRole('button',{name:'この内容で支払う（開発用決済）'}).click();await lost;assert.ok(cm06Checked,'CM-06 busy-state assertions must actually run inside the gated request, not be skipped');await expect(page.getByRole('button',{name:'保存済みの結果を再読込'})).toBeEnabled();await expect(page.getByRole('main').getByRole('alert')).toContainText('処理でエラーが発生しました');await page.unroute('**/api/guest/checkout');await page.reload();await expect(page.getByRole('heading',{name:'予約が確認されました',exact:true})).toBeVisible();await expect(page.getByRole('img',{name:'開発予約QR',exact:true})).toBeVisible();const before=(await app!.db.pool.query('SELECT expires_at FROM inventory_holds')).rows[0].expires_at.toISOString();await page.getByRole('button',{name:'保存済みの結果を再読込'}).click();assert.equal((await app!.db.pool.query('SELECT count(*)::int n FROM rental_payment_attempts')).rows[0].n,1);assert.equal((await app!.db.pool.query('SELECT count(*)::int n FROM inventory_holds')).rows[0].n,1);assert.equal((await app!.db.pool.query('SELECT expires_at FROM inventory_holds')).rows[0].expires_at.toISOString(),before);await page.screenshot({path:'.local/screenshots/guest-confirmed-mobile.png',fullPage:true});
 });
 await check('UIR-01/UIR-02 regression: no cross-context input leak, malformed cache does not crash, server-saved input still restores',async()=>{
  const ctx=await browser.newContext({baseURL:app!.origin,viewport:{width:390,height:844}});ctx.setDefaultTimeout(15000);const p=await ctx.newPage();last=p;
  await p.goto('/ja/book');await expect(p.getByLabel('利用開始日',{exact:true})).toBeEnabled();
  // A sentinel from an unrelated key prefix (what a real booking-access/recovery flow would set)
  // must survive whatever cleanup this scenario triggers -- only zao-guest-draft-input is in scope.
  await p.evaluate(()=>sessionStorage.setItem('zao-booking-access-request:sentinel','keep-me'));
  // Simulate what a pre-fix session, or another guest sharing this tab, would have left behind:
  // a full Input object (including body measurements) under the old unscoped key.
  await p.evaluate(()=>sessionStorage.setItem('zao-guest-draft-input',JSON.stringify({pickupStore:'ONSEN_BASE',returnStore:'ONSEN_BASE',period:{startDate:'2035-09-09',endDate:'2035-09-09',slot:'DAY'},members:[{key:'person-1',sport:'SKI',heightCm:999,footCm:99,adultAtStart:true,tier:'REGULAR',ski:{weightKg:60,ageAtStart:30,level:'BEGINNER'},poleSize:null,premiumModel:null,jacketSize:null,pantsSize:null,wearSport:null}]})));
  // TEST-OBS-01: observe the actual context switch, not just its symptoms -- the review
  // noted the prior version of this case asserted blank fields/purged cache but never
  // confirmed logout actually succeeded or that a genuinely different draft id resulted;
  // a failed logout would leave the original unsaved draft in place, and the earlier
  // assertions would still pass by coincidence rather than by exercising UIR-01's path.
  const beforeDraftId=(await p.evaluate(()=>fetch('/api/guest/draft',{cache:'no-store'}).then(r=>r.json()))).id as string;
  // A cookie expiring, or an explicit logout, creates a fresh guest context transparently
  // (POST /context returns 201, not 401) -- this is the exact path the review's UIR-01 flagged.
  const logoutStatus=await p.evaluate(()=>fetch('/api/guest/logout',{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.status));
  assert.equal(logoutStatus,200,'logout must actually succeed for this to be the reviewed context-switch path');
  await p.reload();await expect(p.getByLabel('利用開始日',{exact:true})).toBeEnabled();
  await expect(p.getByLabel('利用開始日',{exact:true})).toHaveValue('');await expect(p.getByLabel('利用終了日',{exact:true})).toHaveValue('');
  assert.equal(await p.evaluate(()=>sessionStorage.getItem('zao-guest-draft-input')),null,'stale cross-context cache is purged, not restored');
  assert.equal(await p.evaluate(()=>sessionStorage.getItem('zao-booking-access-request:sentinel')),'keep-me','cleanup is scoped to the one key, not a blanket sessionStorage clear');
  const afterDraftId=(await p.evaluate(()=>fetch('/api/guest/draft',{cache:'no-store'}).then(r=>r.json()))).id as string;
  assert.notEqual(afterDraftId,beforeDraftId,'the reloaded context must be a genuinely different draft, not the same one merely re-fetched');
  // UIR-02: a malformed cached shape must not crash the page.
  await p.evaluate(()=>sessionStorage.setItem('zao-guest-draft-input','{}'));
  await p.reload();await expect(p.getByLabel('利用開始日',{exact:true})).toBeEnabled();
  assert.equal(await p.evaluate(()=>sessionStorage.getItem('zao-guest-draft-input')),null);
  // A real, server-saved draft (not the removed local cache) must still restore across reload.
  await p.getByLabel('利用開始日',{exact:true}).fill('2035-01-08');await p.getByLabel('利用終了日',{exact:true}).fill('2035-01-08');await p.getByRole('button',{name:'用品を選ぶ',exact:true}).click();await p.getByLabel('ポールのサイズ 1',{exact:true}).selectOption('pole-'+variants.pole);await p.getByRole('button',{name:'候補と参考料金を確認',exact:true}).click();await expect(p.getByRole('radio',{name:/おすすめ/})).toBeVisible();
  await p.reload();await expect(p.getByRole('radio',{name:/おすすめ/})).toBeVisible();
  await ctx.close();
 });
 await check('CL-02 regression: advance-adjustment row appears only when nonzero; JA/EN narrow width',async()=>{
  // JA: requesting the advance-payment estimate (still within its qualification window)
  // must surface a nonzero "事前決済調整（見込み）" row alongside the subtotal/total;
  // no wear items are selected here, so the wear-adjustment row must stay absent.
  const jaCtx=await browser.newContext({baseURL:app!.origin,viewport:{width:390,height:844}});jaCtx.setDefaultTimeout(15000);const ja=await jaCtx.newPage();last=ja;
  await ja.goto('/ja/book');await expect(ja.getByLabel('利用開始日',{exact:true})).toBeEnabled();await ja.getByLabel('利用開始日',{exact:true}).fill('2035-01-10');await ja.getByLabel('利用終了日',{exact:true}).fill('2035-01-10');await ja.getByRole('button',{name:'用品を選ぶ',exact:true}).click();await ja.getByLabel('ポールのサイズ 1',{exact:true}).selectOption('pole-'+variants.pole);await ja.getByRole('button',{name:'候補と参考料金を確認',exact:true}).click();await ja.getByRole('radio',{name:/おすすめ/}).check();await ja.getByLabel('全員のサイズ・モデル条件・ウェア構成を確認した').check();await ja.getByLabel('事前決済5％調整の見込みを確認する').check();await ja.getByRole('button',{name:'全員分の最終確認へ'}).click();await expect(ja.getByRole('region',{name:'全員分の確認'})).toBeVisible();
  await expect(ja.locator('dl.guest-price dt')).toHaveText(['小計','事前決済調整（見込み）','全員分の参考総額']);
  await expect(ja.locator('dl.guest-price')).not.toContainText('ウェア調整');
  const advanceRowValue=await ja.locator('dl.guest-price dd').nth(1).innerText();assert.notEqual(advanceRowValue.trim(),'');assert.doesNotMatch(advanceRowValue,/¥0(?:[^0-9]|$)/);
  assert.ok(await ja.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await jaCtx.close();
  // EN, same narrow viewport, default (zero-adjustment) flow: labels localize and no
  // adjustment rows leak in when nothing triggers them, mirroring the JA zero case above.
  const enCtx=await browser.newContext({baseURL:app!.origin,viewport:{width:390,height:844}});enCtx.setDefaultTimeout(15000);const en=await enCtx.newPage();last=en;
  await en.goto('/en/book');await expect(en.getByLabel('Start date',{exact:true})).toBeEnabled();await en.getByLabel('Start date',{exact:true}).fill('2035-01-11');await en.getByLabel('End date',{exact:true}).fill('2035-01-11');await en.getByRole('button',{name:'Choose equipment',exact:true}).click();await en.getByLabel('Pole size 1',{exact:true}).selectOption('pole-'+variants.pole);await en.getByRole('button',{name:'Review sizes and estimates',exact:true}).click();
  // The EN direction label is currently the raw enum ('RECOMMENDED'), not localized copy.
  await en.getByRole('radio',{name:/RECOMMENDED/i}).check();await en.getByLabel('I confirm each person’s size, model promise and wear selections').check();await en.getByRole('button',{name:'Review the whole group',exact:true}).click();await expect(en.getByRole('region',{name:'Group review'})).toBeVisible();
  await expect(en.locator('dl.guest-price dt')).toHaveText(['Subtotal','Group estimate']);
  await expect(en.locator('dl.guest-price')).not.toContainText('Wear adjustment');
  await expect(en.locator('dl.guest-price')).not.toContainText('Estimated advance adjustment');
  assert.ok(await en.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await enCtx.close();
 });
 await check('UIR-03/UIR-04 regression: history never guesses go() distance, never revives a stale review as checkout-ready after a local edit, and causes no extra HOLD',async()=>{
  const holdsBefore=(await app!.db.pool.query('SELECT count(*)::int n FROM inventory_holds')).rows[0].n;
  const ctx=await browser.newContext({baseURL:app!.origin,viewport:{width:390,height:844}});ctx.setDefaultTimeout(15000);const p=await ctx.newPage();last=p;
  // 1) fresh context: valid dates -> step 1 -> real Back -> real Forward returns to step 1
  // without ever leaving /book (this exact app was observed, live, to fall back to a full
  // document reload on some in-app Back/Forward transitions -- a real Next.js dev-mode
  // behavior, not something this fix controls -- so this only asserts the one guarantee that
  // matters: we land back on step 1, on the same page, never on an unrelated prior page).
  await p.goto('/ja/book');await expect(p.getByLabel('利用開始日',{exact:true})).toBeEnabled();
  await p.getByLabel('利用開始日',{exact:true}).fill('2035-02-01');await p.getByLabel('利用終了日',{exact:true}).fill('2035-02-01');
  await p.getByRole('button',{name:'用品を選ぶ',exact:true}).click();
  await expect(p.getByRole('button',{name:'候補と参考料金を確認',exact:true})).toBeVisible();
  await p.goBack();await expect(p).toHaveURL(/\/ja\/book$/);
  // A real Back here was observed, live, to sometimes fall back to a full document reload. Since
  // CH-04B that reload restores this same draft's unsaved Input from its draft-scoped cache (with a
  // status line) instead of discarding it, so a soft step-1->0 or the restored step 1 are both
  // correct landings -- never a broken or mixed state, and never a server write.
  await expect(p.getByLabel('利用開始日',{exact:true}).or(p.getByRole('button',{name:'候補と参考料金を確認',exact:true}))).toBeVisible();
  await p.goForward();await expect(p).toHaveURL(/\/ja\/book$/);await p.waitForLoadState('networkidle');
  // Whichever of step 0/1 this lands on is safe; re-supply the input and continue if needed --
  // this test is about the review/checkout-consistency guarantees below (CH-04B restore itself is
  // covered by its own case).
  await expect(p.getByLabel('利用開始日',{exact:true}).or(p.getByRole('button',{name:'候補と参考料金を確認',exact:true}))).toBeVisible();
  if(await p.getByLabel('利用開始日',{exact:true}).isVisible()){
   await p.getByLabel('利用開始日',{exact:true}).fill('2035-02-01');await p.getByLabel('利用終了日',{exact:true}).fill('2035-02-01');
   await p.getByRole('button',{name:'用品を選ぶ',exact:true}).click();
  }
  await expect(p.getByRole('button',{name:'候補と参考料金を確認',exact:true})).toBeVisible();
  // Reach a real, server-saved final review for a SKI set (this exercises the normal,
  // fully-synced path end to end; nothing here is synthetic).
  await p.getByLabel('ポールのサイズ 1',{exact:true}).selectOption('pole-'+variants.pole);
  await p.getByRole('button',{name:'候補と参考料金を確認',exact:true}).click();
  await p.getByRole('radio',{name:/おすすめ/}).check();await p.getByLabel('全員のサイズ・モデル条件・ウェア構成を確認した').check();
  await p.getByRole('button',{name:'全員分の最終確認へ'}).click();
  await expect(p.getByRole('region',{name:'全員分の確認'})).toContainText('スキーセット');
  // 4) UIR-04-A: a direct visit/restore of this saved review (a plain reload, which preserves
  // this exact entry's own history.state) must resume on the same review, and "条件を編集し
  // て再計算" from there -- with no other real entry of ours behind this one -- must fall back
  // to a safe push/replace within /book rather than guessing a history.go() distance and
  // leaving the app. A real go()-based jump would change history.length; a push adds exactly one.
  await p.reload();await expect(p.getByRole('region',{name:'全員分の確認'})).toContainText('スキーセット');
  const lengthBeforeEdit=await p.evaluate(()=>history.length);
  await p.getByRole('button',{name:'条件を編集して再計算'}).click();
  await expect(p).toHaveURL(/\/ja\/book$/);
  await expect(p.getByRole('button',{name:'候補と参考料金を確認',exact:true})).toBeVisible();
  assert.equal(await p.evaluate(()=>history.length),lengthBeforeEdit+1,'no prior real entry existed to retrace, so this must push a new one, not guess a history.go() distance');
  // 3) Only an explicit resubmit (save input + preview + selection) can restore checkout
  // eligibility for a changed condition -- switching to SNOWBOARD and resubmitting reaches a
  // fresh, fully-synced review for it.
  await p.getByLabel('用品 1',{exact:true}).selectOption('SNOWBOARD');
  await p.getByRole('button',{name:'候補と参考料金を確認',exact:true}).click();
  await p.getByRole('radio',{name:/おすすめ/}).check();await p.getByLabel('全員のサイズ・モデル条件・ウェア構成を確認した').check();
  await p.getByRole('button',{name:'全員分の最終確認へ'}).click();
  await expect(p.getByRole('region',{name:'全員分の確認'})).toContainText('スノーボードセット');
  await p.getByLabel('合成データによる開発確認であることを確認').check();
  await expect(p.getByRole('button',{name:'この内容で支払う（開発用決済）',exact:true})).toBeEnabled();
  await expect(p.getByText('内容が変更されています')).toHaveCount(0);
  await ctx.close();
  // 2) UIR-03: editing the equipment AFTER a saved review, without resubmitting, must never
  // let a stale review be shown as checkout-ready once it no longer matches the edit. Directly
  // exercising this end to end turned out to be structurally impossible in this app as it
  // actually runs: a live network trace showed that ANY popstate event on this route -- a real
  // Back/Forward, our own history.go() fallback, or even a synthetic dispatch carrying Next's
  // own history.state fields -- is caught by Next.js's own global popstate handling and turned
  // into a full document reload, which resets all local React state (including any unsaved
  // edit) before it could ever reach a mismatched checkout. That reload is an emergent
  // Next.js/dev-mode side effect this fix does not control, not something this fix relies on;
  // the actual safety net is computeMaxStep's input/selection-sync clamp and contractSynced's
  // checkout gate, both separately verified at the function level against the reviewer's exact
  // counter-examples (see docs/execution/prelaunch-uiux/FINDINGS.md). What IS directly
  // observable here, and is what this asserts, is the real, live guarantee that actually
  // matters: after editing equipment post-review, a stale review is never shown as
  // checkout-ready -- before CH-04B the reload dropped the edit and showed only the server's own
  // contract; since CH-04B it restores the edit and no review/checkout is reachable at all.
  const ctx2=await browser.newContext({baseURL:app!.origin,viewport:{width:390,height:844}});ctx2.setDefaultTimeout(15000);const p2=await ctx2.newPage();last=p2;
  await p2.goto('/ja/book');await expect(p2.getByLabel('利用開始日',{exact:true})).toBeEnabled();
  await p2.getByLabel('利用開始日',{exact:true}).fill('2035-02-03');await p2.getByLabel('利用終了日',{exact:true}).fill('2035-02-03');
  await p2.getByRole('button',{name:'用品を選ぶ',exact:true}).click();
  await p2.getByLabel('ポールのサイズ 1',{exact:true}).selectOption('pole-'+variants.pole);
  await p2.getByRole('button',{name:'候補と参考料金を確認',exact:true}).click();
  await p2.getByRole('radio',{name:/おすすめ/}).check();await p2.getByLabel('全員のサイズ・モデル条件・ウェア構成を確認した').check();
  await p2.getByRole('button',{name:'全員分の最終確認へ'}).click();
  await expect(p2.getByRole('region',{name:'全員分の確認'})).toContainText('スキーセット');
  await p2.getByRole('button',{name:'条件を編集して再計算'}).click();
  await expect(p2.getByRole('button',{name:'候補と参考料金を確認',exact:true})).toBeVisible();
  await p2.getByLabel('用品 1',{exact:true}).selectOption('SNOWBOARD');
  await expect(p2.getByRole('status').filter({hasText:'保存されていない変更があります'})).toBeVisible();
  await p2.evaluate(()=>window.dispatchEvent(new PopStateEvent('popstate',{state:{...(history.state as object),step:3}})));await p2.waitForLoadState('networkidle');
  // Since CH-04B that full reload restores this same draft's unsaved SNOWBOARD edit instead of
  // discarding it -- and because it no longer matches the server's saved Ski review, neither the
  // review nor checkout is reachable from it; only the ordinary save path could bring one back.
  await expect(p2.getByRole('status').filter({hasText:'未保存の入力を復元しました'})).toBeVisible();
  await expect(p2.getByLabel('用品 1',{exact:true})).toHaveValue('SNOWBOARD');
  await expect(p2.getByRole('region',{name:'全員分の確認'})).toHaveCount(0);
  await expect(p2.getByRole('button',{name:/支払う/})).toHaveCount(0);
  // 5) Same guard for a candidate-direction change made after an existing selection (pick a
  // different direction on step 2 while a server selection already exists, without resubmitting
  // it) is verified at the function level only: computeMaxStep's selectionSynced branch is
  // exercised directly against the reviewer's own counter-example in an isolated check (see
  // docs/execution/prelaunch-uiux/FINDINGS.md). It could not be exercised live end to end --
  // there is no in-app path back to step 2 that leaves an existing d.selection intact (the only
  // button back to step 2 re-submits a fresh preview, which itself clears any prior selection),
  // and reaching it any other way requires a popstate, which this same app was independently
  // observed to always resolve via a full reload that discards the very local pick being tested,
  // for the identical reason (4) documented above.
  // 6) None of this history navigation (real or synthetic) ever HOLD stock or created a booking.
  assert.equal((await app!.db.pool.query('SELECT count(*)::int n FROM inventory_holds')).rows[0].n,holdsBefore);
  await ctx2.close();
 });
 await check('UIR-03 regression (EN): a stale review is never shown as checkout-ready after an unsubmitted equipment edit',async()=>{
  const ctx=await browser.newContext({baseURL:app!.origin,viewport:{width:390,height:844}});ctx.setDefaultTimeout(15000);const p=await ctx.newPage();last=p;
  await p.goto('/en/book');await expect(p.getByLabel('Start date',{exact:true})).toBeEnabled();
  await p.getByLabel('Start date',{exact:true}).fill('2035-02-02');await p.getByLabel('End date',{exact:true}).fill('2035-02-02');
  await p.getByRole('button',{name:'Choose equipment',exact:true}).click();
  await p.getByLabel('Pole size 1',{exact:true}).selectOption('pole-'+variants.pole);
  await p.getByRole('button',{name:'Review sizes and estimates',exact:true}).click();
  await p.getByRole('radio',{name:/RECOMMENDED/i}).check();await p.getByLabel('I confirm each person’s size, model promise and wear selections').check();
  await p.getByRole('button',{name:'Review the whole group',exact:true}).click();
  await expect(p.getByRole('region',{name:'Group review'})).toContainText('Ski set');
  await p.getByRole('button',{name:'Edit and recalculate'}).click();
  await expect(p.getByRole('button',{name:'Review sizes and estimates',exact:true})).toBeVisible();
  await p.getByLabel('Equipment 1',{exact:true}).selectOption('SNOWBOARD');
  await expect(p.getByRole('status').filter({hasText:'unsaved changes'})).toBeVisible();
  await p.evaluate(()=>window.dispatchEvent(new PopStateEvent('popstate',{state:{...(history.state as object),step:3}})));await p.waitForLoadState('networkidle');
  // As in the JA test above, this popstate turns into a full reload, which since CH-04B restores
  // the unsaved Snowboard edit for this draft; it no longer matches the saved Ski review, so no
  // review or checkout is reachable until the ordinary save path runs again.
  await expect(p.getByRole('status').filter({hasText:'Unsaved entries restored'})).toBeVisible();
  await expect(p.getByLabel('Equipment 1',{exact:true})).toHaveValue('SNOWBOARD');
  await expect(p.getByRole('region',{name:'Group review'})).toHaveCount(0);
  await expect(p.getByRole('button',{name:/Pay/})).toHaveCount(0);
  await ctx.close();
 });
 const DRAFT_KEY='zao-guest-draft-input:v2:';
 const draftOf=(p:Page)=>p.evaluate(()=>fetch('/api/guest/draft',{cache:'no-store'}).then(r=>r.json())) as Promise<{id:string;revision:number;input:unknown}>;
 const cacheKeys=(p:Page)=>p.evaluate(prefix=>Object.keys(sessionStorage).filter(k=>k.startsWith(prefix)),DRAFT_KEY);
 async function toReview(p:Page,date:string,locale:'ja'|'en'='ja'){
  const ja=locale==='ja';await p.goto('/'+locale+'/book');await expect(p.getByLabel(ja?'利用開始日':'Start date',{exact:true})).toBeEnabled();
  await p.getByLabel(ja?'利用開始日':'Start date',{exact:true}).fill(date);await p.getByLabel(ja?'利用終了日':'End date',{exact:true}).fill(date);
  await p.getByRole('button',{name:ja?'用品を選ぶ':'Choose equipment',exact:true}).click();await p.getByLabel((ja?'ポールのサイズ':'Pole size')+' 1',{exact:true}).selectOption('pole-'+variants.pole);
  await p.getByRole('button',{name:ja?'候補と参考料金を確認':'Review sizes and estimates',exact:true}).click();await p.getByRole('radio',{name:ja?/おすすめ/:/Recommended/}).check();
  await p.getByLabel(ja?'全員のサイズ・モデル条件・ウェア構成を確認した':'I confirm each person’s size, model promise and wear selections').check();
  await p.getByRole('button',{name:ja?'全員分の最終確認へ':'Review the whole group',exact:true}).click();await expect(p.getByRole('region',{name:ja?'全員分の確認':'Group review'})).toBeVisible();
 }
 const newPage=async(width=390,height=844)=>{const ctx=await browser.newContext({baseURL:app!.origin,viewport:{width,height}});ctx.setDefaultTimeout(15000);const p=await ctx.newPage();last=p;p.on('dialog',d=>void d.accept());return {ctx,p};};
 const countOf=async(table:string)=>(await app!.db.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n as number;
 const noRawCode=async(p:Page)=>assert.doesNotMatch(await p.getByRole('main').innerText(),/\b[A-Z]{2,}_[A-Z_]{2,}\b/,'no internal enum or error code is customer-visible');
 await check('UI-FINAL-R01: static date and slot constraints stop invalid periods inline before any save',async()=>{
  for(const ja of [true,false]){
   const {ctx,p}=await newPage();await p.goto(ja?'/ja/book':'/en/book');
   const start=p.getByLabel(ja?'利用開始日':'Start date',{exact:true}),end=p.getByLabel(ja?'利用終了日':'End date',{exact:true}),slot=p.getByLabel(ja?'利用枠':'Rental slot',{exact:true});
   await expect(start).toBeEnabled();const posts:string[]=[];p.on('request',r=>{if(r.method()==='POST')posts.push(new URL(r.url()).pathname);});
   await start.fill('2035-06-02');
   for(const [endDate,rentalSlot,key,copy] of [
    ['2035-06-01','DAY','endDate',ja?'開始日以降':'on or after'],
    ['2035-06-12','MULTIDAY','endDate',ja?'最大10日':'no more than 10 days'],
    ['2035-06-03','DAY','slot',ja?'複数日':'Multiple days'],
    ['2035-06-02','MULTIDAY','slot',ja?'午前・午後・1日':'Morning, Afternoon or Full day'],
   ]){
    await end.fill(endDate!);await slot.selectOption(rentalSlot!);await p.getByRole('button',{name:ja?'用品を選ぶ':'Choose equipment',exact:true}).click();
    await expect(p.locator('#guest-err-'+key)).toContainText(copy!);await expect(key==='slot'?slot:end).toHaveAttribute('aria-invalid','true');await expect(start).toBeVisible();
   }
   assert.deepEqual(posts,[]);await end.fill('2035-06-11');await slot.selectOption('MULTIDAY');
   await p.getByRole('button',{name:ja?'用品を選ぶ':'Choose equipment',exact:true}).click();await expect(p.getByLabel(ja?'用品 1':'Equipment 1',{exact:true})).toBeVisible();
   await noRawCode(p);await ctx.close();
  }
 });
 await check('UI-FINAL-R01: numeric controls mirror server bounds, tenths, and the SKI age category including zero',async()=>{
  for(const ja of [true,false]){
   const {ctx,p}=await newPage();await p.goto(ja?'/ja/book':'/en/book');await expect(p.getByLabel(ja?'利用開始日':'Start date',{exact:true})).toBeEnabled();
   await p.getByLabel(ja?'利用開始日':'Start date',{exact:true}).fill('2035-07-01');await p.getByRole('button',{name:ja?'用品を選ぶ':'Choose equipment',exact:true}).click();
   const height=p.getByLabel(ja?'身長cm 1':'Height cm 1',{exact:true}),foot=p.getByLabel(ja?'足サイズcm 1':'Foot size cm 1',{exact:true}),weight=p.getByLabel(ja?'体重kg 1':'Weight kg 1',{exact:true}),age=p.getByLabel(ja?'開始日の年齢 1':'Age at start 1',{exact:true});
   for(const [control,min,max,step] of [[height,'50','250','1'],[foot,'5','50','0.1'],[weight,'5','300','any'],[age,'0','120','1']] as const){await expect(control).toHaveAttribute('min',min);await expect(control).toHaveAttribute('max',max);await expect(control).toHaveAttribute('step',step);}
   await expect(height).toHaveAttribute('inputmode','numeric');await expect(foot).toHaveAttribute('inputmode','decimal');await expect(age).toHaveAttribute('inputmode','numeric');
   const posts:string[]=[];p.on('request',r=>{if(r.method()==='POST')posts.push(new URL(r.url()).pathname);});
   for(const [control,key,invalidValues,validValues] of [
    [height,'height',['49','251','170.5'],['50','250','170']],
    [foot,'foot',['4.9','50.1','25.15'],['5','50','25.1','25.3']],
    [weight,'weight',['4.9','300.1'],['5','300','60.25']],
    [age,'age',['-1','121','30.5'],['13','120','30']],
   ] as const){
    for(const value of invalidValues){await control.fill(value);await control.blur();await expect(control).toHaveAttribute('aria-invalid','true');await expect(p.locator('#guest-err-m0-'+key)).toBeVisible();}
    for(const value of validValues){await control.fill(value);await control.blur();await expect(control).not.toHaveAttribute('aria-invalid','true');}
   }
   await age.fill('12');await age.blur();await expect(p.locator('#guest-err-m0-age')).toContainText(ja?'13歳以上は大人':'Adult for 13 or older');
   await p.getByLabel(ja?'年齢区分 1':'Age category 1',{exact:true}).selectOption('KIDS');await age.fill('0');
   await p.getByRole('button',{name:ja?'候補と参考料金を確認':'Review sizes and estimates',exact:true}).click();
   await expect(age).not.toHaveAttribute('aria-invalid','true');await expect(p.locator('#guest-err-m0-age')).toHaveCount(0);await expect(p.locator('#guest-err-m0-pole')).toBeVisible();
   assert.deepEqual(posts,[],'invalid input is blocked locally; missing child pole remains an independent error');await noRawCode(p);await ctx.close();
  }
 });
 await check('CH-04B: unsaved Input survives a hard reload for the same draft only; the restore sends nothing and checkout stays impossible until the ordinary server save',async()=>{
  const {ctx,p}=await newPage();await p.goto('/ja/book');await expect(p.getByLabel('利用開始日',{exact:true})).toBeEnabled();
  const before=await draftOf(p);
  await p.getByLabel('利用開始日',{exact:true}).fill('2035-03-02');await p.getByLabel('利用終了日',{exact:true}).fill('2035-03-03');await p.getByLabel('利用枠',{exact:true}).selectOption('MULTIDAY');
  await p.getByRole('button',{name:'用品を選ぶ',exact:true}).click();await p.getByLabel('ポールのサイズ 1',{exact:true}).selectOption('pole-'+variants.pole);await p.getByLabel('身長cm 1',{exact:true}).fill('172');
  const envelope=JSON.parse((await p.evaluate(k=>sessionStorage.getItem(k),DRAFT_KEY+before.id))??'null');
  assert.deepEqual(Object.keys(envelope).sort(),['baseRevision','baseServerInputFingerprint','draftId','input','schemaVersion']);
  assert.deepEqual([envelope.schemaVersion,envelope.draftId,envelope.baseRevision,envelope.input.members[0].heightCm],[2,before.id,before.revision,172]);
  assert.doesNotMatch(JSON.stringify(envelope),/@|displayName|email|contact|token|paymentSource|recovery|qr/i,'only Input is stored');
  assert.deepEqual(await p.evaluate(()=>[localStorage.length,JSON.stringify(history.state??null).includes('172')]),[0,false],'no localStorage and no Input in history.state');
  const posts:string[]=[];p.on('request',r=>{if(r.method()==='POST')posts.push(new URL(r.url()).pathname);});
  await p.reload();
  await expect(p.getByRole('status').filter({hasText:'未保存の入力を復元しました'})).toBeVisible();
  await expect(p.getByLabel('身長cm 1',{exact:true})).toHaveValue('172');await expect(p.getByLabel('ポールのサイズ 1',{exact:true})).toHaveValue('pole-'+variants.pole);
  assert.deepEqual(posts.filter(x=>x!=='/api/guest/context'),[],'restoring sends no draft/preview/selection/checkout request');
  const server=await draftOf(p);assert.equal(server.revision,before.revision);assert.deepEqual(server.input,before.input);
  await expect(p.getByRole('region',{name:'全員分の確認'})).toHaveCount(0);await expect(p.getByRole('button',{name:/支払う/})).toHaveCount(0);
  await mkdir('.local/screenshots',{recursive:true});await p.screenshot({path:'.local/screenshots/guest-restored-ja-390.png',fullPage:true});
  // The ordinary save path is the only way forward, and it clears the cache.
  await p.getByRole('button',{name:'候補と参考料金を確認',exact:true}).click();await expect(p.getByRole('radio',{name:/おすすめ/})).toBeVisible();
  assert.deepEqual(await cacheKeys(p),[]);assert.equal(((await draftOf(p)).input as {members:{heightCm:number}[]}).members[0]!.heightCm,172);
  await ctx.close();
 });
 await check('CH-04B: a new guest context never restores the previous context’s cached Input',async()=>{
  const {ctx,p}=await newPage();await p.goto('/ja/book');await expect(p.getByLabel('利用開始日',{exact:true})).toBeEnabled();
  const before=await draftOf(p);await p.getByLabel('利用開始日',{exact:true}).fill('2035-03-04');await p.getByLabel('利用終了日',{exact:true}).fill('2035-03-04');
  assert.deepEqual(await cacheKeys(p),[DRAFT_KEY+before.id]);
  assert.equal(await p.evaluate(()=>fetch('/api/guest/logout',{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.status)),200);
  await p.reload();await expect(p.getByLabel('利用開始日',{exact:true})).toBeEnabled();
  const after=await draftOf(p);assert.notEqual(after.id,before.id);
  await expect(p.getByLabel('利用開始日',{exact:true})).toHaveValue('');await expect(p.getByText('未保存の入力を復元しました')).toHaveCount(0);
  assert.deepEqual(await cacheKeys(p),[],'the old context’s cache is discarded, not restored');
  await ctx.close();
 });
 await check('CH-04B: a server revision change discards the stale cache instead of restoring it',async()=>{
  const {ctx,p}=await newPage();await p.goto('/ja/book');await expect(p.getByLabel('利用開始日',{exact:true})).toBeEnabled();
  const before=await draftOf(p);await p.getByLabel('利用開始日',{exact:true}).fill('2035-03-06');await p.getByLabel('利用終了日',{exact:true}).fill('2035-03-06');
  await p.getByRole('button',{name:'用品を選ぶ',exact:true}).click();await p.getByLabel('ポールのサイズ 1',{exact:true}).selectOption('pole-'+variants.pole);
  const cached=JSON.parse((await p.evaluate(k=>sessionStorage.getItem(k),DRAFT_KEY+before.id))!);
  const saved=await p.evaluate(body=>fetch('/api/guest/draft',{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json()),{draftId:before.id,expectedRevision:before.revision,input:{...cached.input,period:{startDate:'2035-03-20',endDate:'2035-03-20',slot:'DAY'}}});
  assert.equal(saved.revision,before.revision+1);
  await p.reload();await expect(p.getByRole('button',{name:'候補と参考料金を確認',exact:true})).toBeVisible();
  await expect(p.getByText('未保存の入力を復元しました')).toHaveCount(0);await expect.poll(()=>cacheKeys(p)).toEqual([]);
  await p.getByRole('button',{name:'日程に戻る',exact:true}).click();
  await expect(p.getByLabel('利用開始日',{exact:true})).toHaveValue('2035-03-20');
  await ctx.close();
 });
 await check('NR-03 B: insufficient stock at payment shows customer copy, never a raw code, and stays unpayable',async()=>{
  const {ctx,p}=await newPage();await toReview(p,'2035-03-16');
  const holds=await countOf('inventory_holds'),bookings=await countOf('rental_bookings');
  const c=await app!.db.pool.connect();let ids:string[]=[];
  try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor','synthetic-nr03',true),set_config('zao.reason','SYNTHETIC NR-03 stock shortage',true)");// Only free skis: ones already claimed by earlier bookings (or in transfer) are protected by the stock guard and are unavailable anyway.
   ids=(await c.query("UPDATE ledger_assets SET status='MAINTENANCE' WHERE family='SKI' AND status='AVAILABLE' AND NOT EXISTS(SELECT 1 FROM inventory_claims WHERE asset_id=ledger_assets.id AND active) AND NOT EXISTS(SELECT 1 FROM transfer_pieces WHERE asset_id=ledger_assets.id AND state NOT IN ('CANCELLED','CLOSED')) RETURNING id")).rows.map(r=>r.id);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  try{
   await p.getByLabel('合成データによる開発確認であることを確認').check();await p.getByRole('button',{name:'この内容で支払う（開発用決済）',exact:true}).click();
   await expect(p.getByRole('main').getByRole('alert')).toContainText('在庫を確保できませんでした');
   await expect(p.getByRole('region',{name:'予約を続けられません'})).toContainText('在庫を確保できませんでした');
   await expect(p.getByRole('button',{name:/支払う/})).toHaveCount(0);await noRawCode(p);
   assert.equal(await countOf('inventory_holds'),holds);assert.equal(await countOf('rental_bookings'),bookings);
   await p.screenshot({path:'.local/screenshots/guest-insufficient-stock-ja-390.png',fullPage:true});
  }finally{
   const r=await app!.db.pool.connect();try{await r.query('BEGIN');await r.query("SELECT set_config('zao.actor','synthetic-nr03',true),set_config('zao.reason','SYNTHETIC NR-03 stock restore',true)");await r.query("UPDATE ledger_assets SET status='AVAILABLE' WHERE id=ANY($1::uuid[])",[ids]);await r.query('COMMIT');}finally{r.release();}
  }
  await ctx.close();
 });
 const quotes=new QuoteService(app.roles.pricingPool,(await loadStaff(app.db.pool,root))!);
 async function changeSkiPrice(jpy:number,at:string){const base=(await quotes.catalog()).active!;const book=await quotes.createDraft(randomUUID(),base.book_id,'2035-01-01','2035-12-31');await quotes.editDraft(book.id,book.revision,'SKI_SET_ADULT_REGULAR','DAY_1',jpy);await app!.db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${at}'::timestamptz$$`);await quotes.activate(book.id,book.revision+1,new Date(at).toISOString(),base.id);}
 await check('NR-03 A: a price change after review shows the new total, is accepted explicitly, and the same flow then pays exactly once',async()=>{
  const {ctx,p}=await newPage();await toReview(p,'2035-03-12');
  const oldTotal=(await p.locator('dl.guest-price dd').last().innerText()).trim();
  await changeSkiPrice(7600,'2035-01-01T01:00:01Z');
  const bookings=await countOf('rental_bookings'),attempts=await countOf('rental_payment_attempts');
  await p.getByLabel('合成データによる開発確認であることを確認').check();await p.getByRole('button',{name:'この内容で支払う（開発用決済）',exact:true}).click();
  await expect(p.getByRole('main').getByRole('alert')).toContainText('料金が更新されました');
  const panel=p.getByRole('region',{name:'料金の更新'});await expect(panel).toContainText(oldTotal);await expect(panel).toContainText('7,600');
  await expect(p.getByRole('button',{name:/支払う/})).toBeDisabled();await noRawCode(p);
  assert.deepEqual([await countOf('rental_bookings'),await countOf('rental_payment_attempts')],[bookings,attempts],'nothing is booked or charged at the changed price');
  await p.screenshot({path:'.local/screenshots/guest-price-changed-ja-390.png',fullPage:true});
  await panel.getByRole('button',{name:'新しい料金を確認して続ける',exact:true}).click();await expect(panel).toHaveCount(0);
  await expect(p.locator('dl.guest-price dd').last()).toContainText('7,600');
  assert.equal(await countOf('rental_payment_attempts'),attempts,'accepting the new price does not pay by itself (no blind retry)');
  await p.getByRole('button',{name:'この内容でもう一度支払う（開発用決済）',exact:true}).click();
  await expect(p.getByRole('heading',{name:'予約が確認されました',exact:true})).toBeVisible();
  assert.equal(await countOf('rental_payment_attempts'),attempts+1);
  assert.equal((await app!.db.pool.query("SELECT (price_snapshot->>'totalJpy')::int t FROM rental_bookings ORDER BY created_at DESC LIMIT 1")).rows[0].t,7600);
  await ctx.close();
 });
 await check('NR-03 C: an expired HOLD (inventory_clock advanced, no wall-clock wait) is shown plainly and can never be paid',async()=>{
  const {ctx,p}=await newPage();await toReview(p,'2035-03-14');
  await changeSkiPrice(7700,'2035-01-01T01:00:02Z');
  await p.getByLabel('合成データによる開発確認であることを確認').check();await p.getByRole('button',{name:'この内容で支払う（開発用決済）',exact:true}).click();
  await expect(p.getByRole('region',{name:'料金の更新'})).toBeVisible();
  const holdId=(await app!.db.pool.query("SELECT id FROM inventory_holds WHERE state='ACTIVE' ORDER BY expires_at DESC LIMIT 1")).rows[0].id as string;
  await app!.db.pool.query("CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-01-01T02:30:00Z'::timestamptz$$");
  const attempts=await countOf('rental_payment_attempts');
  try{
   await p.getByRole('button',{name:'保存済みの結果を再読込',exact:true}).click();
   await expect(p.getByRole('region',{name:'予約を続けられません'})).toContainText('在庫の確保期限が切れました');
   await expect(p.getByRole('region',{name:'料金の更新'})).toHaveCount(0);await expect(p.getByRole('button',{name:/支払う/})).toHaveCount(0);await noRawCode(p);
   assert.equal(await countOf('rental_payment_attempts'),attempts);assert.equal((await app!.db.pool.query('SELECT count(*)::int n FROM rental_bookings WHERE hold_id=$1',[holdId])).rows[0].n,0);
   await p.screenshot({path:'.local/screenshots/guest-hold-expired-ja-390.png',fullPage:true});
  }finally{await app!.db.pool.query("CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-01-01T01:00:02Z'::timestamptz$$");}
  await ctx.close();
 });
 await check('visual acceptance: JA/EN at 390 and 1440 for dates, equipment, candidates, review and confirmation, with inline validation and no horizontal overflow',async()=>{
  let day=22;
  for(const [locale,width] of [['ja',390],['en',390],['ja',1440],['en',1440]] as const){
   const ja=locale==='ja',{ctx,p}=await newPage(width,width===390?844:900),shot=(n:string)=>p.screenshot({path:`.local/screenshots/guest-${n}-${locale}-${width}.png`,fullPage:true}),fits=async()=>assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await p.goto('/'+locale+'/book');await expect(p.getByLabel(ja?'利用開始日':'Start date',{exact:true})).toBeEnabled();
   // Forward attempt with nothing entered: messages appear beside the fields, not while typing.
   await p.getByRole('button',{name:ja?'用品を選ぶ':'Choose equipment',exact:true}).click();
   await expect(p.getByText(ja?'利用開始日を選択してください。':'Choose a start date.')).toBeVisible();await expect(p.getByLabel(ja?'利用開始日':'Start date',{exact:true})).toHaveAttribute('aria-invalid','true');
   await shot('dates-invalid');const date='2035-03-'+String(day++);
   await p.getByLabel(ja?'利用開始日':'Start date',{exact:true}).fill(date);await p.getByLabel(ja?'利用終了日':'End date',{exact:true}).fill(date);
   await expect(p.getByText(ja?'利用開始日を選択してください。':'Choose a start date.')).toHaveCount(0);await fits();await shot('dates');
   await p.getByRole('button',{name:ja?'用品を選ぶ':'Choose equipment',exact:true}).click();
   for(const [label,mode] of [[ja?'身長cm 1':'Height cm 1','numeric'],[ja?'足サイズcm 1':'Foot size cm 1','decimal'],[ja?'体重kg 1':'Weight kg 1','numeric']] as const)await expect(p.getByLabel(label,{exact:true})).toHaveAttribute('inputmode',mode);
   await p.getByRole('button',{name:ja?'候補と参考料金を確認':'Review sizes and estimates',exact:true}).click();
   await expect(p.getByText(ja?'ポールのサイズを選択してください。':'Choose a pole size.')).toBeVisible();await fits();await shot('equipment-invalid');
   await p.getByLabel((ja?'ポールのサイズ':'Pole size')+' 1',{exact:true}).selectOption('pole-'+variants.pole);await expect(p.getByText(ja?'ポールのサイズを選択してください。':'Choose a pole size.')).toHaveCount(0);await shot('equipment');
   await p.getByRole('button',{name:ja?'候補と参考料金を確認':'Review sizes and estimates',exact:true}).click();await expect(p.getByRole('radio',{name:ja?/おすすめ/:/Recommended/})).toBeVisible();
   for(const raw of ['SHORTER','RECOMMENDED','LONGER'])await expect(p.getByRole('main')).not.toContainText(raw);
   await p.getByRole('radio',{name:ja?/おすすめ/:/Recommended/}).check();await p.getByLabel(ja?'全員のサイズ・モデル条件・ウェア構成を確認した':'I confirm each person’s size, model promise and wear selections').check();await fits();await shot('candidate');
   await p.getByRole('button',{name:ja?'全員分の最終確認へ':'Review the whole group',exact:true}).click();
   const review=p.getByRole('region',{name:ja?'全員分の確認':'Group review'});
   for(const text of ja?['日程','受取店舗','返却店舗','利用者 1','Regular','小計','全員分の参考総額']:['Dates','Pickup store','Return store','Person 1','Regular','Subtotal','Group estimate'])await expect(review).toContainText(text);
   await expect(p.getByLabel(ja?'メール（架空）':'Email (synthetic)',{exact:true})).toHaveAttribute('inputmode','email');await noRawCode(p);await fits();await shot('review');
   await p.getByRole('button',{name:ja?'この内容で支払う（開発用決済）':'Pay with these details (test payment)',exact:true}).click();
   await expect(p.getByText(ja?'内容に同意したらチェックを入れてください。':'Tick this box to accept.')).toBeVisible();
   await p.getByLabel(ja?'合成データによる開発確認であることを確認':'I understand this is a synthetic development preview').check();await expect(p.getByText(ja?'内容に同意したらチェックを入れてください。':'Tick this box to accept.')).toHaveCount(0);
   await p.getByRole('button',{name:ja?'この内容で支払う（開発用決済）':'Pay with these details (test payment)',exact:true}).click();
   await expect(p.getByRole('heading',{name:ja?'予約が確認されました':'Booking confirmed',exact:true})).toBeVisible();
   assert.deepEqual(await cacheKeys(p),[],'a confirmed booking keeps no draft-input cache');await noRawCode(p);await fits();await shot('confirmed');
   await ctx.close();
  }
 });
 await check('cross-guest/CSRF and role/amount tampering rejected; logout drops the former context',async()=>{
  const old=await (await context.request.get('/api/guest/draft')).json();const other=await browser.newContext({baseURL:app!.origin});assert.equal((await other.request.get('/api/guest/draft')).status(),401);assert.equal((await other.request.post('/api/guest/context',{data:{}})).status(),403);await other.request.post('/api/guest/context',{headers:{origin:app!.origin},data:{}});assert.equal((await other.request.post('/api/guest/draft',{headers:{origin:app!.origin},data:{draftId:old.id,expectedRevision:old.revision,input:old.input}})).status(),403);assert.equal((await context.request.post('/api/guest/checkout',{headers:{origin:app!.origin},data:{paid:true,amount:1,role:'ADMIN'}})).status(),422);await page.getByRole('button',{name:'この予約画面を閉じる'}).click();await page.waitForURL(app!.origin+'/ja');assert.equal((await context.request.get('/api/guest/draft')).status(),401);await other.close();
 });
 await check('guest-confirmed MULTIDAY first-day no-show -> normal staff login/UI -> day2 actual checkout, original contract/price unchanged',async()=>{
  const booking=(await app!.db.pool.query('SELECT * FROM rental_bookings ORDER BY created_at LIMIT 1')).rows[0];const before={conditions:booking.conditions,price:booking.price_snapshot,hash:booking.price_sha256};
  await app!.db.pool.query("CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-01-05T17:01:00+09:00'::timestamptz$$");assert.equal((await app!.db.pool.query('SELECT count(*)::int n FROM inventory_claims WHERE hold_id=$1 AND active',[booking.hold_id])).rows[0].n,6);
  const adminContext=await browser.newContext({baseURL:app!.origin}),adminPage=await adminContext.newPage();last=adminPage;adminContext.setDefaultTimeout(15000);await staffLogin(adminPage,'public-root@example.invalid');
  // URL navigation alone is not a completed authenticated UI. Create the handoff
  // operator through the existing management form after its session boundary opens.
  // One submission only: neither a 500 nor a lost response is retried here.
  await adminPage.goto('/staff/users');await adminPage.getByRole('button',{name:'スタッフを作成',exact:true}).click();
  const form=adminPage.getByRole('form',{name:'スタッフ作成'});await form.getByLabel('表示名',{exact:true}).fill('SYNTHETIC Handoff');await form.getByLabel('メールアドレス',{exact:true}).fill('public-custody@example.invalid');await form.getByLabel('初期パスワード（15〜128文字）').fill(password);await form.getByLabel('Mountain Station',{exact:true}).check();
  for(const label of ['台帳の閲覧','予約の閲覧','受付・貸出'])await form.getByLabel(label,{exact:true}).selectOption('allow');
  const [created]=await Promise.all([adminPage.waitForResponse(r=>r.url()===app!.origin+'/api/staff-users'&&r.request().method()==='POST',{timeout:60000}),form.getByRole('button',{name:'スタッフ設定を保存'}).click()]);console.log('STAFF_CREATION '+JSON.stringify({status:created.status(),json:created.headers()['content-type']?.includes('application/json')===true}));assert.equal(created.status(),201);await expect(adminPage.getByRole('heading',{name:'SYNTHETIC Handoff',exact:true})).toBeVisible();await adminContext.close();
  const staff=await browser.newContext({baseURL:app!.origin,viewport:{width:390,height:844}});staff.setDefaultTimeout(15000);const p=await staff.newPage();last=p;await staffLogin(p,'public-custody@example.invalid');
  await app!.db.pool.query("CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-01-06T10:00:00+09:00'::timestamptz$$");await p.goto('/staff/rental');await expect.poll(()=>p.getByRole('button',{name:'予約と仮割当を照合'}).evaluate(b=>typeof (b as HTMLButtonElement).onclick)).toBe('function');await p.getByLabel('予約IDまたは予約QR').fill('zao-rental:reservation:'+booking.id);await p.evaluate(async()=>{window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:false}));await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));});await expect(p.getByLabel('予約IDまたは予約QR')).toHaveValue('zao-rental:reservation:'+booking.id);const assignmentResponse=p.waitForResponse(r=>r.url().includes('/api/custody/booking/')&&r.request().method()==='GET');await expect(p.getByLabel('予約IDまたは予約QR')).toHaveValue('zao-rental:reservation:'+booking.id);await p.getByRole('button',{name:'予約と仮割当を照合'}).click();const ar=await assignmentResponse;const av=await ar.json();console.log('HANDOFF_RESPONSE '+JSON.stringify({status:ar.status(),error:av.error,pickupTiming:av.pickupTiming}));await expect(p.getByRole('region',{name:'貸出用品'})).toContainText('LATE_PICKUP_ELIGIBLE');await p.getByLabel('準備・最終適合の作業記録').fill('SYNTHETIC staff handoff, no DIN inference');await p.getByLabel('表示された個体と数量を照合した').check();await p.getByRole('button',{name:'照合した用品を準備固定'}).click();await p.getByRole('button',{name:'道具の貸出を記録'}).click();await expect(p.getByRole('region',{name:'貸出用品'})).toContainText('OUT');const after=(await app!.db.pool.query('SELECT * FROM rental_bookings WHERE id=$1',[booking.id])).rows[0];assert.deepEqual({conditions:after.conditions,price:after.price_snapshot,hash:after.price_sha256},before);const loans=(await app!.db.pool.query('SELECT checked_out_at,due_at FROM rental_loan_items WHERE booking_id=$1',[booking.id])).rows;assert.equal(loans.length,3);assert.ok(loans.every(l=>l.checked_out_at.toISOString()==='2035-01-06T01:00:00.000Z'&&l.due_at.toISOString()==='2035-01-06T08:00:00.000Z'));await p.screenshot({path:'.local/screenshots/late-pickup-staff-mobile.png',fullPage:true});await staff.close();
 });
 console.log(`Public/guest UI ${count} cases passed; synthetic adapter and mobile viewport, not real device/Square.`);
}catch(e){failed=true;console.error('PUBLIC_UI_FAILED '+stage+' '+JSON.stringify({kind:e instanceof assert.AssertionError?'ASSERTION':e instanceof Error&&/ECONNRESET/.test(e.message)?'ECONNRESET':'BROWSER_TEST_FAILED'}));if(last){await mkdir('.local/screenshots',{recursive:true});await last.screenshot({path:'.local/screenshots/public-failure.png',fullPage:true});console.error('LAYOUT '+JSON.stringify(await last.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,wide:[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width})).slice(0,10)}))));}if(last)console.error('PAGE_ALERT '+(await last.locator('[role=alert],[role=status]').allTextContents()).join(' '));console.error((e as Error).stack?.split('\n').filter(s=>s.includes('/tests/public/')).join('\n'));}finally{await browser.close();await app?.stop();console.log('Owned Public browser/Web/PostgreSQL stopped.');}if(failed)process.exit(1);
