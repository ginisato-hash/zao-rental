// Local visual self-check for R67: exact 390x844 / 1440x900 captures (first viewport + full page) of the running
// preview, plus mechanical checks of the visual target (no radius/shadow/gradient on content, logo is an image,
// no FAMILY, no horizontal overflow, BOOK + category reachable in the first viewport).
import {chromium} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
const base=process.argv[2]??'http://127.0.0.1:33474',out='.local/r67-shots',paths=process.argv.slice(3);mkdirSync(out,{recursive:true});
const browser=await chromium.launch(process.env.R67_CHROME?{executablePath:process.env.R67_CHROME}:{});const report:Record<string,unknown>[]=[];
try{
 for(const p of paths.length?paths:['/ja','/en','/ja/rental']){
  for(const [w,h] of [[390,844],[1440,900]] as const){
   const page=await browser.newPage({viewport:{width:w,height:h}});await page.addInitScript('window.__name=(f)=>f');
   await page.goto(base+p,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(1700);
   const name=p.replace(/\//g,'_').replace(/^_/,'')||'root';
   await page.screenshot({path:`${out}/${name}-${w}-fv.png`});await page.evaluate(async()=>{for(let y=0;y<document.documentElement.scrollHeight;y+=innerHeight/2){scrollTo(0,y);await new Promise(r=>setTimeout(r,120));}scrollTo(0,0);});await page.waitForTimeout(800);await page.screenshot({path:`${out}/${name}-${w}-full.png`,fullPage:true});
   const check=await page.evaluate(()=>{const vh=innerHeight,vis=(el:Element|null)=>{if(!el)return false;const r=el.getBoundingClientRect();return r.bottom>0&&r.top<vh&&r.width>0;};
    const els=[...document.querySelectorAll('main *, header *')];
    const rounded=els.filter(e=>parseFloat(getComputedStyle(e).borderTopLeftRadius)>0).map(e=>e.className).slice(0,5);
    const shadow=els.filter(e=>getComputedStyle(e).boxShadow!=='none'&&!/st-cta--line|guest/.test(String((e as HTMLElement).className))).map(e=>e.className).slice(0,5);
    const book=[...document.querySelectorAll('a')].find(a=>/BOOK/.test(a.textContent??'')&&a.getAttribute('href')?.endsWith('/book')&&!a.closest('.st-hd'));
    return {overflow:document.documentElement.scrollWidth-innerWidth,logoImg:!!document.querySelector('.st-hd-home img'),family:/FAMILY|ファミリー/i.test(document.body.innerText),
     bookAboveFold:vis(book??null),indexAboveFold:vis(document.querySelector('.st-index')),rounded,shadow};});
   report.push({path:p,width:w,...check});await page.close();
  }
 }
}finally{await browser.close();}
writeFileSync(out+'/report.json',JSON.stringify(report,null,1));console.log(JSON.stringify(report));
