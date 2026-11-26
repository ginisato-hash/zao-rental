/**
 * Guest booking flow bench (isolated app + isolated PostgreSQL only; never run against production).
 *
 * node --import tsx scripts/perf/booking-flow-bench.ts [--runs=20] [--tag=before] [--out=docs/execution/perf/booking-flow-bench-before.json]
 *
 * What is measured (and what is not):
 *  - Server: tests/flow-app served by `next dev --webpack` (the only fixture the repository can start with guest
 *    runtime wiring; a production build of the fixture fails by design with TEST_COMPOSITION_FORBIDDEN). Client JS is
 *    therefore unminified dev code; hydration and render times are UPPER bounds, API/DB times are comparable to production
 *    (same core services, same PostgreSQL schema, localhost so no network latency). Not a production measurement.
 *  - Browser: Playwright + Chromium, CDP Emulation.setCPUThrottlingRate (4x on the 390px profile, 1x on desktop),
 *    NO network throttling (loopback). Each iteration uses a fresh browser context (fresh guest cookie) so no
 *    iteration inherits another's draft; synthetic data only; payment is the development stub.
 *  - Durations are taken INSIDE the page with performance.now(): from the synthetic click (element.click()) to two
 *    animation frames after the awaited DOM condition appears ("operation -> render done"), and from window.fetch call
 *    to response body parsed ("operation -> API response done"). These are NOT Lighthouse TBT/INP/LCP; the long-task
 *    count/duration is a PerformanceObserver 'longtask' estimate and must not be read as TBT or INP.
 */
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {chromium,type BrowserContext,type Page} from '@playwright/test';
import {newQuietContext} from '../../tests/flow/dev-hmr';
import {startFlowApp} from '../../tests/flow/launcher';
import {fillGuestProfile} from '../../tests/public/guest-profile';
import {seedRecommendation} from '../../tests/recommendation/fixture';
import {bootstrapDevelopmentAdmin} from '../bootstrap-staff';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {PRICE_PRODUCTS} from '../../packages/contracts/src/pricing';

const PROFILE_FILTER=process.argv.find(a=>a.startsWith('--profiles='))?.slice(11).split(',');
const arg=(name:string,fallback:string)=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
const RUNS=Number(arg('runs','20')),TAG=arg('tag','run'),OUT=arg('out','');
type Profile={id:string;locale:'ja'|'en';width:number;height:number;cpu:number;mobile:boolean};
const PROFILES:Profile[]=[
 {id:'ja-390-cpu4',locale:'ja',width:390,height:844,cpu:4,mobile:true},
 {id:'en-390-cpu4',locale:'en',width:390,height:844,cpu:4,mobile:true},
 {id:'ja-1280-cpu1',locale:'ja',width:1280,height:900,cpu:1,mobile:false},
 {id:'en-1280-cpu1',locale:'en',width:1280,height:900,cpu:1,mobile:false},
];
const pct=(xs:number[],p:number)=>{if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b);const i=(s.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return +(s[lo]!+(s[hi]!-s[lo]!)*(i-lo)).toFixed(1);};
const summarize=(xs:number[])=>({n:xs.length,p50:pct(xs,.5),p95:pct(xs,.95),max:xs.length?+Math.max(...xs).toFixed(1):null});

const CLICK=new Function('b','b.click()') as (b:Element)=>void;
type Fx={path:string;method:string;s:number;e:number;status:number};
/** Installed before any page script: records every same-origin fetch (path, start, end, status) with in-page timestamps. */
const INIT=`(()=>{window.__fx=[];window.__lt=[];const f=window.fetch;window.fetch=async function(input,init){const u=new URL(typeof input==='string'?input:input.url,location.href);const r={path:u.pathname,method:(init&&init.method)||'GET',s:performance.now(),e:0,status:0};window.__fx.push(r);try{const res=await f.apply(this,arguments);r.status=res.status;const c=res.clone();c.arrayBuffer().then(()=>{r.e=performance.now();},()=>{r.e=performance.now();});return res;}catch(e){r.e=performance.now();throw e;}};try{new PerformanceObserver(l=>{for(const x of l.getEntries())window.__lt.push([x.startTime,x.duration]);}).observe({type:'longtask',buffered:true});}catch(e){}})();`;

