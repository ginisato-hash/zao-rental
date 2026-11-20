import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {chromium,expect,type BrowserContext,type Page} from '@playwright/test';
import {startFlowApp} from '../flow/launcher';
import {seedRecommendation} from '../recommendation/fixture';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';

// AVATAR-EXIT-01 (TD #7032873764 / #7036005071): leaving the guest booking screen with "この予約画面を閉じる".
// The guest browser runs without the next dev HMR channel (a silent mock socket), as a production build has none, so a
// dev reload cannot stand in for (or hide) the product's own navigation. Synthetic local PostgreSQL and app only.
// Checked: unsaved input present/absent -> logout 200 -> /ja with no leave prompt and exactly one POST; Back after it
// shows no previous draft and the server no longer has that guest context; logout 500 / network error -> stays, shows
// the error, the unsaved input and its leave protection remain, a retry sends one new POST; a delayed answer with
// repeated presses -> one POST, then /ja.
const app=await startFlowApp({publicP0:true,publicP1:true,warmRoutes:true}),browser=await chromium.launch();
let failed=false,stage='start',count=0,external=0;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
async function guest(){
 const ctx=await browser.newContext({baseURL:app.origin,viewport:{width:390,height:844}});ctx.setDefaultTimeout(20000);
 await ctx.routeWebSocket(/\/_next\/webpack-hmr/,()=>{/* silent: no dev reload */});
 await ctx.route('**/*',async r=>{if(new URL(r.request().url()).origin!==app.origin){external++;await r.abort();return;}await r.fallback();});
 const p=await ctx.newPage(),posts:string[]=[],dialogs:string[]=[];
 p.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/guest/logout')posts.push(r.url());});
 // A leave prompt is recorded and dismissed (the person chooses to stay), as Playwright does by default.
 p.on('dialog',d=>{dialogs.push(d.type());void d.dismiss().catch(()=>{});});
 await p.goto('/ja/book');await expect(p.getByLabel('利用開始日',{exact:true})).toBeEnabled();
 await p.getByLabel('利用開始日',{exact:true}).fill('2035-01-05');await p.getByLabel('利用終了日',{exact:true}).fill('2035-01-05');
 await p.getByRole('button',{name:'CONTINUE',exact:true}).click();
 const height=p.getByRole('article',{name:'利用者 1',exact:true}).getByLabel('身長（cm）',{exact:true});await height.waitFor();
 return {ctx,p,posts,dialogs,height,close:p.getByRole('button',{name:'この予約画面を閉じる'})};
}
const draftCount=async()=>Number((await app.db.pool.query('SELECT count(*)::int n FROM guest_drafts')).rows[0].n);
const draftStatus=(ctx:BrowserContext)=>ctx.request.get('/api/guest/draft').then(r=>r.status());
async function leaveIsBlocked(p:Page,dialogs:string[]){const before=dialogs.length;await p.goto('/ja').catch(()=>{/* navigation cancelled by the prompt */});return dialogs.length>before&&new URL(p.url()).pathname==='/ja/book';}
try{
 await seedRecommendation(app.db.pool,true);await app.db.pool.query("CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-01-01T10:00:00+09:00'::timestamptz$$");
 const root=await bootstrapDevelopmentAdmin(app.db.pool,{email:'exit-root@example.invalid',displayName:'SYNTHETIC Exit',password:randomBytes(24).toString('base64url')});
 for(const permission of ['QUOTE_VIEW','QUOTE_CREATE','PRICE_EDIT'])await app.db.pool.query('INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,$2,true)',[root,permission]);
 await new QuoteService(app.roles.pricingPool,(await loadStaff(app.db.pool,root))!).initializePrivate(randomUUID(),'2035-01-01','2035-12-31');

 for(const unsaved of [true,false])await check(`logout 200 with${unsaved?'':'out'} unsaved input: one POST, /ja reached, no leave prompt; Back shows no previous draft and the context is gone`,async()=>{
  const g=await guest();if(unsaved){await g.height.fill('171');await expect(g.p.getByText('入力内容は「候補と参考料金を確認」で保存されます。',{exact:true})).toBeVisible();}
  assert.equal(await draftStatus(g.ctx),200,'baseline: the guest context answers');
  await g.close.click();await g.p.waitForURL(app.origin+'/ja');assert.equal(g.posts.length,1,'exactly one logout POST');assert.deepEqual(g.dialogs,[],'no leave prompt after a successful close');
  assert.equal(await draftStatus(g.ctx)===200,false,'the closed guest context no longer answers');
  await g.p.goBack();await g.p.waitForURL(app.origin+'/ja/book');await expect(g.p.getByLabel('利用開始日',{exact:true})).toBeEnabled();
  assert.notEqual(await g.p.getByLabel('利用開始日',{exact:true}).inputValue(),'2035-01-05','the previous draft is not shown after Back');
  // The unsaved height must not come back: read the field's value wherever the step shows it (a text search cannot see
  // an <input> value, so it could never fail). If the field is not on screen, read every height field in the page.
  const heights=await g.p.getByLabel('身長（cm）',{exact:true}).evaluateAll(els=>els.map(e=>(e as HTMLInputElement).value));
  assert.equal(heights.includes('171'),false,'the unsaved height is not restored after Back: '+JSON.stringify(heights));
  assert.equal(g.posts.length,1,'Back does not send another logout');await g.ctx.close();
 });
 for(const [kind,answer] of [['logout 500',(r:import('@playwright/test').Route)=>r.fulfill({status:500,json:{error:'GUEST_UNAVAILABLE'}})],['network error',(r:import('@playwright/test').Route)=>r.abort('failed')]] as const)
  await check(`${kind}: stays on the booking screen with an error, the unsaved input and its leave protection remain, a retry sends one new POST`,async()=>{
   const g=await guest();await g.height.fill('171');let fail=true;await g.p.route('**/api/guest/logout',r=>fail?answer(r):r.continue());
   await g.close.click();await expect(g.p.locator('.guest-alert[role="alert"]')).toBeVisible();assert.equal(new URL(g.p.url()).pathname,'/ja/book');assert.equal(g.posts.length,1);
   await expect(g.close).toBeEnabled();assert.equal(await g.height.inputValue(),'171','the unsaved input is kept');assert.equal(await draftStatus(g.ctx),200,'still signed in to the same context');
   assert.equal(await leaveIsBlocked(g.p,g.dialogs),true,'leaving with unsaved input still asks first');
   fail=false;await g.close.click();await g.p.waitForURL(app.origin+'/ja');assert.equal(g.posts.length,2,'one new POST for the retry');await g.ctx.close();
  });
 await check('delayed logout answer with repeated presses: one POST, then /ja',async()=>{
  const g=await guest();await g.p.route('**/api/guest/logout',async r=>{await new Promise(f=>setTimeout(f,2500));await r.continue();});
  await g.close.click();for(let i=0;i<3;i++)await g.close.click({timeout:500}).catch(()=>{/* disabled while busy */});
  await g.p.waitForURL(app.origin+'/ja');assert.equal(g.posts.length,1);assert.deepEqual(g.dialogs,[]);await g.ctx.close();
 });
 assert.ok(await draftCount()>=5,'each case used its own real draft');assert.equal(external,0,'no external requests');
 console.log(JSON.stringify({status:'PASS',cases:count,externalRequests:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,message:(e as Error).message?.slice(0,800)}));}
finally{await browser.close();await app.stop();}
if(failed)process.exitCode=1;
