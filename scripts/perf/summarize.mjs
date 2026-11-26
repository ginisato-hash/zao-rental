// Prints a compact table from a staff-perf JSON: node scripts/perf/summarize.mjs file.json
import {readFileSync} from 'node:fs';
const r=JSON.parse(readFileSync(process.argv[2],'utf8'));
if(r.pages)for(const [cfg,routes] of Object.entries(r.pages)){console.log('\n## '+cfg+'  (LCP p50/p95 ms | CLS max | docEnd p95 | fetches)');
 for(const [n,v] of Object.entries(routes)){const f=Object.entries(v.fetchCount).filter(([k])=>k.startsWith('/api/')).map(([k,c])=>k.replace('/api/','')+'x'+(c.min===c.max?c.max:c.min+'-'+c.max)).join(' ');
  console.log(n.padEnd(18),String(v.lcp.p50).padStart(6),String(v.lcp.p95).padStart(6),'|',String(v.clsMax).padStart(6),'|',String(v.docEnd.p95).padStart(6),'|',f);}}
if(r.api){console.log('\n## API warm (ms) p50/p95/max');for(const [k,v] of Object.entries(r.api))console.log(k.padEnd(60),v.p50,v.p95,v.max);}
if(r.operations)for(const [cfg,o] of Object.entries(r.operations)){console.log('\n## ops '+cfg+' render p50/p95 | apiDone p50/p95 | n | fail');
 for(const [k,v] of Object.entries(o))console.log(k.padEnd(40),v.render?.p50,v.render?.p95,'|',v.apiDone?.p50,v.apiDone?.p95,'|',v.render?.n,'|',v.failures??'');}
if(r.cold)for(const [k,v] of Object.entries(r.cold)){console.log('\n## cold '+k,'first:',JSON.stringify({ttfb:v.firstAfterServerStart.ttfb,docEnd:v.firstAfterServerStart.docEnd,lcp:v.firstAfterServerStart.lcp}),'next10 docEnd',JSON.stringify(v.newContextNext10.docEnd),'docGap',v.docGap.join(','));}
