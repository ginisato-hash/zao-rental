import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import pages from '../../config/content/public-p0-pages.json';

// Issue #47 #7015233231 §3 P2 (public side): every public page, the legal documents, the booking entry and the booking
// lookup page, in Japanese and English at desktop and phone width. For each: no 5xx, no page error, html lang matches, every
// shown ¥ price followed by the tax-included note (TAX-01), an
// English page carries no Japanese interface text (the two language-switch labels and the legal name 株式会社Yuge, which the
// English terms quote on purpose, excepted), no horizontal scroll at 390px. Synthetic local app; no external request.
const built=process.argv.includes('--built');
const paths=[...new Set(pages.map(p=>p.path)),'legal/terms','legal/cancellation','legal/privacy','book','reservation'];
const JAPANESE=/[぀-ヿ㐀-鿿ｦ-ﾟ]/,ALLOWED=['日本語','株式会社Yuge','蔵王'];
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,failed=false,stage='startup',visited=0;const problems:string[]=[];
const browser=await chromium.launch(),shots='.local/evidence/issue47-public-routes';
try{
 await mkdir(shots,{recursive:true});
 app=await startDevelopmentApp({built});const {origin}=app;
 for(let i=0;i<180;i++){try{if((await fetch(origin+'/ja')).status<500)break;}catch{/* starting */}await new Promise(r=>setTimeout(r,1000));}
 const context=await browser.newContext({baseURL:origin}),page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 // Exact origin comparison (a prefix check would accept http://127.0.0.1:1234.evil); data:/blob: are in-page, not network.
 const external:string[]=[];page.on('request',r=>{const u=new URL(r.url());if(u.protocol!=='data:'&&u.protocol!=='blob:'&&u.origin!==origin)external.push(u.origin+u.pathname);});
 for(const locale of ['ja','en'] as const)for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:900});
  for(const path of paths){
   const route='/'+locale+(path?'/'+path:'');stage=`${locale} ${width} ${route}`;const before=errors.length;
   const r=await page.goto(route,{waitUntil:'load',timeout:60000});const status=r?.status()??0;if(status>=500||status===0)problems.push(`${stage}: HTTP ${status}`);
   await page.waitForTimeout(700);
   const lang=await page.evaluate(()=>document.documentElement.lang);if(lang!==locale)problems.push(`${stage}: html lang=${lang}`);
   if(locale==='en'){const lines=(await page.evaluate(()=>document.body.innerText)).split('\n').map(l=>l.trim()).filter(l=>l&&JAPANESE.test(l)&&!ALLOWED.some(a=>l.replace(a,'')!==l&&!JAPANESE.test(l.split(a).join(''))));
    if(lines.length)problems.push(`${stage}: Japanese in English: ${JSON.stringify(lines.slice(0,4))}`);}
   if(width===390&&await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1))problems.push(`${stage}: horizontal scroll`);
   // TAX-01: every price shown on a public page carries the tax-included note right after it.
   const bare=await page.evaluate(()=>{const text=document.body.innerText;const out:string[]=[];const re=/[¥￥]\s?[\d,]+(?:\s?〜|~)?/g;let m;while((m=re.exec(text))){const after=text.slice(m.index+m[0].length,m.index+m[0].length+18);if(!/^\s*(（税込）|\(tax included\)|\(incl\. tax\))/i.test(after))out.push(text.slice(Math.max(0,m.index-12),m.index+m[0].length+18).replace(/\s+/g,' '));}return out;});
   if(bare.length)problems.push(`${stage}: price without tax-included note: ${JSON.stringify(bare.slice(0,4))}`);
   if(errors.length>before)problems.push(`${stage}: page error ${errors.slice(before).join(' | ').slice(0,200)}`);
   await page.screenshot({path:`${shots}/${locale}-${width}${route.replace(/[/?=&]+/g,'_')}.png`});visited++;
  }
 }
 stage='report';if(external.length)problems.push('external requests: '+JSON.stringify([...new Set(external)].slice(0,8)));assert.deepEqual(problems,[],problems.join('\n'));
 console.log(JSON.stringify({status:'PASS',routes:paths.length,visited,locales:2,widths:2,externalRequests:external.length,screenshots:shots}));
 await context.close();
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,visited,problems:problems.length}));console.error(problems.join('\n')||(e as Error).message?.slice(0,800));}
finally{await browser.close();await app?.stop();}
if(failed)process.exitCode=1;