type StepResult={step:string;renderMs:number;apiMs:number|null;fetches:{key:string;ms:number}[];serialChain:number;duplicates:string[];longTasks:{count:number;totalMs:number}};

/** Click the located element in-page and resolve when `cond` (function body source, returns truthy) holds + 2 frames. */
async function act(page:Page,step:string,click:()=>Promise<unknown>|null,condSrc:string,timeoutMs=20000):Promise<StepResult>{
 // In-page code is passed as source strings: tsx/esbuild injects a __name helper into compiled arrow functions that does not exist in the page.
 await page.evaluate('window.__fx.length=0;window.__lt.length=0;');
 const arm=page.evaluate(`new Promise((resolve,reject)=>{const t0=performance.now();window.__t0=t0;const cond=new Function(${JSON.stringify(condSrc)});const tick=()=>{if(cond()){requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-t0)));return;}if(performance.now()-t0>${timeoutMs}){reject(new Error('STEP_TIMEOUT'));return;}requestAnimationFrame(tick);};requestAnimationFrame(tick);})`) as Promise<number>;
 await new Promise(r=>setTimeout(r,0));
 if(click){await click();}
 const renderMs=await arm;
 const data=await page.evaluate('({fx:window.__fx.map(x=>({...x})),lt:window.__lt.slice(),t0:window.__t0})') as {fx:Fx[];lt:[number,number][];t0:number};
 return fold(step,renderMs,data);
}
function fold(step:string,renderMs:number,data:{fx:Fx[];lt:[number,number][];t0:number}):StepResult{
 const fx=data.fx.filter(x=>x.path.startsWith('/api/')),fetches=fx.map(x=>({key:x.method+' '+x.path,ms:+(x.e-x.s).toFixed(1)}));
 // serialChain = how many requests were strictly sequential (each started after the previous one ended).
 let chain=0,end=-1;for(const x of [...fx].sort((a,b)=>a.s-b.s)){if(x.s>=end-2){chain++;}end=Math.max(end,x.e);}
 const seen=new Map<string,number>();for(const f of fetches)seen.set(f.key,(seen.get(f.key)??0)+1);
 const lt=data.lt.filter(([s])=>s>=data.t0);
 return {step,renderMs:+renderMs.toFixed(1),apiMs:fx.length?+(Math.max(...fx.map(x=>x.e))-Math.min(...fx.map(x=>x.s))).toFixed(1):null,fetches,serialChain:chain,duplicates:[...seen].filter(([,n])=>n>1).map(([k,n])=>k+' x'+n),longTasks:{count:lt.length,totalMs:+lt.reduce((a,[,d])=>a+d,0).toFixed(1)}};
}

