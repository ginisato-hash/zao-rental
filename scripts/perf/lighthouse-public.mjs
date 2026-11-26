// Non-destructive Lighthouse baseline for PUBLIC pages (Issue #47 P1-PERF). Navigation mode only: it measures initial load (LCP/CLS/TBT/TTFB/score) and is NOT an INP measurement.
// Usage: node scripts/perf/lighthouse-public.mjs <origin> <outDir> [runs=3]. Pinned Lighthouse version below. Output: per page x form factor, every run plus the median.
// Only GET navigations of public pages; no cookies, no form submission. Reports keep metrics only (no HTML/screenshots), so nothing personal is stored.
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const LIGHTHOUSE='lighthouse@12.8.2';
const [origin,outDir,runsArg]=process.argv.slice(2);
if(!origin||!/^https:\/\/[a-z0-9.-]+$/.test(origin)||!outDir)throw new Error('usage: lighthouse-public.mjs <https origin> <outDir> [runs]');
const runs=Number(runsArg??3),PAGES=['/ja','/en','/ja/rental','/ja/prices','/ja/faq','/en/rental'];
mkdirSync(outDir,{recursive:true});
const med=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
const rows=[];
for(const page of PAGES)for(const form of ['mobile','desktop']){
 const r=[];
 for(let i=0;i<runs;i++){
  const args=['--yes',LIGHTHOUSE,origin+page,'--only-categories=performance','--output=json','--quiet','--chrome-flags=--headless=new --no-sandbox',...(form==='desktop'?['--preset=desktop']:[])];
  try{const j=JSON.parse(execFileSync('npx',args,{encoding:'utf8',maxBuffer:64_000_000,timeout:180000}));const a=j.audits;
   r.push({score:Math.round(j.categories.performance.score*100),lcp:a['largest-contentful-paint'].numericValue,cls:a['cumulative-layout-shift'].numericValue,tbt:a['total-blocking-time'].numericValue,ttfb:a['server-response-time'].numericValue,fcp:a['first-contentful-paint'].numericValue,bytes:a['total-byte-weight'].numericValue,warm:i>0});}
  catch(e){r.push({error:String(e.message).slice(0,80)});}
 }
 const ok=r.filter(x=>!x.error);
 rows.push({page,form,runs:r,median:ok.length?Object.fromEntries(['score','lcp','cls','tbt','ttfb','fcp','bytes'].map(k=>[k,med(ok.map(x=>x[k]))])):null});
}
writeFileSync(outDir+'/lighthouse-public.json',JSON.stringify({origin,lighthouse:LIGHTHOUSE,at:new Date().toISOString(),runsPerCell:runs,note:'run 0 is cold, later runs warm; navigation lab data, not INP',rows},null,1));
console.log(JSON.stringify(rows.map(x=>({page:x.page,form:x.form,median:x.median})),null,0));
