import {mkdir,writeFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {chromium,type Browser,type BrowserContext,type Page} from '@playwright/test';
import {startDevelopmentApp} from '../development-app';
import {bootstrapDevelopmentAdmin} from '../bootstrap-staff';
import {recordSyntheticBookingProfile} from '../../tests/custody/preparation-fixture';
import {provisionFlowRole} from '../flow-roles';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {writeAccount} from '../../packages/auth/src/accounts';
import {seedRecommendation} from '../../tests/recommendation/fixture';
import {requestFor,variants} from '../../tests/inventory/fixture';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import {FakeGateway,simulation} from '../../tests/flow/fixture';

// Staff-console performance harness. Synthetic local PostgreSQL + local built app + local Chromium only.
// No production access, no real credentials, no customer data. Output is aggregate numbers (paths without query values).
//   node --import tsx scripts/perf/staff-perf.ts --label before --mode full|cold [--built]
// Operation timings are measured from Node (click -> locator visible); they include Playwright round trips (~few ms).
const arg=(k:string,d:string)=>{const i=process.argv.indexOf('--'+k);return i>=0?process.argv[i+1]!:d;};
const label=arg('label','run'),mode=arg('mode','full'),built=!process.argv.includes('--dev'),outDir=arg('out','.local/perf');
const REPS=Number(arg('reps','5')),API_REPS=Number(arg('api-reps','35')),OP_REPS=Number(arg('op-reps','30'));
const log=(m:string)=>console.error(new Date().toISOString().slice(11,19)+' '+m);
const pct=(a:number[],p:number)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return +s[Math.min(s.length-1,Math.ceil(p/100*s.length)-1)]!.toFixed(1);};
const stat=(a:number[])=>({n:a.length,p50:pct(a,50),p95:pct(a,95),max:a.length?+Math.max(...a).toFixed(1):null});
const pathOf=(u:string)=>{try{return new URL(u).pathname;}catch{return u;}};

