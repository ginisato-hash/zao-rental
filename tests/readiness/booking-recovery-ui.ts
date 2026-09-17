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
 app=await startFlowApp({publicP0:true,publicP1:true,publicP4:true,publicP5:true});await seedRecommendation(app.db.pool);
 const clock=async(t:string)=>{assert.match(t,/^[0-9:T+-]+$/);await app!.db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${t}'::timestamptz$$`);};await clock('2035-01-01T10:00:00+09:00');
 const root=await bootstrapDevelopmentAdmin(app.db.pool,{email:'p4-root@example.invalid',displayName:'SYNTHETIC P4',password:randomBytes(24).toString('base64url')});for(const permission of ['QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT'])await app.db.pool.query('INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,$2,true)',[root,permission]);await new QuoteService(app.roles.pricingPool,(await loadStaff(app.db.pool,root))!).initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
 const context=await browser.newContext({baseURL:app.origin,viewport:{width:390,height:844},hasTouch:true});context.setDefaultTimeout(15000);const page=await context.newPage();
 stage='ordinary guest UI confirmation';await page.goto('/ja/book');await expect(page.getByLabel('利用開始日',{exact:true})).toBeEnabled();await page.getByLabel('利用開始日',{exact:true}).fill('2035-01-05');await page.getByLabel('利用終了日',{exact:true}).fill('2035-01-05');await page.getByRole('button',{name:'用品を選ぶ',exact:true}).click();await page.getByLabel('ポールのサイズ 1',{exact:true}).selectOption('pole-'+variants.pole);await page.getByRole('button',{name:'候補と参考料金を確認',exact:true}).click();await page.getByRole('radio',{name:/おすすめ/}).check();await page.getByRole('checkbox',{name:'全員のサイズ・モデル条件・ウェア構成を確認した'}).check();await page.getByRole('button',{name:'全員分の最終確認へ'}).click();await page.getByRole('checkbox',{name:'合成データによる開発確認であることを確認'}).check();await page.getByRole('button',{name:'在庫をHOLDして開発用決済を照合'}).click();await expect(page.getByRole('heading',{name:'CONFIRMED_DEV',exact:true})).toBeVisible();
 console.log('PASS normal guest UI -> protected API -> synthetic payment -> confirmed real PostgreSQL booking');
 stage='in-memory delivery enrollment';
 const bookingId=(await app.db.pool.query('SELECT id FROM rental_bookings')).rows[0].id as string;
 const before=(await app.db.pool.query('SELECT b.conditions,b.price_snapshot,b.price_sha256,h.expires_at,h.due_at FROM rental_bookings b JOIN inventory_holds h ON h.id=b.hold_id WHERE b.id=$1',[bookingId])).rows[0];
 // No real delivery is connected to the usual route. Capture is an explicit test service
 // boundary, while the fresh-browser exchange below uses the real Next/API/PG route.
 const guest=(await context.cookies()).find(c=>c.name==='zao_guest')!;
 assert.equal((await context.request.post('/api/booking-access/recovery/prepare',{headers:{origin:app.origin},data:{bookingId,requestId:randomUUID()}})).status(),200);
 await app.recoveryFixture!.enroll(guest.value,bookingId,randomUUID());const code=app.recoveryFixture!.code();await context.close();
 await clock('2035-01-03T10:00:00+09:00');
 const fresh=await browser.newContext({baseURL:app.origin,viewport:{width:390,height:844},hasTouch:true});fresh.setDefaultTimeout(15000);let recovered=await fresh.newPage();
 stage='fresh browser exchange response loss';await recovered.goto('/ja/reservation');await expect(recovered.getByRole('img',{name:'保存済み予約QR'})).toHaveCount(0);
 let observed!:()=>void;const lost=new Promise<void>(resolve=>observed=resolve);
 await recovered.route('**/api/booking-access/recovery/exchange',async route=>{const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');observed();});
 await recovered.getByLabel('予約復旧コード',{exact:true}).fill(code);await recovered.getByRole('button',{name:'復旧コードで予約を開く',exact:true}).click();await lost;
 await expect(recovered.getByRole('region',{name:'予約閲覧の復旧'}).getByRole('status')).toContainText('未確認');
 await recovered.unroute('**/api/booking-access/recovery/exchange');await fresh.clearCookies({name:'zao_booking_access'});await recovered.reload();await recovered.getByLabel('予約復旧コード',{exact:true}).fill(code);
 await recovered.getByRole('button',{name:'復旧コードで予約を開く',exact:true}).click();await expect(recovered.getByRole('img',{name:'保存済み予約QR'})).toBeVisible();
 assert.equal((await app.db.pool.query('SELECT count(*)::int n FROM booking_access.capabilities')).rows[0].n,1);assert.equal((await app.db.pool.query('SELECT count(*)::int n FROM rental_bookings')).rows[0].n,1);
 const cookie=(await fresh.cookies()).find(c=>c.name==='zao_booking_access')!;assert.ok(cookie.httpOnly);assert.equal(cookie.sameSite,'Strict');assert.equal(recovered.url(),app.origin+'/ja/reservation');
 for(const secret of [code,cookie.value]){assert.equal((await recovered.content()).includes(secret),false);assert.equal(await recovered.evaluate(v=>JSON.stringify({...localStorage,...sessionStorage}).includes(v),secret),false);}
 console.log('PASS fresh browser/no guest -> UI code POST -> normal Next API -> real PostgreSQL -> readonly QR; response-loss reload same-key exchange');
 stage='Web restart retains recovered booking';await recovered.close();const restarted=await app.restartWeb();assert.notEqual(restarted.oldPid,restarted.newPid);let ready=false;for(let i=0;i<100;i++){try{if((await fetch(app.origin+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'restarted Web reaches liveness before browser navigation');recovered=await fresh.newPage();await recovered.goto('/ja/reservation');await expect(recovered.getByRole('img',{name:'保存済み予約QR'})).toBeVisible();
 assert.deepEqual((await app.db.pool.query('SELECT b.conditions,b.price_snapshot,b.price_sha256,h.expires_at,h.due_at FROM rental_bookings b JOIN inventory_holds h ON h.id=b.hold_id WHERE b.id=$1',[bookingId])).rows[0],before);
 const stranger=await browser.newContext({baseURL:app.origin});assert.equal((await stranger.request.post('/api/booking-access/recovery/exchange',{headers:{origin:app.origin},data:{code,requestId:randomUUID()}})).status(),401);await stranger.close();
 console.log('PASS process restart preserves one-time binding; another exchange key refused; original price/due/HOLD expiry unchanged');
 stage='proof revoke hides existing QR';await recovered.getByLabel('予約復旧コード',{exact:true}).fill(code);await recovered.getByRole('button',{name:'この復旧コードを失効',exact:true}).click();await expect(recovered.getByRole('region',{name:'予約閲覧の復旧'}).getByRole('status')).toContainText('失効しました');await expect(recovered.getByRole('img',{name:'保存済み予約QR'})).toHaveCount(0);assert.equal((await fresh.request.get('/api/booking-access')).status(),401);
 for(const width of [320,390,430,768]){await recovered.setViewportSize({width,height:844});assert.ok(await recovered.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await mkdir('.local/screenshots',{recursive:true});await recovered.screenshot({path:'.local/screenshots/p5-recovery-after-revoke.png',fullPage:true});await fresh.close();
 console.log('P5 recovery UI:3 groups passed; ordinary Next exchange/real PG, in-memory delivery setup, width emulation only; external email0.');
}catch(e){failed=true;console.error('P5_RECOVERY_UI_FAILED '+stage+' '+(e as Error).name);const message=(e as Error).message;console.error(JSON.stringify({navigationError:/net::ERR_[A-Z_]+/.exec(message)?.[0]??null,interruptedNavigation:message.includes('interrupted by another navigation'),timeout:message.includes('Timeout')}));console.error((e as Error).stack?.split('\n').filter(s=>s.includes('/tests/readiness/')).join('\n'));}finally{await browser.close();await app?.stop();console.log('Owned P5 recovery browser/Web/PostgreSQL stopped.');}if(failed)process.exit(1);
