import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {chromium} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {seedRecommendation} from '../recommendation/fixture';
import {permissions} from '../../packages/auth/src/staff-auth';

// Owner requirement (Issue #47, 2026-11-20): every staff/admin page follows the new philosophy with one consistent UI.
// A staff member holding every permission opens every staff/admin route in Japanese and English at 1440 and 390 px, so
// the working screens render (not their permission notices), and the content area is measured, not eyeballed:
//  - page titles are the quiet 32 px (28 px on phones) title, never the poster scale;
//  - no 2 px (or thicker) dark rule or frame anywhere in the content (the old console language);
//  - every ordinary button is a pill (radius >= 16 px) without a dark frame;
//  - text fields and selects have a hairline (<= 1 px) and rounded (>= 6 px) frame;
//  - no horizontal page scroll at 390 px, no page error, no external request.
// The printable item-label sheet keeps its print frame (.asset-label) by design. Synthetic local app; screenshots kept.
const built=process.argv.includes('--built');
const ROUTES=['/staff','/staff/today','/staff/orders','/staff/orders/new','/staff/calendar','/staff/customers','/staff/inventory','/staff/documents','/staff/reports','/staff/scan',
 '/staff/notifications','/staff/settings','/staff/holds','/staff/quotes','/staff/recommendations','/staff/rentals','/staff/amendments','/staff/transfers','/staff/ledger','/staff/wear',
 '/staff/content','/staff/users','/staff/password','/admin','/admin/assets','/admin/inventory','/admin/launch','/admin/notifications','/admin/ops','/admin/prices'];
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,failed=false,stage='startup';const problems:string[]=[];let visited=0;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url'),shots='.local/evidence/issue47-console-unity';
try{
 await mkdir(shots,{recursive:true});
 app=await startDevelopmentApp({built,operations:true});const {origin,db}=app;
 for(let i=0;i<180;i++){try{if((await fetch(origin+'/staff/login')).status<500)break;}catch{/* starting */}await new Promise(r=>setTimeout(r,1000));}
 const root=await bootstrapDevelopmentAdmin(db.pool,{email:'unity-root@example.invalid',displayName:'SYNTHETIC Unity Root',password});
 for(const permission of permissions)await db.pool.query('INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,$2,true) ON CONFLICT(staff_id,permission) DO UPDATE SET allowed=true',[root,permission]);
 await seedRecommendation(db.pool);
 const context=await browser.newContext({baseURL:origin,viewport:{width:1440,height:900}});
 // tsx adds __name(...) to serialized functions; define it in the page so page.evaluate runs.
 await context.addInitScript({content:'window.__name=window.__name||(f=>f);'});const page=await context.newPage();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource: the server responded with a status of (401|403|404|409|503)/.test(m.text()))errors.push('console: '+m.text().slice(0,160));});
 const external:string[]=[];page.on('request',r=>{const u=new URL(r.url());if(u.protocol!=='data:'&&u.protocol!=='blob:'&&u.origin!==origin)external.push(u.origin+u.pathname);});
 stage='login';await page.goto('/staff/login');await page.getByLabel('メールアドレス',{exact:true}).fill('unity-root@example.invalid');await page.getByLabel('パスワード',{exact:true}).fill(password);
 await page.getByRole('button',{name:'ログイン',exact:true}).click();await page.waitForURL(u=>!u.pathname.startsWith('/staff/login'),{timeout:60000});
 for(const locale of ['ja','en'] as const){
  await context.addCookies([{name:'zao_staff_locale',value:locale,url:origin}]);
  // 720 is the CSS width of a 1440 px window at 200% zoom; 800 sits between the phone and desktop layouts.
  for(const [width,scheme] of [[1440,'light'],[800,'light'],[720,'light'],[390,'light'],[1440,'dark'],[390,'dark']] as const){
   if(locale==='en'&&scheme==='dark')continue;
   await page.emulateMedia({colorScheme:scheme});
   await page.setViewportSize({width,height:width===390?844:900});
   for(const route of ROUTES){
    stage=`${locale} ${width} ${scheme} ${route}`;const before=errors.length;
    const r=await page.goto(route,{waitUntil:'load',timeout:60000});if((r?.status()??0)>=500)problems.push(`${stage}: HTTP ${r?.status()}`);
    await page.waitForFunction(()=>!document.querySelector('[role="status"]')||!/^(…|セッションを確認中…|Checking your session…)$/.test(document.querySelector('[role="status"]')!.textContent?.trim()??''),undefined,{timeout:15000}).catch(()=>{});await page.waitForTimeout(700);
    const found=await page.evaluate((phone)=>{
     const out:string[]=[],root=document.querySelector('.sx-content');if(!root)return ['no staff content area'];
     const name=(e:Element)=>e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className?'.'+e.className.trim().split(/\s+/).slice(0,2).join('.'):'');
     const visible=(e:Element)=>{const r=(e as HTMLElement).getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
     const dark=(c:string)=>{const m=c.match(/\d+(\.\d+)?/g);if(!m)return false;const [r,g,b,a]=m.map(Number);return (a===undefined||a>0.5)&&r!<80&&g!<80&&b!<80;};
     for(const h of root.querySelectorAll('h1'))if(visible(h)&&parseFloat(getComputedStyle(h).fontSize)>(phone?28.5:32.5))out.push('title '+getComputedStyle(h).fontSize+' '+name(h));
     for(const e of root.querySelectorAll('*')){if(!visible(e)||e.closest('.asset-label')||e.closest('canvas'))continue;const s=getComputedStyle(e);
      for(const side of ['Top','Right','Bottom','Left'] as const){const w=parseFloat(s.getPropertyValue('border-'+side.toLowerCase()+'-width')),st=s.getPropertyValue('border-'+side.toLowerCase()+'-style'),c=s.getPropertyValue('border-'+side.toLowerCase()+'-color');
       if(w>=2&&st!=='none'&&dark(c)){out.push(`dark ${w}px ${side.toLowerCase()} rule ${name(e)}`);break;}}}
     for(const b of root.querySelectorAll('button')){if(!visible(b)||b.matches('.sx-link,.sx-iconbtn,[role=tab],.sx-seg button,[role=switch]'))continue;const s=getComputedStyle(b);
      if(parseFloat(s.borderTopLeftRadius)<16)out.push('square button '+name(b)+' "'+(b.textContent??'').trim().slice(0,24)+'"');}
     for(const f of root.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]):not([type=range]),select,textarea')){if(!visible(f))continue;const s=getComputedStyle(f);
      if(parseFloat(s.borderTopWidth)>1.5||parseFloat(s.borderTopLeftRadius)<6)out.push(`field ${s.borderTopWidth}/${s.borderTopLeftRadius} ${name(f)}`);}
     // Contrast: every visible text against the background it is actually drawn on (WCAG AA 4.5:1, large text 3:1).
     const rgb=(c:string)=>{const m=c.match(/[\d.]+/g)?.map(Number)??[0,0,0,0];return {r:m[0]!,g:m[1]!,b:m[2]!,a:m[3]??1};};
     const lum=(c:{r:number;g:number;b:number})=>{const f=(v:number)=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;};return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b);};
     const bgOf=(e:Element|null):{r:number;g:number;b:number}|null=>{for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);if(s.backgroundImage!=='none')return null;const c=rgb(s.backgroundColor);if(c.a>0.9)return c;}return rgb(getComputedStyle(document.body).backgroundColor);};
     for(const e of root.querySelectorAll('*')){if(!visible(e)||e.closest('.asset-label,canvas,svg,[aria-hidden=true]'))continue;
      if(![...e.childNodes].some(n=>n.nodeType===3&&(n.textContent??'').trim()))continue;const s=getComputedStyle(e);if(parseFloat(s.opacity)<0.5)continue;
      const fg=rgb(s.color),bg=bgOf(e);if(!bg||fg.a<0.5)continue;const [hi,lo]=[lum(fg),lum(bg)].sort((x,y)=>y-x) as [number,number];const ratio=(hi+.05)/(lo+.05),size=parseFloat(s.fontSize),bold=parseInt(s.fontWeight)>=600;
      const disabled=(e as HTMLButtonElement).disabled||!!e.closest(':disabled,[aria-disabled=true]');
      if(!disabled&&ratio<((size>=24||(bold&&size>=18.66))?3:4.5))out.push(`contrast ${ratio.toFixed(2)} ${name(e)} "${(e.textContent??'').trim().slice(0,20)}"`);
      if(size>40)out.push(`poster text ${size}px ${name(e)}`);}
     // The submit action of a form is the one blue primary.
     for(const b of root.querySelectorAll('button[type=submit]:not(:disabled),button.staff-card-primary:not(:disabled)')){if(!visible(b)||b.closest('.guest-main'))continue;const c=rgb(getComputedStyle(b).backgroundColor);if(!(c.b>c.r+60&&c.b>c.g+20))out.push('primary not blue '+name(b)+' "'+(b.textContent??'').trim().slice(0,24)+'"');}
     return [...new Set(out)].slice(0,16);
    },width===390);
    for(const f of found)problems.push(`${stage}: ${f}`);
    if(width<=900&&await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1))problems.push(`${stage}: horizontal scroll`);
    if(errors.length>before)problems.push(`${stage}: page error ${errors.slice(before).join(' | ').slice(0,200)}`);
    await page.screenshot({path:`${shots}/${locale}-${width}-${scheme}${route.replace(/[/?=&]+/g,'_')}.png`,fullPage:true});visited++;
   }
  }
 }
 stage='report';if(external.length)problems.push('external requests: '+JSON.stringify([...new Set(external)].slice(0,8)));
 assert.deepEqual(problems,[],problems.length+' problems:\n'+problems.slice(0,80).join('\n'));
 console.log(JSON.stringify({status:'PASS',routes:ROUTES.length,visited,locales:2,layouts:'1440/800/720(200%)/390 light, 1440/390 dark (ja)',permissions:permissions.length,screenshots:shots,externalRequests:0}));
 await context.close();
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,visited,problems:problems.length}));console.error(problems.slice(0,120).join('\n')||(e as Error).message?.slice(0,800));}
finally{await browser.close();await app?.stop();}
if(failed)process.exitCode=1;
