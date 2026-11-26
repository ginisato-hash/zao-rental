// Lighthouse navigation baseline for PUBLIC pages (Issue #47 P1-PERF). GET navigations only: no cookies, no form submission,
// no write. Low load by design (default 3 runs per page x form factor, sequential).
//
// Usage:  node scripts/perf/lighthouse-public.mjs <origin> <outDir> [runs=3] [--deployment=<deployment id or commit sha>]
//         node scripts/perf/lighthouse-public.mjs --selftest        (offline check of the run validator; no browser, no network)
//
// WHAT THIS IS / IS NOT
//  - Lab data from Lighthouse navigation mode: FCP, LCP, CLS, TBT, Speed Index, TTFB (server-response-time audit), score.
//    It is NOT INP and NOT field data. TBT is Lighthouse's lab proxy; Navigation Timing and PerformanceObserver 'longtask'
//    estimates (see booking-flow-bench.ts) are different instruments and must never be reported as TBT or INP.
//  - Every run is a SEPARATE Lighthouse invocation, i.e. a separate Chrome process with a fresh profile: the browser cache is
//    empty every time. The server/CDN cache state is not controlled or observable from here, so no run may be labelled "warm".
//    Each run is recorded as browserCache:'cold' and serverCache:'unknown' (the response cache headers of one probe GET are recorded
//    as evidence only). A genuine warm-cache condition needs one browser session with a controlled second navigation
//    (e.g. Lighthouse user-flow API); that is intentionally NOT claimed here.
//  - A run only counts when ALL of these hold: no runtimeError, no fatal run warning about the page, the main document answered
//    HTTP 200, the final URL equals the requested URL (a redirect, interstitial or error page is not scored), and every required
//    metric is a finite number in range. Otherwise it is stored as a failure with a reason and excluded from the statistics.
//    The process exits non-zero when any run failed, so a green job cannot hide a bad page.
//  - Stored: metrics, throttling settings, versions, final URL, status. NOT stored: HTML, screenshots, traces, cookies, headers
//    beyond three cache headers.
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const LIGHTHOUSE='lighthouse@12.8.2';
const PAGES=['/ja','/en','/ja/rental','/ja/prices','/ja/faq','/en/rental'];
const METRICS={fcp:'first-contentful-paint',lcp:'largest-contentful-paint',cls:'cumulative-layout-shift',tbt:'total-blocking-time',si:'speed-index',ttfb:'server-response-time',bytes:'total-byte-weight'};
const sameUrl=(a,b)=>{try{const x=new URL(a),y=new URL(b);return x.origin===y.origin&&x.pathname.replace(/\/$/,'')===y.pathname.replace(/\/$/,'')&&x.search===y.search;}catch{return false;}};

/** Returns {ok:true,run} or {ok:false,reason}. Pure function of the Lighthouse result JSON so it can be self-tested. */
export function validateRun(j,requestedUrl){
 if(!j||typeof j!=='object')return {ok:false,reason:'NO_RESULT'};
 if(j.runtimeError)return {ok:false,reason:'RUNTIME_ERROR '+String(j.runtimeError.code??'').slice(0,60)};
 const finalUrl=j.finalDisplayedUrl??j.finalUrl;
 if(!finalUrl||!sameUrl(finalUrl,requestedUrl))return {ok:false,reason:'FINAL_URL_MISMATCH '+String(finalUrl).slice(0,120)};
 const requests=j.audits?.['network-requests']?.details?.items;
 const main=Array.isArray(requests)?requests.find(r=>sameUrl(r.url,requestedUrl)&&r.resourceType==='Document')??requests[0]:undefined;
 if(!main)return {ok:false,reason:'NO_MAIN_DOCUMENT_RECORD'};
 if(main.statusCode!==200)return {ok:false,reason:'HTTP_STATUS '+main.statusCode};
 // A redirect chain to the same URL (e.g. http->https) would show as a second Document row for a different URL.
 const redirects=Array.isArray(requests)?requests.filter(r=>r.resourceType==='Document'&&!sameUrl(r.url,requestedUrl)).length:0;
 if(redirects>0)return {ok:false,reason:'REDIRECT_OBSERVED '+redirects};
 const run={};
 for(const [key,id] of Object.entries(METRICS)){
  const v=j.audits?.[id]?.numericValue;
  if(typeof v!=='number'||!Number.isFinite(v)||v<0)return {ok:false,reason:'INVALID_METRIC '+key+'='+String(v)};
  run[key]=v;
 }
 // Metrics that must be strictly positive for a page that actually rendered.
 for(const key of ['fcp','lcp','ttfb','bytes'])if(!(run[key]>0))return {ok:false,reason:'NON_POSITIVE_METRIC '+key};
 const score=j.categories?.performance?.score;
 if(typeof score!=='number'||!Number.isFinite(score)||score<0||score>1)return {ok:false,reason:'INVALID_SCORE '+String(score)};
 run.score=Math.round(score*100);run.status=main.statusCode;run.finalUrl=finalUrl;
 return {ok:true,run};
}

