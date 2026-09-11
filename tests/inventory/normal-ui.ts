import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {chromium,expect,type BrowserContext} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {seedInventory,skiSet,requestFor,variants} from './fixture';
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined;let stage='startup',count=0;let failed=false;const browser=await chromium.launch();
const password=randomBytes(24).toString('base64url');
async function check(name:string,f:()=>Promise<void>){stage=name;await f();count++;console.log('PASS '+name);}
try{
 app=await startDevelopmentApp({built:true});const {origin}=app;await seedInventory(app.db.pool);await bootstrapDevelopmentAdmin(app.db.pool,{email:'synthetic-e06-admin@example.invalid',displayName:'合成ADMIN',password});
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}if(i===99)throw new Error('APP_START_TIMEOUT');await new Promise(r=>setTimeout(r,100));}
 async function context(){const c=await browser.newContext({baseURL:origin,viewport:{width:1280,height:960}});c.setDefaultTimeout(10000);return c;}
 async function login(c:BrowserContext,email:string){const page=await c.newPage();await page.goto('/staff/login');await page.getByLabel('メールアドレス',{exact:true}).fill(email);await page.getByLabel('パスワード',{exact:true}).fill(password);await page.getByRole('button',{name:'ログイン',exact:true}).click();await page.waitForURL(origin+'/staff/ledger');return page;}
 const admin=await context(),editor=await context(),anonymous=await context();const ap=await login(admin,'synthetic-e06-admin@example.invalid');
 const settings={displayName:'合成HOLDスタッフ',active:true,role:'STAFF',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{HOLD_VIEW:true,HOLD_EDIT:true}};
 let actor:string;
 await check('ADMIN explicitly grants HOLD permissions; ordinary role defaults and anonymous requests fail closed',async()=>{
  assert.equal((await anonymous.request.get('/api/holds')).status(),401);assert.equal((await admin.request.get('/api/holds')).status(),403);
  await ap.goto('/staff/users');await ap.getByRole('button',{name:'スタッフを作成',exact:true}).click();const f=ap.getByRole('form',{name:'スタッフ作成'});await f.getByLabel('表示名',{exact:true}).fill(settings.displayName);await f.getByLabel('メールアドレス',{exact:true}).fill('synthetic-e06-staff@example.invalid');await f.getByLabel('初期パスワード（15〜128文字）').fill(password);await f.getByLabel('MOUNTAIN_BASE',{exact:true}).check();await f.getByLabel('期間在庫・自分のHOLD閲覧',{exact:true}).selectOption('allow');await f.getByLabel('自分のHOLD取得・変更',{exact:true}).selectOption('allow');await f.getByRole('button',{name:'スタッフ設定を保存'}).click();await expect(ap.getByRole('heading',{name:settings.displayName,exact:true})).toBeVisible();actor=(await app!.db.pool.query("SELECT id FROM staff_users WHERE email='synthetic-e06-staff@example.invalid'")).rows[0].id;
 });
 let page=await login(editor,'synthetic-e06-staff@example.invalid');let holdId:string;
 await check('normal password login -> actual HOLD UI -> protected API -> real DB all-component HOLD',async()=>{
  await page.goto('/staff/holds');await expect(page.getByRole('heading',{name:'期間在庫と仮押さえ',exact:true})).toBeVisible();await page.getByLabel('開始日',{exact:true}).fill('2032-01-01');await page.getByLabel('最終日',{exact:true}).fill('2032-01-01');
  await page.getByLabel('1人目 スキー（1ペア）',{exact:true}).selectOption(variants.ski);await page.getByLabel('1人目 スキーブーツ（1足）',{exact:true}).selectOption(variants.boot);await page.getByLabel('1人目 ポール（1ペア）',{exact:true}).selectOption(variants.pole);
  await page.getByRole('button',{name:'在庫を照会',exact:true}).click();await expect(page.getByRole('status')).toContainText('確保できる見込み');await page.getByRole('button',{name:'グループを仮押さえ',exact:true}).click();await expect(page.getByRole('status')).toContainText('グループ全体の仮押さえを取得');
  holdId=(await app!.db.pool.query('SELECT id FROM inventory_holds WHERE owner_id=$1',[actor])).rows[0].id;assert.equal((await app!.db.pool.query('SELECT count(*)::int AS n FROM inventory_claims WHERE hold_id=$1 AND active',[holdId])).rows[0].n,3);assert.equal((await app!.db.pool.query('SELECT actor FROM inventory_history WHERE hold_id=$1',[holdId])).rows[0].actor,actor);
  await mkdir('.local/screenshots',{recursive:true});await page.screenshot({path:'.local/screenshots/e06-hold-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.local/screenshots/e06-hold-mobile-width.png',fullPage:true});
 });
 await check('reload, atomic amendment and cancellation persist in the same real DB with server audit',async()=>{
  stage='reload HOLD list';await page.reload();await page.getByRole('button',{name:new RegExp(holdId.slice(0,8))}).click();await expect(page.getByRole('region',{name:'HOLD詳細'})).toContainText('ACTIVE');await page.getByRole('button',{name:'在庫を照会',exact:true}).click();await expect(page.getByRole('status')).toContainText('確保できる見込み');stage='amend form';await page.getByLabel('開始日',{exact:true}).fill('2032-01-02');await page.getByLabel('最終日',{exact:true}).fill('2032-01-02');await page.getByRole('button',{name:'条件を一括変更',exact:true}).click();await expect(page.getByRole('status')).toContainText('一括変更');
  assert.equal((await app!.db.pool.query('SELECT occupancy_start::text FROM inventory_holds WHERE id=$1',[holdId])).rows[0].occupancy_start,'2032-01-02');stage='cancel HOLD';await page.getByRole('button',{name:'仮押さえを取り消す',exact:true}).click();await expect(page.getByRole('region',{name:'HOLD詳細'})).toContainText('RELEASED');assert.equal((await app!.db.pool.query('SELECT count(*)::int AS n FROM inventory_claims WHERE hold_id=$1 AND active',[holdId])).rows[0].n,0);
  stage='logout then login';await page.getByRole('link',{name:'ログアウト',exact:true}).click();await page.getByRole('button',{name:'ログアウトする',exact:true}).click();await page.waitForURL(origin+'/staff/login');assert.equal((await editor.request.get('/api/holds')).status(),401);await page.close();page=await login(editor,'synthetic-e06-staff@example.invalid');await page.goto('/staff/holds');await expect(page.getByRole('button',{name:new RegExp(holdId.slice(0,8))})).toContainText('RELEASED');
 });
 await check('lost committed create/amend responses survive reload and reconcile once with the original key',async()=>{
  await page.getByRole('button',{name:'新しい要求',exact:true}).click();await page.getByLabel('開始日',{exact:true}).fill('2032-03-01');await page.getByLabel('最終日',{exact:true}).fill('2032-03-01');
  await page.getByLabel('1人目 スキー（1ペア）',{exact:true}).selectOption(variants.ski);await page.getByLabel('1人目 スキーブーツ（1足）',{exact:true}).selectOption(variants.boot);await page.getByLabel('1人目 ポール（1ペア）',{exact:true}).selectOption(variants.pole);
  let recoveredId='',requestKey='';
  for(const op of ['create','amend']){
   const path=op==='create'?'/api/holds':'/api/holds/'+recoveredId+'/amend';
   if(op==='amend'){await page.getByLabel('開始日',{exact:true}).fill('2032-03-02');await page.getByLabel('最終日',{exact:true}).fill('2032-03-02');}
   await page.route(origin+path,async route=>{
    if(route.request().method()!=='POST'){await route.continue();return;}
    const response=await route.fetch();assert.ok(response.ok());const result=await response.json();recoveredId=result.holdId;requestKey=route.request().postDataJSON().requestKey;
    // Real API/PG committed; only the transport response is deliberately lost.
    await route.abort('failed');
   });
   await page.getByRole('button',{name:op==='create'?'グループを仮押さえ':'条件を一括変更',exact:true}).click();await expect(page.getByRole('button',{name:'同じ要求を照合・再送'})).toBeVisible();
   await page.unroute(origin+path);await page.reload();await expect(page.getByRole('button',{name:'同じ要求を照合・再送'})).toBeVisible();await expect(page.getByRole('button',{name:'グループを仮押さえ',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'新しい要求',exact:true})).toBeDisabled();
   await page.getByRole('button',{name:'同じ要求を照合・再送'}).click();await expect(page.getByRole('region',{name:'HOLD詳細'})).toContainText(recoveredId);await expect(page.getByRole('button',{name:'同じ要求を照合・再送'})).toHaveCount(0);
   assert.equal((await app!.db.pool.query('SELECT count(*)::int AS n FROM inventory_requests WHERE owner_id=$1 AND request_key=$2',[actor,requestKey])).rows[0].n,1);
   assert.equal((await app!.db.pool.query("SELECT count(*)::int AS n FROM inventory_holds WHERE owner_id=$1 AND state='ACTIVE'",[actor])).rows[0].n,1);
   assert.equal((await app!.db.pool.query('SELECT count(*)::int AS n FROM inventory_history WHERE hold_id=$1',[recoveredId])).rows[0].n,op==='create'?1:2);
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('zao-rental-hold-pending-v1')),null);
  }
  await page.getByRole('button',{name:'仮押さえを取り消す',exact:true}).click();await expect(page.getByRole('region',{name:'HOLD詳細'})).toContainText('RELEASED');
 });
 await check('unavailable pending storage stops new writes before any network mutation',async()=>{
  await page.getByRole('button',{name:'新しい要求',exact:true}).click();let writes=0;const listener=(r:import('@playwright/test').Request)=>{if(r.method()==='POST'&&r.url().includes('/api/holds'))writes++;};page.on('request',listener);
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('Unavailable','QuotaExceededError');};});await page.getByRole('button',{name:'グループを仮押さえ',exact:true}).click();await expect(page.getByRole('status')).toContainText('変更を停止');assert.equal(writes,0);await expect(page.getByRole('button',{name:'新しい要求',exact:true})).toBeDisabled();page.off('request',listener);await page.reload();
 });
 await check('ordinary API rejects CSRF, forged role/actor/expiry, other store, other owner and revoked permission',async()=>{
  const payload={requestKey:randomUUID(),conditions:skiSet('2032-02-01')};
  for(const headers of [{},{origin:'https://untrusted.invalid'}])assert.equal((await editor.request.post('/api/holds',{headers,data:payload})).status(),403);
  for(const extra of [{role:'ADMIN'},{owner_id:'spoof'},{expiresAt:'2099-01-01'}])assert.equal((await editor.request.post('/api/holds',{headers:{origin},data:{...payload,...extra}})).status(),422);
  const foreign=requestFor('2032-02-01');foreign.pickupStore='ONSEN_BASE';assert.equal((await editor.request.post('/api/holds',{headers:{origin},data:{requestKey:randomUUID(),conditions:foreign}})).status(),403);
  assert.equal((await admin.request.get('/api/holds/'+holdId,{headers:{'x-role':'STAFF','x-user-id':actor}})).status(),403);
  assert.equal((await admin.request.patch('/api/staff-users/'+actor,{headers:{origin},data:{...settings,permissions:{HOLD_VIEW:true,HOLD_EDIT:false}}})).status(),200);
  assert.equal((await editor.request.post('/api/holds',{headers:{origin},data:payload})).status(),403);await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));await expect(page.getByRole('heading',{name:'セッションを確認してください'})).toBeVisible();await expect(page.getByRole('heading',{name:'期間在庫と仮押さえ',exact:true})).toHaveCount(0);
 });
 console.log(`E06 normal UI/API/PostgreSQL: ${count} passed; 0 skipped. Synthetic real password auth; viewport simulation, not physical phone.`);
}catch(e){console.error('E06_UI_FAILED '+stage+' '+(e as Error).name);failed=true;}finally{await browser.close();if(app)await app.stop();console.log('Owned E06 Web, browser and PostgreSQL stopped.');}

if(failed)process.exit(1);
