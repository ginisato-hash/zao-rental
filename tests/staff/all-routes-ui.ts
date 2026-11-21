import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {seedRecommendation} from '../recommendation/fixture';

// Issue #47 #7015233231 §3 P2: every staff/admin route, in Japanese and English, at desktop and phone width. For each:
// no server error or page error, html lang matches, an English page carries no Japanese text, no horizontal scroll at 390px,
// at most one sign-out control and none of the removed legacy navigation. Detail routes are opened with ids that do not
// exist so their not-found states are covered too; the data-filled states are covered by shell-ui/acceptance-ui.
// Synthetic local app only; one screenshot per route/locale/width.
const built=process.argv.includes('--built');
const ROUTES=['/staff','/staff/orders','/staff/orders/new','/staff/orders/'+randomUUID(),'/staff/calendar','/staff/customers','/staff/customers/'+randomUUID(),
 '/staff/inventory','/staff/inventory/'+randomUUID()+'?store=MOUNTAIN_BASE','/staff/scan','/staff/reports','/staff/documents','/staff/notifications','/staff/settings',
 '/staff/today','/staff/rentals','/staff/amendments','/staff/holds','/staff/quotes','/staff/recommendations','/staff/transfers','/staff/ledger','/staff/wear',
 '/staff/content','/staff/users','/staff/password','/admin','/admin/assets','/admin/inventory','/admin/launch','/admin/notifications','/admin/ops','/admin/prices'];
// Japanese that is data rather than interface copy, kept explicit (not a regex hole).
// The synthetic seed catalog names its models '合成 …' (data, like a real model name), not interface copy.
const ALLOWED_JA:string[]=['合成'];
const JAPANESE=/[぀-ヿ㐀-鿿ｦ-ﾟ]/;
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,failed=false,stage='startup';const problems:string[]=[];let visited=0;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url'),shots='.local/evidence/issue47-all-routes';
try{
 await mkdir(shots,{recursive:true});
 app=await startDevelopmentApp({built,operations:true});const {origin,db}=app;
 for(let i=0;i<180;i++){try{if((await fetch(origin+'/staff/login')).status<500)break;}catch{/* starting */}await new Promise(r=>setTimeout(r,1000));}
 await bootstrapDevelopmentAdmin(db.pool,{email:'routes-root@example.invalid',displayName:'SYNTHETIC Routes Root',password});
 await seedRecommendation(db.pool);
 const context=await browser.newContext({baseURL:origin,viewport:{width:1440,height:900}}),page=await context.newPage();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const external:string[]=[];page.on('request',r=>{const u=new URL(r.url());if(u.protocol!=='data:'&&u.protocol!=='blob:'&&u.origin!==origin)external.push(u.origin+u.pathname);});
 stage='login';await page.goto('/staff/login');await page.getByLabel('メールアドレス',{exact:true}).fill('routes-root@example.invalid');await page.getByLabel('パスワード',{exact:true}).fill(password);
 await page.getByRole('button',{name:'ログイン',exact:true}).click();await page.waitForURL(u=>!u.pathname.startsWith('/staff/login'),{timeout:60000});
 for(const locale of ['ja','en'] as const){
  await context.addCookies([{name:'zao_staff_locale',value:locale,url:origin}]);
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:width===390?844:900});
   for(const route of ROUTES){
    stage=`${locale} ${width} ${route}`;const before=errors.length;
    // Staff pages poll (session check, inbox bell), so the network never goes idle: wait for load, then let the first reads settle.
    const r=await page.goto(route,{waitUntil:'load',timeout:60000});const status=r?.status()??0;
    if(status>=500)problems.push(`${stage}: HTTP ${status}`);
    await page.waitForFunction(()=>!document.querySelector('[role="status"]')||!/^(…|セッションを確認中…|Checking your session…)$/.test(document.querySelector('[role="status"]')!.textContent?.trim()??''),undefined,{timeout:15000}).catch(()=>{});await page.waitForTimeout(700);
    const lang=await page.evaluate(()=>document.documentElement.lang);if(lang!==locale)problems.push(`${stage}: html lang=${lang}`);
    if(locale==='en'){
     const text=await page.evaluate(()=>document.body.innerText);
     const lines=text.split('\n').map(l=>l.trim()).filter(l=>l&&JAPANESE.test(l)&&!ALLOWED_JA.some(a=>l.includes(a))&&!/^(日本語|English)$/.test(l));
     if(lines.length)problems.push(`${stage}: Japanese in English: ${JSON.stringify(lines.slice(0,4))}`);
    }
    if(width===390&&await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1))problems.push(`${stage}: horizontal scroll`);
    const signOuts=await page.getByRole('link',{name:/^(サインアウト|ログアウト|Sign out|Log out)$/}).count()+await page.getByRole('button',{name:/^(サインアウト|ログアウト|Sign out|Log out)$/}).count();
    if(signOuts>1)problems.push(`${stage}: ${signOuts} sign-out controls`);
    if(await page.getByText(/その他の管理機能|STAFF PREVIEW/).count())problems.push(`${stage}: legacy navigation`);
    if(errors.length>before)problems.push(`${stage}: page error ${errors.slice(before).join(' | ').slice(0,200)}`);
    await page.screenshot({path:`${shots}/${locale}-${width}${route.replace(/[/?=&]+/g,'_')}.png`});visited++;
   }
  }
 }
 stage='report';if(external.length)problems.push('external requests: '+JSON.stringify([...new Set(external)].slice(0,8)));
 assert.deepEqual(problems,[],problems.join('\n'));
 console.log(JSON.stringify({status:'PASS',routes:ROUTES.length,visited,locales:2,widths:2,screenshots:shots,externalRequests:0}));
 await context.close();
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,visited,problems:problems.length}));console.error(problems.join('\n')||(e as Error).message?.slice(0,800));}
finally{await browser.close();await app?.stop();}
if(failed)process.exitCode=1;
