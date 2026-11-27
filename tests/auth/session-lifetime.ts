// Staff/admin login lifetime contract: an ABSOLUTE 8 hours (28,800 s) from login, fixed (no sliding refresh), enforced by the server, and never cut short by a
// transient network/5xx/429 blip on the browser side. Real PostgreSQL + built app + Chromium, synthetic accounts only. Elapsed time is simulated by moving the
// session row (controlled fixture); real 8 h elapsed time is NOT measured here and is reported as such.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {assertPortFree,worktreeIdentity} from '../../scripts/worktree';
import {startDevelopmentApp} from '../../scripts/development-app';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {seedLedgerSample} from '../fixtures/seed-ledger';

const SECONDS=8*60*60;
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined;let stage='startup',count=0,failed=false;
const browser=await chromium.launch();
const password=randomBytes(24).toString('base64url');const email='synthetic-lifetime@example.invalid';
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log(`PASS ${name}`);}
try{
 app=await startDevelopmentApp({built:true});const {origin}=app;const owner=app.db.pool;
 for(let i=0;i<100;i++){try{if((await fetch(`${origin}/api/health`)).ok)break;}catch{}if(i===99)throw new Error('APP_START_TIMEOUT');await new Promise(r=>setTimeout(r,100));}
 await seedLedgerSample(owner);
 const adminId=await bootstrapDevelopmentAdmin(owner,{email,displayName:'合成ADMIN',password});
 const ctx=await browser.newContext({baseURL:origin,viewport:{width:1280,height:900}});ctx.setDefaultTimeout(15000);
 const signIn=await ctx.request.post('/api/auth/sign-in/email',{headers:{origin},data:{email,password}});assert.equal(signIn.status(),200);
 const row=async()=>(await owner.query('SELECT id,"createdAt","expiresAt",extract(epoch from ("expiresAt"-"createdAt")) AS ttl FROM auth_session WHERE "userId"=$1',[adminId])).rows[0];
 let active=ctx;const status=async()=>(await active.request.get('/api/session')).status();
 const shiftTo=async(elapsedSeconds:number)=>{await owner.query('UPDATE auth_session SET "createdAt"=clock_timestamp()-make_interval(secs=>$2),"expiresAt"=clock_timestamp()-make_interval(secs=>$2)+make_interval(secs=>$3) WHERE "userId"=$1',[adminId,elapsedSeconds,SECONDS]);};

 await check('login creates ONE session of exactly 28,800 s with a persistent HttpOnly SameSite=Lax cookie that expires with the session (not a browser-session cookie)',async()=>{
  const r=await row();assert.ok(Math.abs(Number(r.ttl)-SECONDS)<1,'DB lifetime is 8 h (28,800 s, within the millisecond the two timestamps are taken apart) from login');
  const setCookie=signIn.headersArray().filter(h=>h.name.toLowerCase()==='set-cookie').map(h=>h.value).find(v=>/session_token=/.test(v))!;
  assert.match(setCookie,/Max-Age=28800\b/i,'Max-Age is 28800');assert.match(setCookie,/HttpOnly/i);assert.match(setCookie,/SameSite=Lax/i);assert.match(setCookie,/Path=\//i);
  const c=(await ctx.cookies(origin)).find(x=>x.name.endsWith('session_token'))!;assert.ok(c.expires>0,'persistent, not a session cookie');
  const remaining=c.expires-Date.now()/1000;assert.ok(remaining>SECONDS-120&&remaining<=SECONDS+5,'cookie expiry is login + 8 h');
 });
 await check('the 8 hours are FIXED from login: activity, reloads and page changes never extend or shorten expiresAt (no sliding refresh)',async()=>{
  const before=await row();
  for(let i=0;i<4;i++)assert.equal(await status(),200);
  const page=await ctx.newPage();await page.goto('/staff/ledger');await expect(page.getByRole('heading',{name:'道具の台帳'})).toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:'道具の台帳'})).toBeVisible();
  const after=await row();assert.equal(after.expiresAt.getTime(),before.expiresAt.getTime());assert.equal(after.createdAt.getTime(),before.createdAt.getTime());assert.equal(after.id,before.id);
  await page.close();
 });
 await check('server enforcement with a controlled clock: valid at 1 h, 4 h and 7 h 59 m; refused after 8 h (API and page); other cookie attributes unchanged',async()=>{
  for(const mins of [0,60,240,479]){await shiftTo(mins*60);assert.equal(await status(),200,`valid at ${mins} min`);}
  await shiftTo(SECONDS+30);assert.equal(await status(),401,'refused after 8 h');
  assert.equal((await ctx.request.get('/api/ledger/assets')).status(),401);
  const page=await ctx.newPage();await page.goto('/staff/ledger');await expect(page.getByRole('heading',{name:'認証が必要です'})).toBeVisible();await expect(page.getByRole('heading',{name:'道具の台帳'})).toHaveCount(0);await page.close();
 });

 // fresh session for the browser-side checks
 await owner.query('DELETE FROM auth_session WHERE "userId"=$1',[adminId]);
 const ctx2=await browser.newContext({baseURL:origin,viewport:{width:1280,height:900}});ctx2.setDefaultTimeout(15000);
 assert.equal((await ctx2.request.post('/api/auth/sign-in/email',{headers:{origin},data:{email,password}})).status(),200);
 active=ctx2;const page=await ctx2.newPage();await page.goto('/staff/ledger');
 const heading=page.getByRole('heading',{name:'道具の台帳'});await expect(heading).toBeVisible();
 await page.evaluate(()=>{(document.querySelector('main') as HTMLElement).dataset.keep='same-node';});
 const recheck=()=>page.evaluate(()=>window.dispatchEvent(new Event('zao-auth-recheck')));
 const reconnecting=page.getByText('接続を確認しています');

 for(const [name,fail] of [['503',(r:import('@playwright/test').Route)=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"UNAVAILABLE"}'})],['429',(r:import('@playwright/test').Route)=>r.fulfill({status:429,contentType:'application/json',body:'{}'})],['500 non-JSON',(r:import('@playwright/test').Route)=>r.fulfill({status:500,contentType:'text/html',body:'<html>err</html>'})],['network drop',(r:import('@playwright/test').Route)=>r.abort('connectionreset')]] as const){
  await check(`a transient ${name} on the session check hides the screen but keeps the login; the SAME screen returns when the server answers again`,async()=>{
   await page.route('**/api/session',fail);await recheck();
   await expect(reconnecting).toBeVisible();await expect(heading).toBeHidden();
   assert.equal(await page.getByText('セッションを確認してください').count(),0,'never the terminal "ended" screen');
   assert.equal(await status(),200,'the session itself is still valid at the server');
   await page.unroute('**/api/session');
   await expect(heading).toBeVisible({timeout:12000});await expect(reconnecting).toBeHidden();
   assert.equal(await page.evaluate(()=>(document.querySelector('main') as HTMLElement|null)?.dataset.keep),'same-node','children stayed mounted: nothing typed or in flight was lost');
  });
 }
 await check('a long outage (several retry rounds) still ends nothing; recovery works after it',async()=>{
  await page.route('**/api/session',r=>r.abort('internetdisconnected'));await recheck();await expect(reconnecting).toBeVisible();await page.waitForTimeout(8000);
  await expect(reconnecting).toBeVisible();assert.equal(await page.getByText('セッションを確認してください').count(),0);
  await page.unroute('**/api/session');await expect(heading).toBeVisible({timeout:20000});
 });
 await check('a REAL invalid session (expired on the server) ends the screen and no staff data stays visible (account switch and permission change are covered by the checks below)',async()=>{
  await shiftTo(SECONDS+60);await recheck();
  await expect(page.getByText('セッションを確認してください')).toBeVisible();await expect(heading).toBeHidden();
  assert.equal(await page.getByText('SYNTH').count(),0,'no stale staff data');
 });

 // ---- account switch / permission change / multi-tab races (real browser, real PostgreSQL)
 const emailB='synthetic-lifetime-b@example.invalid';
 const insertB=async()=>{const {insertAccount}=await import('../../packages/auth/src/accounts');const c=await owner.connect();try{await c.query('BEGIN');const id=await insertAccount(c,{email:emailB,displayName:'合成ADMIN-B',password,active:true,role:'ADMIN',scope:'ALL',storeIds:[],permissions:{}},null);await c.query('COMMIT');return id as string;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 const idB=await insertB();
 const ctx3=await browser.newContext({baseURL:origin,viewport:{width:1280,height:900}});ctx3.setDefaultTimeout(15000);
 assert.equal((await ctx3.request.post('/api/auth/sign-in/email',{headers:{origin},data:{email,password}})).status(),200);
 const a1=await ctx3.newPage();await a1.goto('/staff/ledger');await expect(a1.getByRole('heading',{name:'道具の台帳'})).toBeVisible();
 const recheckOn=(pg:import('@playwright/test').Page)=>pg.evaluate(()=>window.dispatchEvent(new Event('zao-auth-recheck')));
 const endedText=(pg:import('@playwright/test').Page)=>pg.getByText('セッションを確認してください');
 await check('a typed value survives a transient outage on the real screen (the same field, the same text)',async()=>{
  const field=a1.locator('main input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file])').first();
  const real=await field.count()>0;
  if(real){await field.fill('KEEP-ME-123');}else{await a1.evaluate(()=>{const i=document.createElement('input');i.id='keep';i.value='KEEP-ME-123';document.querySelector('main')!.appendChild(i);});}
  await a1.route('**/api/session',r=>r.abort('connectionreset'));await recheckOn(a1);await expect(a1.getByText('接続を確認しています')).toBeVisible();
  await a1.unroute('**/api/session');await expect(a1.getByRole('heading',{name:'道具の台帳'})).toBeVisible({timeout:12000});
  assert.equal(await (real?a1.locator('main input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file])').first():a1.locator('#keep')).inputValue(),'KEEP-ME-123');
 });
 await check('signing in as ANOTHER account in a second tab ends the first tab\'s screen (no stale data of A); reloading shows B',async()=>{
  const tab2=await ctx3.newPage();
  assert.equal((await ctx3.request.post('/api/auth/sign-in/email',{headers:{origin},data:{email:emailB,password}})).status(),200,'cookie now belongs to B');
  await tab2.goto('/staff/ledger');await expect(tab2.getByRole('heading',{name:'道具の台帳'})).toBeVisible();
  await recheckOn(a1);await expect(endedText(a1)).toBeVisible();await expect(a1.getByRole('heading',{name:'道具の台帳'})).toBeHidden();
  await a1.reload();await expect(a1.getByRole('heading',{name:'道具の台帳'})).toBeVisible();
  assert.equal(await (async()=>(await ctx3.request.get('/api/session')).status())(),200);await tab2.close();
 });
 await check('a permission/revision change ends the open screen and a reload re-authorises it',async()=>{
  await owner.query('UPDATE staff_members SET revision=revision+1 WHERE id=$1',[idB]);
  await recheckOn(a1);await expect(endedText(a1)).toBeVisible();await expect(a1.getByRole('heading',{name:'道具の台帳'})).toBeHidden();
  await a1.reload();await expect(a1.getByRole('heading',{name:'道具の台帳'})).toBeVisible();
 });
 await check('a STALE answer that arrives late (old probe held, state changed meanwhile) never revives or closes the screen wrongly',async()=>{
  let held=0;await a1.route('**/api/session',async route=>{if(held++===0){const real=await route.fetch();await new Promise(r=>setTimeout(r,3000));await route.fulfill({response:real});}else await route.continue();});
  await recheckOn(a1);                                   // probe 1: answered correctly for the current stamp, but delivered 3 s late
  await owner.query('UPDATE staff_members SET revision=revision+1 WHERE id=$1',[idB]);   // the permission stamp changes while probe 1 is in flight
  await recheckOn(a1);                                   // probe 2 sees the new stamp
  await expect(endedText(a1)).toBeVisible();
  await a1.waitForTimeout(3800);                         // the late MATCH for the OLD stamp has now arrived: it must not bring the screen back
  await expect(endedText(a1)).toBeVisible();await expect(a1.getByRole('heading',{name:'道具の台帳'})).toBeHidden();await a1.unroute('**/api/session');
 });
 await ctx3.close();
 await ctx.close();await ctx2.close();
 console.log(`PASS ${count} session lifetime checks (28,800 s fixed lifetime, cookie attributes from the real response, controlled-clock server refusal, transient recovery). Elapsed real time: NOT measured (controlled fixture only).`);
}catch(error){console.error(`SESSION_LIFETIME_FAILED stage=${stage}; ${error instanceof assert.AssertionError?error.message:error instanceof Error?error.message:'unknown'}`);failed=true;}
finally{await browser.close();if(app)await app.stop();const ports=worktreeIdentity();await assertPortFree(ports.webPort);await assertPortFree(ports.dbPort);console.log('Owned browser/Web/PostgreSQL closed; worktree ports released.');}
if(failed)process.exit(1);