function selftest(){
 const doc=(url,statusCode)=>({url,resourceType:'Document',statusCode});
 const base=(over={})=>({finalDisplayedUrl:'https://x.test/ja',audits:{'network-requests':{details:{items:[doc('https://x.test/ja',200)]}},'first-contentful-paint':{numericValue:900},'largest-contentful-paint':{numericValue:1200},'cumulative-layout-shift':{numericValue:0},'total-blocking-time':{numericValue:0},'speed-index':{numericValue:1000},'server-response-time':{numericValue:80},'total-byte-weight':{numericValue:5e5}},categories:{performance:{score:.99}},...over});
 const cases=[
  ['accepts a clean run',base(),true],
  ['rejects runtimeError',base({runtimeError:{code:'NO_FCP'}}),false],
  ['rejects redirect to another URL',base({finalDisplayedUrl:'https://x.test/en'}),false],
  ['rejects HTTP 404 even with a high score',base({audits:{...base().audits,'network-requests':{details:{items:[doc('https://x.test/ja',404)]}}}}),false],
  ['rejects an extra redirected Document row',base({audits:{...base().audits,'network-requests':{details:{items:[doc('http://x.test/ja',301),doc('https://x.test/ja',200)]}}}}),false],
  ['rejects NaN metric',base({audits:{...base().audits,'largest-contentful-paint':{numericValue:NaN}}}),false],
  ['rejects missing metric',base({audits:{...base().audits,'total-blocking-time':{}}}),false],
  ['rejects null score',base({categories:{performance:{score:null}}}),false],
  ['rejects zero LCP',base({audits:{...base().audits,'largest-contentful-paint':{numericValue:0}}}),false],
 ];
 let bad=0;for(const [name,input,expected] of cases){const got=validateRun(input,'https://x.test/ja').ok;if(got!==expected){bad++;console.error('SELFTEST FAIL '+name);}else console.log('SELFTEST PASS '+name);}
 process.exit(bad?1:0);
}

const median=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?(s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2):null;};

async function main(){
 const positional=process.argv.slice(2).filter(a=>!a.startsWith('--')),flags=Object.fromEntries(process.argv.slice(2).filter(a=>a.startsWith('--')).map(a=>{const [k,...v]=a.slice(2).split('=');return [k,v.join('=')];}));
 if('selftest' in flags)return selftest();
 const [origin,outDir,runsArg]=positional;
 // https for any real host; plain http only for a loopback app (a local smoke test of this script).
 if(!origin||!(/^https:\/\/[a-z0-9.-]+$/.test(origin)||/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))||!outDir)throw new Error('usage: lighthouse-public.mjs <https origin> <outDir> [runs] [--deployment=<id|sha>]');
 const runs=Number(runsArg??3);if(!Number.isInteger(runs)||runs<1||runs>10)throw new Error('runs must be an integer 1..10');
 mkdirSync(outDir,{recursive:true});
 let chrome,lighthouseVersion,commit=process.env.GITHUB_SHA??null;
 const rows=[];let okCount=0,failCount=0,settings;
 for(const page of PAGES)for(const form of ['mobile','desktop']){
  const url=origin+page,list=[];
  // One plain GET per page: cache headers as evidence of the server/CDN state (never used to label a run warm).
  let probe=null;try{const r=await fetch(url,{redirect:'manual'});probe={status:r.status,xVercelCache:r.headers.get('x-vercel-cache'),age:r.headers.get('age'),cacheControl:r.headers.get('cache-control')};}catch{probe={status:0};}
  for(let i=0;i<runs;i++){
   const args=['--yes',LIGHTHOUSE,url,'--only-categories=performance','--output=json','--quiet','--chrome-flags=--headless=new --no-sandbox',...(form==='desktop'?['--preset=desktop']:[])];
   try{
    const j=JSON.parse(execFileSync('npx',args,{encoding:'utf8',maxBuffer:128_000_000,timeout:240000}));
    lighthouseVersion??=j.lighthouseVersion;chrome??=j.environment?.hostUserAgent;
    settings??={};settings[form]={formFactor:j.configSettings?.formFactor,throttlingMethod:j.configSettings?.throttlingMethod,throttling:j.configSettings?.throttling,screenEmulation:j.configSettings?.screenEmulation,benchmarkIndex:j.environment?.benchmarkIndex};
    const v=validateRun(j,url);
    if(v.ok){okCount++;list.push({run:i,valid:true,browserCache:'cold',serverCache:'unknown',...v.run});}else{failCount++;list.push({run:i,valid:false,browserCache:'cold',serverCache:'unknown',reason:v.reason});}
   }catch(e){failCount++;list.push({run:i,valid:false,browserCache:'cold',serverCache:'unknown',reason:'LIGHTHOUSE_FAILED '+String(e.message).split('\n')[0].slice(0,100)});}
  }
  const ok=list.filter(x=>x.valid);
  rows.push({page,formFactor:form,probe,valid:ok.length,invalid:list.length-ok.length,runs:list,
   median:ok.length?Object.fromEntries(['score','fcp','lcp','cls','tbt','si','ttfb','bytes'].map(k=>[k,median(ok.map(x=>x[k]))])):null,
   min:ok.length?Object.fromEntries(['score','lcp','tbt'].map(k=>[k,Math.min(...ok.map(x=>x[k]))])):null});
 }
 const out={origin,lighthouse:{requested:LIGHTHOUSE,reported:lighthouseVersion},chromeUserAgent:chrome,deployment:flags.deployment||null,commit,at:new Date().toISOString(),runsPerCell:runs,validRuns:okCount,invalidRuns:failCount,
  throttlingSettingsObserved:settings,
  cacheCondition:'Each run is a separate Chrome process with an empty profile (browser cache cold). Server/CDN cache state unknown; no run is labelled warm.',
  metricNotes:'Lighthouse lab navigation metrics. TBT is not INP. Navigation Timing or longtask estimates are different instruments.',rows};
 writeFileSync(outDir+'/lighthouse-public.json',JSON.stringify(out,null,1));
 console.log(JSON.stringify({valid:okCount,invalid:failCount,rows:rows.map(x=>({page:x.page,form:x.formFactor,valid:x.valid,invalid:x.invalid,median:x.median}))}));
 if(failCount>0)process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
