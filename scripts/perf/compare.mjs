// Markdown before/after tables: node scripts/perf/compare.mjs before.json after.json
import {readFileSync} from 'node:fs';
const [b,a]=[process.argv[2],process.argv[3]].map(f=>JSON.parse(readFileSync(f,'utf8')));
const d=(x,y)=>x==null||y==null||x===0?'':((y-x)/x*100>=0?'+':'')+((y-x)/x*100).toFixed(0)+'%';
for(const cfg of Object.keys(b.operations??{})){console.log(`\n### 操作時間 ${cfg}（クリック→目的要素の描画完了, ms）\n\n| 操作 | before p50 | before p95 | after p50 | after p95 | p95変化 |\n|---|---|---|---|---|---|`);
 for(const k of Object.keys(b.operations[cfg])){const x=b.operations[cfg][k].render,y=a.operations[cfg]?.[k]?.render;if(!y)continue;console.log(`| ${k} | ${x.p50} | ${x.p95} | ${y.p50} | ${y.p95} | ${d(x.p95,y.p95)} |`);}}
for(const cfg of Object.keys(b.pages??{})){console.log(`\n### ページ読込 ${cfg}（LCP ms / CLS最大）\n\n| 画面 | before LCP p50 | after LCP p50 | before CLS max | after CLS max |\n|---|---|---|---|---|`);
 for(const k of Object.keys(b.pages[cfg])){const x=b.pages[cfg][k],y=a.pages[cfg]?.[k];if(!y)continue;console.log(`| ${k} | ${x.lcp.p50} | ${y.lcp.p50} | ${x.clsMax} | ${y.clsMax} |`);}}
console.log('\n### API warm（ms, 各35回, 同一セッション・直列）\n\n| API | before p50 | before p95 | after p50 | after p95 |\n|---|---|---|---|---|');
for(const k of Object.keys(b.api??{})){const x=b.api[k],y=a.api?.[k];if(y)console.log(`| ${k.replace(/[0-9a-f-]{36}/g,':id')} | ${x.p50} | ${x.p95} | ${y.p50} | ${y.p95} |`);}