async function main(){
 const browser=await chromium.launch();let app:Awaited<ReturnType<typeof startFlowApp>>|undefined;
 try{
  app=await startFlowApp({publicP0:true,warmRoutes:true});await seedRecommendation(app.db.pool,true);
  await app.db.pool.query("CREATE OR REPLACE FUNCTION inventory_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT '2035-01-01T01:00:00Z'::timestamptz$$");
  const root=await bootstrapDevelopmentAdmin(app.db.pool,{email:'perf-root@example.invalid',displayName:'SYNTHETIC Root',password:randomBytes(24).toString('base64url')});
  for(const permission of ['PRICE_EDIT','QUOTE_VIEW','QUOTE_CREATE'])await app.db.pool.query('INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,$2,true)',[root,permission]);
  const quotes=new QuoteService(app.roles.pricingPool,(await loadStaff(app.db.pool,root))!);await quotes.initializePrivate(randomUUID(),'2035-01-01','2035-12-31');
  await quotes.createCoupon(randomUUID(),{code:'PERFGOOD10',validFrom:'2034-12-01T00:00:00+09:00',validUntil:'2035-12-31T00:00:00+09:00',storeBasis:'PICKUP_STORE',stores:['MOUNTAIN_BASE','ONSEN_BASE'],products:PRICE_PRODUCTS.map(p=>p.key),kind:'PERCENT_BPS',value:1000,minimumJpy:0,minimumBasis:'CART_SUBTOTAL',maximumDiscountJpy:100000,advanceCombination:'DENY',maxActiveReservations:null});
  for(let n=0;n<100;n++){try{if((await fetch(app.origin+'/api/health')).ok)break;}catch{}if(n===99)throw new Error('APP_START_TIMEOUT');await new Promise(r=>setTimeout(r,100));}
  const meta={tag:TAG,runsPerProfile:RUNS,server:'next dev --webpack (tests/flow-app), isolated PostgreSQL, loopback',chromium:browser.version(),node:process.version,commit:(await import('node:child_process')).execSync('git rev-parse --short HEAD').toString().trim(),throttling:'CDP CPU throttle per profile; no network throttle',timestamp:new Date().toISOString()};
  const results:Record<string,{iterations:number;failures:string[];steps:Record<string,{render:ReturnType<typeof summarize>;api:ReturnType<typeof summarize>;fetchCountMax:number;serialChainMax:number;duplicates:string[];longTaskMsP95:number|null;perApi:Record<string,ReturnType<typeof summarize>>;previewSeriesMs?:number[]}>}>={};
  const serverApi:Record<string,ReturnType<typeof summarize>>={};
  for(const profile of PROFILES.filter(p=>!PROFILE_FILTER||PROFILE_FILTER.includes(p.id))){
   const t=(j:string,e:string)=>profile.locale==='ja'?j:e;const collected:Record<string,StepResult[]>={},failures:string[]=[];
   // i=-1 on the first profile is a discarded warm-up iteration (compiles API routes in the dev server, warms PostgreSQL caches).
   for(let i=profile===PROFILES.find(p=>!PROFILE_FILTER||PROFILE_FILTER.includes(p.id))?-1:0;i<RUNS;i++){
    let context:BrowserContext|undefined;
    try{
     context=await newQuietContext(browser,{baseURL:app.origin,viewport:{width:profile.width,height:profile.height},hasTouch:profile.mobile,locale:profile.locale==='ja'?'ja-JP':'en-US'});context.setDefaultTimeout(20000);
     await context.addInitScript(INIT);const page=await context.newPage();
     const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:profile.cpu});
     const push=(r:StepResult)=>{if(i>=0)(collected[r.step]??=[]).push(r);};
     // Distinct start day per iteration/profile so inventory of a day is never the limiting factor.
     const day=new Date(Date.UTC(2035,0,6+i+PROFILES.indexOf(profile)*(RUNS+1))).toISOString().slice(0,10);
     // 0 load: navigation -> dates form usable (needs POST /context, then GET /draft + GET /options).
     await page.goto('/'+profile.locale+'/book',{waitUntil:'domcontentloaded'});
     const startSel=`const el=[...document.querySelectorAll('input[type=date]')].find(i=>!i.disabled);return !!el;`;
     const load=await page.evaluate(`new Promise((res,rej)=>{const c=new Function(${JSON.stringify(startSel)});const t0=performance.now();const tick=()=>{if(c()){requestAnimationFrame(()=>requestAnimationFrame(()=>res(performance.now())));return;}if(performance.now()-t0>30000){rej(new Error('LOAD_TIMEOUT'));return;}requestAnimationFrame(tick);};tick();})`) as number;
     const loadData=await page.evaluate('({fx:window.__fx.map(x=>({...x})),lt:window.__lt.slice(),t0:0})') as {fx:Fx[];lt:[number,number][];t0:number};
     push(fold('0-load (navigation to usable form)',load,loadData));
     await page.getByLabel(t('利用開始日','Start date'),{exact:true}).fill(day);await page.getByLabel(t('利用終了日','End date'),{exact:true}).fill(day);
     // 1 dates -> person/equipment step (client only)
     push(await act(page,'1-dates-to-equipment (CONTINUE, client only)',()=>page.getByRole('button',{name:'CONTINUE',exact:true}).evaluate(CLICK),`return [...document.querySelectorAll('button')].some(b=>/候補と参考料金を確認|Review sizes and estimates/.test(b.textContent||''));`));
     await fillGuestProfile(page,profile.locale);
     // 2 equipment -> sizes+estimate (POST /draft then POST /preview)
     push(await act(page,'2-equipment-to-sizes (save draft + preview)',()=>page.getByRole('button',{name:t('候補と参考料金を確認','Review sizes and estimates'),exact:true}).evaluate(CLICK),`return !!document.querySelector('[data-testid=coupon-box]')&&!!document.querySelector('input[type=radio]');`));
     await page.getByRole('radio',{name:t('おすすめ','Recommended')}).first().check();
     await page.getByRole('checkbox',{name:t('全員の内容を確認しました','I have checked everyone’s selections')}).check();
     // 3 sizes -> final review (POST /selection)
     push(await act(page,'3-sizes-to-review (select)',()=>page.getByRole('button',{name:t('全員分の最終確認へ','Review the whole group'),exact:true}).evaluate(CLICK),`return !!document.querySelector('dl.guest-price');`));
     // 4 coupon apply on review (re-save draft + preview + selection)
     await page.getByLabel(profile.locale==='ja'?/クーポンコード/:/Coupon code/).fill('PERFGOOD10');
     push(await act(page,'4-coupon-apply (review step)',()=>page.getByTestId('coupon-box').getByRole('button',{name:t('適用','Apply'),exact:true}).evaluate(CLICK),`return !!document.querySelector('[data-testid=coupon-applied]');`));
     // 5 pay with the development stub (POST /checkout), synthetic only
     await page.getByRole('checkbox',{name:t('合成データによる開発確認であることを確認','I understand this is a synthetic development preview')}).check();
     push(await act(page,'5-pay-dev-stub (checkout)',()=>page.getByRole('button',{name:/開発用決済|test payment/}).evaluate(CLICK),`return !!document.querySelector('.guest-result-total');`,40000));
     // Server-side read latency with this guest's cookie (no browser, no CPU throttle): warm p50/p95 over repeated GET.
     if(i===RUNS-1&&profile===PROFILES.find(p=>!PROFILE_FILTER||PROFILE_FILTER.includes(p.id))){
      const cookies=(await context.cookies()).map(c=>c.name+'='+c.value).join('; ');
      for(const path of ['/api/guest/draft','/api/guest/options']){const xs:number[]=[];for(let k=0;k<60;k++){const t0=performance.now();const r=await fetch(app.origin+path,{headers:{cookie:cookies}});await r.arrayBuffer();if(r.status!==200)throw new Error('SERVER_API_'+path+'_'+r.status);xs.push(performance.now()-t0);}serverApi[path]=summarize(xs.slice(5));}
     }
    }catch(e){failures.push('iter '+i+': '+String((e as Error).message).split('\n')[0]!.slice(0,160));}
    finally{await context?.close();}
   }
   const steps:typeof results[string]['steps']={};
   for(const [step,rs] of Object.entries(collected)){
    const perApi:Record<string,number[]>={};for(const r of rs)for(const f of r.fetches)(perApi[f.key]??=[]).push(f.ms);
    steps[step]={render:summarize(rs.map(r=>r.renderMs)),api:summarize(rs.flatMap(r=>r.apiMs===null?[]:[r.apiMs])),fetchCountMax:Math.max(...rs.map(r=>r.fetches.length)),serialChainMax:Math.max(...rs.map(r=>r.serialChain)),duplicates:[...new Set(rs.flatMap(r=>r.duplicates))],longTaskMsP95:pct(rs.map(r=>r.longTasks.totalMs),.95),perApi:Object.fromEntries(Object.entries(perApi).map(([k,v])=>[k,summarize(v)])),...(perApi['POST /api/guest/preview']?{previewSeriesMs:perApi['POST /api/guest/preview'].map(x=>Math.round(x)).filter((_,idx)=>idx%1===0)}:{})};
   }
   results[profile.id]={iterations:RUNS,failures,steps};
   console.log('PROFILE '+profile.id+' done failures='+failures.length);
  }
  const report={meta,results,serverApi};
  const text=JSON.stringify(report,null,1);console.log(text);
  if(OUT){await mkdir(dirname(OUT),{recursive:true});await writeFile(OUT,text+'\n');}
 }finally{await browser.close();await app?.stop();console.log('Owned perf browser/Web/PostgreSQL stopped.');}
}
await main();