const password=randomBytes(24).toString('base64url');
const app=await startDevelopmentApp({built,operations:true});
const {origin,db}=app;
const browser=await chromium.launch();
const T=Number(arg('timeout','8000'));
const result:Record<string,unknown>={label,mode,built,reps:REPS,apiReps:API_REPS,opReps:OP_REPS,chromium:browser.version(),date:new Date().toISOString()};
try{
 for(let i=0;i<180;i++){try{if((await fetch(origin+'/staff/login')).status<500)break;}catch{/* starting */}await new Promise(r=>setTimeout(r,1000));}
 log('server up');const root=await bootstrapDevelopmentAdmin(db.pool,{email:'perf-root@example.invalid',displayName:'SYNTHETIC Perf Root',password}),rootPrincipal=(await loadStaff(db.pool,root))!;
 const admin=(await writeAccount(app.roles.authPool,rootPrincipal,undefined,{active:true,role:'ADMIN',password,email:'perf-admin@example.invalid',displayName:'SYNTHETIC Perf Admin',scope:'ALL',storeIds:[],permissions:{HOLD_VIEW:true,HOLD_EDIT:true,QUOTE_VIEW:true,QUOTE_CREATE:true,PRICE_EDIT:true,BOOKING_VIEW:true,BOOKING_CREATE:true,RENTAL_CHECKOUT:true,RENTAL_RETURN:true,OPERATIONS_VIEW:true,OPERATIONS_ACKNOWLEDGE:true,INVENTORY_VIEW:true,INVENTORY_EDIT:true,TRANSFER_VIEW:true,STAFF_MANAGE:true}})).id!;
 await seedRecommendation(db.pool);
 const seed=await db.pool.connect();try{await seed.query('BEGIN');await seed.query("SELECT set_config('zao.actor','synthetic-perf',true),set_config('zao.reason','SYNTHETIC perf fixture',true)");
  await seed.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator)
   SELECT gen_random_uuid(),id,family,'MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE','NOT_APPLICABLE','','SYNTHETIC perf','SYNTHETIC','scripts/perf/staff-perf.ts','perf-'||id FROM ledger_variants WHERE id=ANY($1::uuid[])`,[[variants.ski,variants.skiAlt]]);await seed.query('COMMIT');
 }catch(e){await seed.query('ROLLBACK');throw e;}finally{seed.release();}
 const businessDate='2035-06-16',now=new Date(businessDate+'T10:00:00+09:00');
 await db.pool.query(`CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '${now.toISOString()}'::timestamptz$$`);
 const principal=(await loadStaff(db.pool,admin))!,sessionId=(await db.pool.query('SELECT 1')).rows.length&&'perf';void sessionId;
 // Log in through the real form once to obtain the session cookie; contexts reuse its storageState.
 const loginCtx=await browser.newContext({baseURL:origin}),lp=await loginCtx.newPage();
 await lp.goto('/staff/login');await lp.getByLabel('メールアドレス',{exact:true}).fill('perf-admin@example.invalid');await lp.getByLabel('パスワード',{exact:true}).fill(password);
 await lp.getByRole('button',{name:'ログイン',exact:true}).click();await lp.waitForURL(u=>u.pathname.startsWith('/staff')&&!u.pathname.startsWith('/staff/login'),{timeout:60000});
 const sid=(await db.pool.query('SELECT id FROM auth_session WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',[admin])).rows[0].id as string;
 const holds=new HoldService(app.roles.holdPool,principal,()=>now),quotes=new QuoteService(app.roles.pricingPool,principal,()=>now);
 await quotes.initializePrivate(randomUUID(),'2032-01-01','2038-12-31');const flow=await provisionFlowRole(db.pool,db.identity);
 const fake=new FakeGateway(()=>now),bookings=new BookingService(flow.flowPool,app.roles.authPool,{subject:admin,sessionId:sid},fake,simulation);
 log('seeding bookings');const bookingIds:string[]=[];
 const N=Number(arg('bookings','24'));
 for(let i=0;i<N;i++){
  const d=new Date(Date.UTC(2035,5,16+i)).toISOString().slice(0,10),v=i%2?variants.skiAlt:variants.ski;
  const conditions=requestFor(d,[v]),held=await holds.command('create',randomUUID(),conditions),q=(await quotes.create(randomUUID(),{conditions,holdId:held.holdId,couponCode:null,wantAdvance:false})).quote;
  const booking=await bookings.create(randomUUID(),q.id,{displayName:'SYNTHETIC Perf Guest '+String(i).padStart(2,'0'),email:`synthetic-perf-${i}@example.invalid`,termsAccepted:true});
  await recordSyntheticBookingProfile(db.pool,booking.id);fake.status=i%3?'COMPLETED':'PENDING';await bookings.startPayment(booking.id,randomUUID());bookingIds.push(booking.id);
 }
 const modelId=(await db.pool.query('SELECT v.model_id FROM ledger_variants v WHERE v.id=$1',[variants.ski])).rows[0].model_id as string;
 const state=await loginCtx.storageState();await loginCtx.close();

 async function ctxFor(kind:'desktop'|'mobile',locale:'ja'|'en'){
  const c=await browser.newContext({baseURL:origin,storageState:state,...(kind==='mobile'?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}:{viewport:{width:1440,height:900}})});
  await c.addCookies([{name:'zao_staff_locale',value:locale,url:origin}]);
  await c.addInitScript(()=>{const w=window as unknown as {__m:{cls:number;lcp:number;lcpEl:string;shifts:{v:number;t:number;n:string[]}[];long:number[]}};
   w.__m={cls:0,lcp:0,lcpEl:'',shifts:[],long:[]};
   try{new PerformanceObserver(l=>{for(const e of l.getEntries() as unknown as {hadRecentInput:boolean;value:number;startTime:number;sources?:{node?:Element}[]}[]){if(!e.hadRecentInput){w.__m.cls+=e.value;w.__m.shifts.push({v:+e.value.toFixed(4),t:Math.round(e.startTime),n:(e.sources??[]).map(s=>s.node?s.node.nodeName+'.'+String((s.node as Element).className||'').slice(0,40):'?')});}}}).observe({type:'layout-shift',buffered:true});}catch{/* unsupported */}
   try{new PerformanceObserver(l=>{const e=l.getEntries().at(-1) as unknown as {startTime:number;element?:Element};if(e){w.__m.lcp=e.startTime;w.__m.lcpEl=e.element?e.element.nodeName+'.'+String(e.element.className||'').slice(0,40):'';}}).observe({type:'largest-contentful-paint',buffered:true});}catch{/* unsupported */}
   try{new PerformanceObserver(l=>{for(const e of l.getEntries())w.__m.long.push(Math.round(e.duration));}).observe({type:'longtask',buffered:true});}catch{/* unsupported */}
  });
  return c;
 }
 async function throttle(page:Page,rate:number){if(rate>1){const s=await page.context().newCDPSession(page);await s.send('Emulation.setCPUThrottlingRate',{rate});}}
 async function loadOnce(c:BrowserContext,path:string,cpu:number){
  const page=await c.newPage();await throttle(page,cpu);const errs:string[]=[];page.on('pageerror',e=>errs.push(e.message.slice(0,120)));
  await page.goto(path,{waitUntil:'commit'});await page.waitForLoadState('load');await page.waitForLoadState('networkidle');await page.waitForTimeout(400);
  const m=await page.evaluate(()=>{const w=window as unknown as {__m:{cls:number;lcp:number;lcpEl:string;shifts:unknown[];long:number[]}};
   const nav=performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming,res=performance.getEntriesByType('resource') as PerformanceResourceTiming[];
   return {ttfb:nav.responseStart,docEnd:nav.responseEnd,dcl:nav.domContentLoadedEventEnd,load:nav.loadEventEnd,lcp:w.__m.lcp,lcpEl:w.__m.lcpEl,cls:w.__m.cls,shifts:w.__m.shifts,longTasks:w.__m.long,
    fetches:res.filter(r=>r.initiatorType==='fetch').map(r=>({u:r.name,start:r.startTime,end:r.responseEnd,status:r.responseStatus})),
    js:res.filter(r=>r.initiatorType==='script').length,jsBytes:res.filter(r=>r.initiatorType==='script').reduce((a,r)=>a+r.transferSize,0)};});
  await page.close();return {...m,errs};
 }
 const ROUTES:[string,string][]=[['/staff','dashboard'],['/staff/today','today'],['/staff/orders','orders'],['/staff/orders/'+bookingIds[0],'order-detail'],['/staff/orders/new','order-new'],['/staff/customers','customers'],
  ['/staff/inventory','inventory'],['/staff/inventory/'+modelId,'inventory-detail'],['/staff/sales-stops','sales-stops'],['/staff/users','users'],['/staff/calendar?from='+businessDate,'calendar'],['/staff/reports','reports'],
  ['/staff/scan','scan'],['/staff/notifications','notifications'],['/staff/settings','settings'],['/staff/documents','documents'],['/staff/coupons','coupons']];
 // customer detail key: read the first customer link from the real list (no key guessing).
 {const c=await ctxFor('desktop','ja'),p=await c.newPage();await p.goto('/staff/customers');await p.getByRole('table').waitFor();
  const href=await p.locator('a[href^="/staff/customers/"]').first().getAttribute('href');if(href)ROUTES.push([href,'customer-detail']);await c.close();}

 const summarize=(runs:Awaited<ReturnType<typeof loadOnce>>[])=>{
  const byPath:Record<string,number[]>={};for(const r of runs){const cnt:Record<string,number>={};for(const f of r.fetches){const k=pathOf(f.u);cnt[k]=(cnt[k]??0)+1;}for(const [k,v] of Object.entries(cnt))(byPath[k]??=[]).push(v);}
  const fetchCount:Record<string,{min:number;max:number}>={};for(const [k,v] of Object.entries(byPath))fetchCount[k]={min:Math.min(...v),max:Math.max(...v)};
  const fetchDur:Record<string,ReturnType<typeof stat>>={};for(const k of Object.keys(byPath))fetchDur[k]=stat(runs.flatMap(r=>r.fetches.filter(f=>pathOf(f.u)===k).map(f=>f.end-f.start)));
  return {n:runs.length,ttfb:stat(runs.map(r=>r.ttfb)),docEnd:stat(runs.map(r=>r.docEnd)),dcl:stat(runs.map(r=>r.dcl)),lcp:stat(runs.map(r=>r.lcp)),lcpEl:runs.at(-1)?.lcpEl,cls:stat(runs.map(r=>r.cls)),clsMax:+Math.max(...runs.map(r=>r.cls)).toFixed(4),
   shifts:runs.find(r=>r.shifts.length)?.shifts,longTaskMax:stat(runs.map(r=>Math.max(0,...r.longTasks))),fetchCount,fetchDur,jsBytes:stat(runs.map(r=>r.jsBytes)),errors:[...new Set(runs.flatMap(r=>r.errs))]};
 };

 if(mode==='dims'){
  // Heights of the loaded cards (to size the CLS placeholders) and the layout shifts, desktop + 390px, JA.
  const dims:Record<string,unknown>={};
  for(const kind of ['desktop','mobile'] as const){const c=await ctxFor(kind,'ja');
   for(const [path,name] of ROUTES.filter(r=>['today','sales-stops','coupons','settings'].includes(r[1]))){const page=await c.newPage();await page.goto(path);await page.waitForLoadState('networkidle');await page.waitForTimeout(500);
    dims[kind+' '+name]=await page.evaluate(`(()=>({cls:window.__m.cls,shifts:window.__m.shifts,sections:[...document.querySelectorAll('main section')].map(s=>({label:(s.getAttribute('aria-label')||s.getAttribute('aria-labelledby')||s.className).toString().slice(0,30),h:Math.round(s.getBoundingClientRect().height)}))}))()`);await page.close();}
   await c.close();}
  result.dims=dims;
 }else if(mode==='trace'){
  // Request timeline of one sidebar navigation (dashboard -> orders), relative to the click. Paths only; ids are masked.
  const timelines:unknown[]=[];
  for(const target of ['予約','顧客','カレンダー']){
   const c=await ctxFor('desktop','ja'),page=await c.newPage();await page.goto('/staff');await page.waitForLoadState('networkidle');
   for(let i=0;i<3;i++){
    const ev:{u:string;kind:string;s:number;e:number|null;ttfb:number|null}[]=[];let t0=0;
    const onReq=(r:import('@playwright/test').Request)=>{const o={u:pathOf(r.url()).replace(/[0-9a-f-]{36}/g,':id')+(r.url().includes('_rsc=')?' [rsc]':''),kind:r.resourceType(),s:performance.now()-t0,e:null as number|null,ttfb:null as number|null};ev.push(o);};const onDone=(r:import('@playwright/test').Request)=>{const o=ev.find(x=>x.u===pathOf(r.url()).replace(/[0-9a-f-]{36}/g,':id')+(r.url().includes('_rsc=')?' [rsc]':'')&&x.e===null);if(o)o.e=performance.now()-t0;};page.on('requestfinished',onDone);
    page.on('request',onReq);t0=performance.now();
    await page.locator('aside').getByRole('link',{name:target,exact:true}).click();await page.waitForTimeout(2500);
    page.off('request',onReq);page.off('requestfinished',onDone);timelines.push({target,iter:i,events:ev.map(e=>({...e,s:Math.round(e.s),e:e.e===null?null:Math.round(e.e)}))});
    await page.goto('/staff');await page.waitForLoadState('networkidle');
   }
   await c.close();
  }
  // DOM timeline of one navigation: when does the URL change, when does the main area's text change (relative to click).
  {const c=await ctxFor('desktop','ja'),page=await c.newPage();await page.goto('/staff');await page.waitForLoadState('networkidle');
   await page.evaluate(`(()=>{window.__dom=[];window.__t0=0;
    new MutationObserver(()=>{const m=document.querySelector('main');window.__dom.push({t:Math.round(performance.now()-window.__t0),url:location.pathname,main:((m&&m.querySelector('h1')&&m.querySelector('h1').textContent)||(m&&m.textContent)||'').slice(0,24)});}).observe(document.body,{childList:true,subtree:true,characterData:true});
    document.addEventListener('click',()=>{window.__t0=performance.now();},{capture:true});})()`);
   await page.locator('aside').getByRole('link',{name:'予約',exact:true}).click();await page.waitForTimeout(1500);
   const dom=await page.evaluate(()=>(window as unknown as {__dom:{t:number;url:string;main:string}[]}).__dom);
   const seen:string[]=[];result.domTimeline=dom.filter(d=>{const k=d.url+'|'+d.main;if(seen.includes(k))return false;seen.push(k);return true;});
   await c.close();}
  // CPU profile of one dashboard -> orders navigation: top self-time functions (function names and chunk file names only).
  {const c=await ctxFor('desktop','ja'),page=await c.newPage();await page.goto('/staff');await page.waitForLoadState('networkidle');
   const cdp=await c.newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:200});await cdp.send('Profiler.start');
   await page.locator('aside').getByRole('link',{name:'予約',exact:true}).click();await page.waitForTimeout(1500);
   const {profile}=await cdp.send('Profiler.stop') as {profile:{nodes:{id:number;callFrame:{functionName:string;url:string};children?:number[]}[];samples:number[];timeDeltas:number[]}};
   const self=new Map<number,number>();profile.samples.forEach((id,i)=>self.set(id,(self.get(id)??0)+(profile.timeDeltas[i]??0)));
   const byFn=new Map<string,number>();for(const n of profile.nodes){const k=(n.callFrame.functionName||'(anon)')+' @ '+n.callFrame.url.split('/').slice(-2).join('/');byFn.set(k,(byFn.get(k)??0)+(self.get(n.id)??0));}
   result.profileTop=[...byFn.entries()].filter(([k])=>!k.startsWith('(idle)')&&!k.startsWith('(program)')).sort((a,b)=>b[1]-a[1]).slice(0,25).map(([k,v])=>({fn:k,ms:Math.round(v/1000)}));
   await c.close();}
  result.trace=timelines;
 }else if(mode==='cold'){
  // Cold conditions: (1) first visit after server start (this process started the server just now; no page has been served),
  // (2) every repetition in a brand-new browser context (empty HTTP cache), (3) CPU 1x desktop.
  const cold:Record<string,unknown>={};
  for(const [path,name] of ROUTES.filter(r=>['orders','users','customers','today','dashboard','inventory','sales-stops'].includes(r[1]))){
   const first:Awaited<ReturnType<typeof loadOnce>>[]=[];
   const c1=await ctxFor('desktop','ja');first.push(await loadOnce(c1,path,1));await c1.close();
   const rest:Awaited<ReturnType<typeof loadOnce>>[]=[];
   for(let i=0;i<10;i++){const c=await ctxFor('desktop','ja');rest.push(await loadOnce(c,path,1));await c.close();}
   cold[name]={firstAfterServerStart:{ttfb:first[0]!.ttfb,docEnd:first[0]!.docEnd,lcp:first[0]!.lcp,cls:first[0]!.cls,fetches:first[0]!.fetches.map(f=>({p:pathOf(f.u),s:Math.round(f.start),d:Math.round(f.end-f.start)}))},newContextNext10:summarize(rest),docGap:rest.map(r=>Math.round(r.docEnd-r.ttfb))};
  }
  result.cold=cold;
 }else{
  const configs:{name:string;kind:'desktop'|'mobile';locale:'ja'|'en';cpu:number;reps:number}[]=[
   {name:'desktop-ja',kind:'desktop',locale:'ja',cpu:1,reps:REPS},{name:'desktop-en',kind:'desktop',locale:'en',cpu:1,reps:Math.max(3,Math.floor(REPS/2))},{name:'mobile390-ja-cpu4x',kind:'mobile',locale:'ja',cpu:4,reps:REPS},{name:'mobile390-en-cpu4x',kind:'mobile',locale:'en',cpu:4,reps:Math.max(3,Math.floor(REPS/2))}];
  const pages:Record<string,Record<string,unknown>>={};
  for(const cfg of configs){
   log('pages '+cfg.name);const c=await ctxFor(cfg.kind,cfg.locale);pages[cfg.name]={};
   for(const [path,name] of ROUTES){await loadOnce(c,path,cfg.cpu);// one discarded warm-up (JS cache / server route warm)
    const runs:Awaited<ReturnType<typeof loadOnce>>[]=[];for(let i=0;i<cfg.reps;i++)runs.push(await loadOnce(c,path,cfg.cpu));pages[cfg.name]![name]=summarize(runs);}
   await c.close();
  }
  result.pages=pages;

  // API: replay each distinct GET API the pages call, with the page's own x-zao-session header, API_REPS sequential times.
  log('api replay');{const c=await ctxFor('desktop','ja'),page=await c.newPage();const seen=new Map<string,Record<string,string>>();
   page.on('request',r=>{const u=r.url();if(r.method()==='GET'&&pathOf(u).startsWith('/api/')&&!seen.has(u))seen.set(u,{...(r.headers()['x-zao-session']?{'x-zao-session':r.headers()['x-zao-session']!}:{})});});
   for(const [path] of ROUTES){await page.goto(path,{waitUntil:'load'});await page.waitForLoadState('networkidle');}
   const api:Record<string,ReturnType<typeof stat>>={};
   for(const [u,h] of seen){const times:number[]=[];for(let i=0;i<API_REPS;i++){const t=performance.now();const r=await c.request.get(u,{headers:h});await r.body();times.push(performance.now()-t);if(i===0&&!r.ok())times.length=0;}
    const k=pathOf(u)+(new URL(u).search?'?'+[...new URL(u).searchParams.keys()].sort().join('&'):'');if(times.length)api[k]=stat(times);}
   result.api=api;await c.close();}

  // Operations: click/submit -> target visible, and -> last /api response of the operation.
  async function ops(kind:'desktop'|'mobile',cpu:number){
   const c=await ctxFor(kind,'ja'),page=await c.newPage();page.setDefaultTimeout(T);await throttle(page,cpu);const failed:Record<string,number[]>={},out:Record<string,number[]>={},apiDone:Record<string,number[]>={};
   let lastApi=0;page.on('requestfinished',r=>{if(pathOf(r.url()).startsWith('/api/'))lastApi=performance.now();});
   const mobile=kind==='mobile';
   async function timed(name:string,start:()=>Promise<void>,done:()=>Promise<void>){lastApi=0;const t0=performance.now();try{await start();await done();}catch(e){log('op fail '+name+': '+String((e as Error).message).split('\n')[0]);(failed[name]??=[]).push(1);return;}const t=performance.now()-t0;(out[name]??=[]).push(t);await page.waitForTimeout(120);if(lastApi>t0)(apiDone[name]??=[]).push(lastApi-t0);}
   const side=async(name:string)=>{if(mobile)await page.getByRole('button',{name:'メニュー'}).click();await page.locator('aside').getByRole('link',{name,exact:true}).click();};
   await page.goto('/staff');await page.waitForLoadState('networkidle');
   for(let i=0;i<OP_REPS;i++){
    await timed('nav: dashboard->orders (sidebar)',()=>side('予約'),()=>page.getByRole('table').getByText('SYNTHETIC Perf Guest').first().waitFor());
    await timed('search: orders',async()=>{const s=page.getByRole('searchbox');await s.fill(i%2?'Guest 0'+(i%9):'Perf');await s.press('Enter');},()=>page.getByRole('table').getByText('SYNTHETIC Perf Guest').first().waitFor());
    await timed('filter: orders status checkbox',()=>page.getByRole('checkbox',{name:'予約済み'}).click(),()=>page.waitForURL(/status=RESERVED/));
    await page.getByRole('checkbox',{name:'予約済み'}).click();await page.waitForTimeout(250);
    await timed('open: order detail from list',()=>page.getByRole('table').getByRole('link').first().click(),()=>page.waitForURL(/\/staff\/orders\/[0-9a-f-]{36}/).then(()=>page.getByRole('heading',{name:/^#/}).first().waitFor()));
    await timed('nav: order detail->customers (sidebar)',()=>side('顧客'),()=>page.getByRole('table').getByRole('link').first().waitFor());
    await timed('search: customers',async()=>{const s=page.getByRole('searchbox').first();await s.fill('Perf');await s.press('Enter');},()=>page.getByRole('table').getByRole('link').first().waitFor());
    await timed('open: customer detail',()=>page.getByRole('table').getByRole('link').first().click(),()=>page.waitForURL(/\/staff\/customers\/.+/).then(()=>page.getByRole('heading').first().waitFor()));
    await timed('nav: ->inventory (sidebar)',()=>side('在庫'),()=>page.getByRole('table').first().waitFor());
    await timed('search: inventory',async()=>{const s=page.getByRole('searchbox');await s.fill('ski');await s.press('Enter');},()=>page.waitForURL(/search=/));
    await timed('open: inventory detail',async()=>{await page.goto('/staff/inventory');await page.getByRole('table').getByRole('link').first().click();},()=>page.getByRole('tab',{name:'サイズ'}).waitFor());
    await timed('nav: ->calendar (sidebar)',()=>side('カレンダー'),()=>page.getByRole('region',{name:'カレンダー'}).waitFor());
    await timed('nav: ->dashboard (sidebar)',()=>side('ダッシュボード'),()=>page.getByRole('region',{name:/貸出予定/}).waitFor());
    await timed('scan: manual order id -> order',async()=>{await page.goto('/staff/scan');await page.getByLabel('予約番号または予約QR').fill(bookingIds[i%bookingIds.length]!);await page.getByRole('button',{name:'この予約を開く'}).click();},()=>page.waitForURL(/\/staff\/orders\/[0-9a-f-]{36}/));
    await page.goto('/staff');await page.waitForLoadState('networkidle');
   }
   await c.close();const o:Record<string,{render:ReturnType<typeof stat>;apiDone:ReturnType<typeof stat>}>={};for(const k of new Set([...Object.keys(out),...Object.keys(failed)]))o[k]={render:stat(out[k]??[]),apiDone:stat(apiDone[k]??[]),failures:(failed[k]??[]).length} as never;return o;
  }
  log('operations');const opResults:Record<string,unknown>={};
  for(const [name,kind,cpu] of [['desktop-cpu1x','desktop',1],['mobile390-cpu4x','mobile',4]] as const){
   try{opResults[name]=await ops(kind,cpu);}catch(e){opResults[name]={error:String((e as Error).message).slice(0,300)};}
  }
  result.operations=opResults;
 }
}finally{
 await mkdir(outDir,{recursive:true});await writeFile(`${outDir}/staff-perf-${label}-${mode}.json`,JSON.stringify(result,null,1));
 await (browser as Browser).close();await app.stop();
}
console.log('WROTE '+`${outDir}/staff-perf-${label}-${mode}.json`);
