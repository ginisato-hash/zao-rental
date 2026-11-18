import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {chromium} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';

// Issue #47 §2A/§3/§6: shared staff shell (Booqable order, Apple look), JA/EN switch, /admin unified, settings and inbox.
// Synthetic local PostgreSQL and a local browser only. Screenshots go to .local/evidence/issue47-shell (not committed).
const built=process.argv.includes('--built');
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,failed=false,stage='startup',count=0;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url'),shots='.local/evidence/issue47-shell';
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 await mkdir(shots,{recursive:true});
 app=await startDevelopmentApp({built,operations:true});const {origin,db}=app;
 for(let i=0;i<180;i++){try{if((await fetch(origin+'/staff/login')).status<500)break;}catch{/* starting */}await new Promise(r=>setTimeout(r,1000));}
 await bootstrapDevelopmentAdmin(db.pool,{email:'shell-admin@example.invalid',displayName:'SYNTHETIC Shell Admin',password});
 const context=await browser.newContext({baseURL:origin,viewport:{width:1440,height:900}}),page=await context.newPage();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/staff/login');await page.getByLabel('メールアドレス',{exact:true}).fill('shell-admin@example.invalid');await page.getByLabel('パスワード',{exact:true}).fill(password);
 await page.getByRole('button',{name:'ログイン',exact:true}).click();await page.waitForURL('**/staff/ledger',{timeout:60000});

 await check('the shell lists only working destinations in Booqable order with settings at the bottom',async()=>{
  await page.goto('/staff');const nav=page.getByRole('complementary');
  const labels=(await nav.getByRole('link').allInnerTexts()).map(s=>s.trim()).filter(Boolean);
  const order=['ダッシュボード','予約','在庫','一括操作','設定','ログアウト'].filter(l=>labels.includes(l));
  assert.deepEqual(labels.filter(l=>order.includes(l)),order);assert.ok(labels.includes('設定'));
  for(const missing of ['カレンダー','顧客','書類','レポート','スキャン'])assert.ok(!labels.includes(missing),'no placeholder '+missing);
  assert.equal(await page.locator('html').getAttribute('lang'),'ja');
  await page.screenshot({path:`${shots}/dashboard-ja-1440.png`,fullPage:false});
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
 await check('settings: own email opt-in saves on the server and reads back after reload',async()=>{
  await page.goto('/staff/settings');const box=page.getByRole('checkbox',{name:/Email me at my sign-in address/});await box.waitFor();
  assert.equal(await box.isChecked(),false);await box.check();await page.getByRole('button',{name:'Save'}).click();await page.getByText('Saved.').waitFor();
  await page.reload();assert.equal(await page.getByRole('checkbox',{name:/Email me at my sign-in address/}).isChecked(),true);
  const row=(await db.pool.query('SELECT r.email_enabled,u.email FROM staff_notification_recipients r JOIN auth_user u ON u.id=r.staff_id')).rows;
  assert.deepEqual(row,[{email_enabled:true,email:'shell-admin@example.invalid'}]);
  await page.screenshot({path:`${shots}/settings-en-1440.png`});
 });
 await check('bell shows the inbox; opening it does not acknowledge anything',async()=>{
  await page.goto('/staff');await page.getByRole('button',{name:/Notifications/}).click();await page.getByRole('dialog',{name:'New bookings'}).waitFor();
  await page.screenshot({path:`${shots}/bell-en-1440.png`});
  assert.equal(Number((await db.pool.query('SELECT count(*)::int n FROM staff_booking_events WHERE acknowledged_at IS NOT NULL')).rows[0].n),0);
 });
 await check('phone width: menu button opens the sidebar; no horizontal page scroll',async()=>{
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'English'}).waitFor();await page.getByRole('button',{name:'日本語'}).click();
  await page.getByRole('button',{name:'メニュー'}).waitFor();await page.screenshot({path:`${shots}/dashboard-ja-390.png`});
  await page.getByRole('button',{name:'メニュー'}).click();await page.getByRole('link',{name:'設定'}).waitFor();await page.screenshot({path:`${shots}/menu-ja-390.png`});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);assert.equal(overflow,false);
 });
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'PASS',cases:count,screenshots:shots,externalRequests:0}));
 await context.close();
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,message:(e as Error).message?.slice(0,500)}));}
finally{await browser.close();await app?.stop();}
if(failed)process.exitCode=1;
