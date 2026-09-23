import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {startFlowApp} from '../flow/launcher';
import {seedRecommendation,variants} from '../recommendation/fixture';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
const browser=await chromium.launch();let app:Awaited<ReturnType<typeof startFlowApp>>|undefined,failed=false,stage='setup';
try{
 app=await startFlowApp({publicP0:true,publicP1:true,publicP4:true});await seedRecommendation(app.db.pool,true);
 const clock=async(t:string)=>{assert.match(t,/^[0-9:T+-]+$/);await app!.db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${t}'::timestamptz$$`);};await clock('2035-01-01T10:00:00+09:00');
 const root=await bootstrapDevelopmentAdmin(app.db.pool,{email:'p4-root@example.invalid',displayName:'SYNTHETIC P4',password:randomBytes(24).toString('base64url')});for(const permission of ['QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT'])await app.db.pool.query('INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,$2,true)',[root,permission]);await new QuoteService(app.roles.pricingPool,(await loadStaff(app.db.pool,root))!).initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 const context=await browser.newContext({baseURL:app.origin,viewport:{width:390,height:844},hasTouch:true});context.setDefaultTimeout(15000);const page=await context.newPage();
 stage='ordinary guest UI confirmation';await page.goto('/ja/book');await expect(page.getByLabel('利用開始日',{exact:true})).toBeEnabled();await page.getByLabel('利用開始日',{exact:true}).fill('2035-01-05');await page.getByLabel('利用終了日',{exact:true}).fill('2035-01-05');await page.getByRole('button',{name:'用品を選ぶ',exact:true}).click();await page.getByLabel('ポールのサイズ 1',{exact:true}).selectOption('pole-'+variants.pole);await page.getByRole('button',{name:'候補と参考料金を確認',exact:true}).click();await page.getByRole('radio',{name:/おすすめ/}).check();await page.getByRole('checkbox',{name:'全員のサイズ・モデル条件・ウェア構成を確認した'}).check();await page.getByRole('button',{name:'全員分の最終確認へ'}).click();await page.getByRole('checkbox',{name:'合成データによる開発確認であることを確認'}).check();await page.getByRole('button',{name:'この内容で予約を確定する（開発用決済）'}).click();await expect(page.getByRole('heading',{name:'予約が確認されました',exact:true})).toBeVisible();
 console.log('PASS normal guest UI -> protected API -> synthetic payment -> confirmed real PostgreSQL booking');
 stage='response loss';let ack!:()=>void;const lost=new Promise<void>(r=>ack=r);await page.route('**/api/booking-access/issue',async route=>{const response=await route.fetch();if(response.status()!==200)throw new Error('ACCESS_ISSUE_FAILED');await route.abort('failed');ack();});await page.getByRole('button',{name:'予約閲覧をこの端末へ保存'}).click();await lost;await expect(page.getByRole('region',{name:'予約閲覧の保存'}).getByRole('status')).toContainText('未確認');await context.clearCookies({name:'zao_booking_access'});await page.unroute('**/api/booking-access/issue');await page.reload();await expect(page.getByRole('button',{name:'予約閲覧をこの端末へ保存'})).toBeVisible();await page.getByRole('button',{name:'予約閲覧をこの端末へ保存'}).click();await page.getByRole('link',{name:'保存した予約とQRを開く'}).click();await expect(page.getByRole('img',{name:'保存済み予約QR'})).toBeVisible();assert.equal((await app.db.pool.query('SELECT count(*)::int n FROM booking_access.capabilities')).rows[0].n,1);assert.equal((await app.db.pool.query('SELECT count(*)::int n FROM rental_bookings')).rows[0].n,1);const cookie=(await context.cookies()).find(c=>c.name==='zao_booking_access')!;assert.ok(cookie.httpOnly);assert.equal(cookie.sameSite,'Strict');assert.equal(cookie.path,'/api/booking-access');assert.equal(page.url(),app.origin+'/ja/reservation');assert.equal((await page.content()).includes(cookie.value),false);
 console.log('PASS lost issuance response + reload replays one saved capability; raw token absent JSON/DOM/URL');
 stage='BA-01-RES initial/read reload has no unbound revoke';
 // Gate delivery to the component after the real authenticated GET completes.
 // A delayed Playwright Route can be disposed by dev navigation/interception
 // changes. This gate owns no Route and keeps the original response unchanged.
 let readGate:{entered:()=>void;blocked:Promise<void>}|null=null;
 await page.exposeFunction('waitForBookingReadTestGate',async()=>{const gate=readGate;if(gate){gate.entered();await gate.blocked;}});
 const installReadGate=()=>{
  const originalFetch=window.fetch;
  window.fetch=async(...args:Parameters<typeof fetch>)=>{
   const response=await originalFetch(...args),input=args[0];
   const url=new URL(input instanceof Request?input.url:String(input),location.href);
   if(url.origin===location.origin&&url.pathname==='/api/booking-access'&&(args[1]?.method??(input instanceof Request?input.method:'GET'))==='GET')await (window as unknown as {waitForBookingReadTestGate:()=>Promise<void>}).waitForBookingReadTestGate();
   return response;
  };
 };
 await page.addInitScript(installReadGate);await page.evaluate(installReadGate);
 for(const kind of ['reload-button','initial-load']){
  let entered!:()=>void,release!:()=>void;const observed=new Promise<void>(r=>entered=r),blocked=new Promise<void>(r=>release=r);
  readGate={entered,blocked};
  try{
   if(kind==='reload-button')await page.getByRole('button',{name:'予約を再読込',exact:true}).click();else await page.reload({waitUntil:'domcontentloaded'});
   await observed;await expect(page.getByRole('img',{name:'保存済み予約QR'})).toHaveCount(0);
   await expect(page.getByRole('button',{name:'この端末の予約閲覧権を失効'})).toBeDisabled();
   assert.equal((await app.db.pool.query('SELECT count(*)::int n FROM booking_access.capabilities WHERE revoked_at IS NULL')).rows[0].n,1);
  }finally{readGate=null;release();}
  await expect(page.getByRole('img',{name:'保存済み予約QR'})).toBeVisible();await expect(page.getByRole('button',{name:'この端末の予約閲覧権を失効'})).toBeEnabled();
 }
 console.log('PASS initial/reload pending read disables unbound revoke; settled binding enables deliberate revocation');
 stage='acknowledged revoke then deliberate resave';
 const bookingId=(await app.db.pool.query('SELECT id FROM rental_bookings')).rows[0].id as string,requestStorage='zao-booking-access-request:'+bookingId;
 const firstRequest=await page.evaluate(key=>sessionStorage.getItem(key),requestStorage);assert.ok(firstRequest);
 const otherStorage='zao-booking-access-request:'+randomUUID(),otherRequest=randomUUID();await page.evaluate(({key,value})=>sessionStorage.setItem(key,value),{key:otherStorage,value:otherRequest});
 let revokeAck!:()=>void;const revokeLost=new Promise<void>(r=>revokeAck=r);
 await page.route('**/api/booking-access/revoke',async route=>{const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');revokeAck();});
 await page.getByRole('button',{name:'この端末の予約閲覧権を失効'}).click();await revokeLost;await expect(page.getByRole('status')).toContainText('未確認');
 assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),requestStorage),firstRequest,'unacknowledged revocation retains the old issuance key');
 await page.unroute('**/api/booking-access/revoke');await page.reload();await page.getByRole('button',{name:'この端末の予約閲覧権を失効'}).click();await expect(page.getByRole('status')).toContainText('失効しました');
 assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),requestStorage),null,'acknowledged revocation clears only that booking request');
 assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),otherStorage),otherRequest);
 await page.goto('/ja/book');await expect(page.getByRole('button',{name:'予約閲覧をこの端末へ保存'})).toBeVisible();
 const resaved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/booking-access/issue');await page.getByRole('button',{name:'予約閲覧をこの端末へ保存'}).click();assert.equal((await resaved).status(),200);
 await page.getByRole('link',{name:'保存した予約とQRを開く'}).click();await expect(page.getByRole('img',{name:'保存済み予約QR'})).toBeVisible();
 assert.notEqual(await page.evaluate(key=>sessionStorage.getItem(key),requestStorage),firstRequest);
 const caps=(await app.db.pool.query('SELECT revoked_at FROM booking_access.capabilities')).rows;assert.equal(caps.length,2);assert.equal(caps.filter(r=>r.revoked_at===null).length,1);
 console.log('PASS lost revoke response preserves key; acknowledged replay then explicit same-tab resave uses one new capability without reviving the old one');
 stage='CH-05 regression: pagehide->focus->pagehide does not leave reload permanently disabled';
 // TEST-OBS-02: reuse the same readGate mechanism as BA-01-RES above so this actually
 // observes the focus handler's reload() disabling the button (reading=true) before the
 // second pagehide interrupts it, instead of only checking button state before and after
 // all three events -- a fast in-memory response could otherwise make the whole race
 // invisible. The second pagehide interrupts the reload() the focus handler started before
 // it resolves; before the CH-05 fix, blur() itself set reading=true with no request behind
 // it, so that reload()'s ticket-gated finally could never clear it and the button stayed
 // disabled forever.
 assert.equal(await page.getByRole('button',{name:'予約を再読込',exact:true}).isDisabled(),false);
 let ch05Entered!:()=>void,ch05Release!:()=>void;
 const ch05Observed=new Promise<void>(r=>ch05Entered=r),ch05Blocked=new Promise<void>(r=>ch05Release=r);
 readGate={entered:ch05Entered,blocked:ch05Blocked};
 try{
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await ch05Observed;
  await expect(page.getByRole('button',{name:'予約を再読込',exact:true})).toBeDisabled();
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await expect(page.getByRole('button',{name:'予約を再読込',exact:true})).toBeEnabled();
 }finally{readGate=null;ch05Release();}
 console.log('PASS pagehide->focus is observed mid-flight as reading-in-progress/disabled via the gated GET; the second pagehide leaves reload enabled instead of permanently disabled; not a real BFCache or device backgrounding test');
 stage='guest expiration and separate booking read';await clock('2035-01-02T11:00:00+09:00');assert.equal((await context.request.get('/api/guest/draft')).status(),401);await page.reload();await expect(page.getByRole('img',{name:'保存済み予約QR'})).toBeVisible();const response=await context.request.get('/api/booking-access');assert.equal(response.status(),200);assert.match(response.headers()['cache-control']!,/no-store/);const data=await response.json();assert.equal(data.readOnly,true);assert.equal(data.chargeReady,false);assert.equal('contact' in data,false);assert.equal('members' in data,false);assert.equal(JSON.stringify(data).includes(cookie.value),false);
 const stranger=await browser.newContext({baseURL:app.origin});assert.equal((await stranger.request.get('/api/booking-access')).status(),401);await stranger.close();
 console.log('PASS expired input context cannot mutate; separate booking cookie reads minimal confirmation/QR through original due; another browser denied');
 stage='width and revocation';for(const width of [320,390,430,768]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}await page.setViewportSize({width:390,height:844});await mkdir('.local/screenshots',{recursive:true});await page.screenshot({path:'.local/screenshots/p4-confirmed-booking.png',fullPage:true});await page.getByRole('button',{name:'この端末の予約閲覧権を失効'}).click();await expect(page.getByRole('status')).toContainText('失効しました');assert.equal((await context.request.get('/api/booking-access')).status(),401);await page.reload();await expect(page.getByRole('img',{name:'保存済み予約QR'})).toHaveCount(0);
 console.log('PASS explicit revocation clears cached booking/QR; width emulation only, not a real smartphone');
}catch(e){failed=true;console.error('P4_BOOKING_ACCESS_UI_FAILED '+stage+' '+(e as Error).name);console.error((e as Error).stack?.split('\n').filter(s=>s.includes('/tests/readiness/')).join('\n'));}finally{await browser.close();await app?.stop();console.log('Owned P4 booking browser/Web/PostgreSQL stopped.');}if(failed)process.exit(1);
