import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {chromium,expect,type BrowserContext,type Page} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {writeAccount} from '../../packages/auth/src/accounts';
import {seedRecommendation} from '../recommendation/fixture';
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,failed=false,stage='startup',count=0,external=0;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url');
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 app=await startDevelopmentApp({built:true,operations:true});const {origin,db,roles}=app;await seedRecommendation(db.pool);
 const now=new Date('2035-01-01T10:00:00+09:00');await db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${now.toISOString()}'::timestamptz$$`);
 const root=await bootstrapDevelopmentAdmin(db.pool,{email:'m2a-root@example.invalid',displayName:'SYNTHETIC Admin',password}),admin=(await loadStaff(db.pool,root))!;
 await writeAccount(roles.authPool,admin,undefined,{email:'m2a-operator@example.invalid',password,displayName:'SYNTHETIC Operator',active:true,role:'ADMIN',scope:'ALL',storeIds:[],permissions:{INVENTORY_VIEW:true,INVENTORY_EDIT:true,BOOKING_VIEW:true,OPERATIONS_VIEW:true,OPERATIONS_ACKNOWLEDGE:true,FIELD_ACCEPTANCE:true}});
 await writeAccount(roles.authPool,admin,undefined,{email:'m2a-plain@example.invalid',password,displayName:'SYNTHETIC Plain',active:true,role:'VIEWER',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{INVENTORY_VIEW:true,BOOKING_VIEW:true}});
 for(let i=0;i<150;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}if(i===149)throw Error('LOCAL_START_TIMEOUT');await new Promise(r=>setTimeout(r,100));}
 async function context(){const c=await browser.newContext({baseURL:origin,viewport:{width:1440,height:1000}});c.setDefaultTimeout(15000);await c.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('data:'))return route.continue();external++;return route.abort();});return c;}
 async function login(c:BrowserContext,email:string){const p=await c.newPage();await p.goto('/staff/login');await p.getByLabel('メールアドレス',{exact:true}).fill(email);await p.getByLabel('パスワード',{exact:true}).fill(password);await p.getByRole('button',{name:'ログイン',exact:true}).click();await p.waitForURL('**/staff/ledger');return p;}
 const owner=await context(),plain=await context(),anonymous=await context();
 const page=await login(owner,'m2a-operator@example.invalid'),plainPage=await login(plain,'m2a-plain@example.invalid');

 async function openAsset(p:Page,family:string){
  await p.goto('/staff/ledger');
  await p.getByRole('button',{name:'個体台帳',exact:true}).click().catch(()=>{});
  await p.getByLabel('競技',{exact:true}).selectOption(family==='SNOWBOARD'?'SNOWBOARD':'SKI').catch(()=>{});
  const first=p.locator('table tbody tr').filter({hasText:family}).first();
  await first.getByRole('button',{name:/^詳細：/}).click();
  return p.locator('aside[aria-label="台帳詳細"]');
 }

 await check('a ski label prints two copies of one immutable identifier and no customer data',async()=>{
  const detail=await openAsset(page,'SKI');
  const id=(await detail.locator('.ledger-id').first().innerText()).trim();
  assert.ok(/^[0-9a-f-]{36}$/.test(id),id);
  const labels=detail.locator('.asset-label');
  await expect(labels).toHaveCount(2);
  for(let i=0;i<2;i++)assert.equal((await labels.nth(i).locator('code').innerText()).trim(),id,'copy '+i);
  await expect(detail.locator('canvas[aria-label="用品QR '+id+'"]').first()).toBeVisible();
  const text=await detail.locator('section',{has:page.locator('.asset-label')}).first().innerText();
  for(const leak of ['@','090','電話','住所','様'])assert.ok(!text.includes(leak),leak);
 });

 await check('a board prints one label and poles and wear print none',async()=>{
  const board=await openAsset(page,'SNOWBOARD');
  await expect(board.locator('.asset-label')).toHaveCount(1);
  await page.goto('/staff/ledger');
  await page.getByRole('button',{name:'ポール数量',exact:true}).click();
  await page.locator('table tbody tr').first().getByRole('button',{name:/^詳細：/}).click();
  await expect(page.locator('aside[aria-label="台帳詳細"] .asset-label')).toHaveCount(0);
 });

 await check('labels stay on one A4 sheet and print only the label block',async()=>{
  await openAsset(page,'SKI');
  const width=await page.locator('.asset-label').first().evaluate(el=>el.getBoundingClientRect().width);
  assert.ok(width>0&&width<=280,'label width '+width);
  const breaks=await page.locator('.asset-label').first().evaluate(el=>getComputedStyle(el).breakInside);
  assert.equal(breaks,'avoid');
  await page.emulateMedia({media:'print'});
  assert.equal(await page.locator('.asset-label').first().evaluate(el=>getComputedStyle(el).visibility),'visible');
  assert.equal(await page.locator('footer.ledger-footer').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  await page.emulateMedia({media:'screen'});
 });

 await check('the launch gate is staff-only, read-only and offers no activation control',async()=>{
  const p=await anonymous.newPage();await p.goto('/admin/launch');
  await expect(p.getByRole('heading',{name:'公開準備状況の閲覧権限が必要です'})).toBeVisible();
  await plainPage.goto('/admin/launch');
  await expect(plainPage.getByRole('heading',{name:'公開準備状況の閲覧権限が必要です'})).toBeVisible();
  assert.equal((await plain.request.get('/api/admin/launch')).status(),403);
  assert.equal((await anonymous.request.get('/api/admin/launch')).status(),401);
  await page.goto('/admin/launch');await page.getByRole('button',{name:'読み込む',exact:true}).click();
  await expect(page.getByRole('row',{name:/DBスキーマ/})).toBeVisible();
  await expect(page.getByRole('row',{name:/実在庫データ/})).toContainText('未実施');
  // Nothing on this page can deploy, activate Production, take a payment or accept a secret.
  assert.equal(await page.locator('input[type="password"]').count(),0);
  assert.equal(await page.locator('form').count(),0);
  for(const forbidden of ['本番接続','デプロイ','有効化','決済実行','秘密'])await expect(page.getByRole('button',{name:new RegExp(forbidden)})).toHaveCount(0);
  assert.equal((await page.getByRole('button').allInnerTexts()).filter(t=>t.trim()&&t.trim()!=='読み込む'&&!t.includes('ログアウト')).length,0);
 });

 await check('the launch gate is operable at 390, 768 and 1440 with no external request',async()=>{
  for(const width of [390,768,1440]){
   await page.setViewportSize({width,height:900});await page.goto('/admin/launch');
   await page.getByRole('button',{name:'読み込む',exact:true}).click();
   await expect(page.getByRole('heading',{name:'公開準備状況'})).toBeVisible();
   await expect(page.getByRole('row',{name:/DBスキーマ/})).toBeVisible();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'width '+width);
  }
  assert.equal(external,0);
 });

 console.log(JSON.stringify({status:'PASS',cases:count,externalRequests:external,productionActivations:0,secretInputs:0,customerPii:0,normalApp:'apps/web'}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'UI_ASSERTION',detail:stage==='startup'?'STARTUP_DETAILS_WITHHELD':(e as Error).message.split('Call log:')[0]!.slice(0,900)}));}
finally{await browser.close();await app?.stop();}
if(failed)process.exit(1);
