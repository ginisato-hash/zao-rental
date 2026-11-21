import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {chromium} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';
import {bootstrapDevelopmentAdmin} from '../../scripts/bootstrap-staff';
import {seedRecommendation} from '../recommendation/fixture';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {writeAccount} from '../../packages/auth/src/accounts';

// Issue #47 / TD #7044107295 §3: the one staff UI for every role, not only an all-permission ADMIN.
// Four people with their role's default permissions (no overrides) — ADMIN (all stations), MANAGER (Central only),
// STAFF (Mountain only), VIEWER (Mountain only) — open every staff/admin route; each role on a different language and
// width so both languages and both widths meet every role. For every page: no server error, page error or external
// request; a page title (the working screen or its permission notice); no horizontal scroll at 390 px; the first Tab
// lands on a control with a visible focus ring; and only an administrator sees the staff-creation action.
// 720 px at device scale 2 elsewhere (console-unity-ui) is the CSS layout of 200% zoom, not a browser zoom gesture.
const built=process.argv.includes('--built');
const ROUTES=['/staff','/staff/today','/staff/orders','/staff/orders/new','/staff/calendar','/staff/customers','/staff/inventory','/staff/documents','/staff/reports','/staff/scan',
 '/staff/notifications','/staff/settings','/staff/holds','/staff/quotes','/staff/recommendations','/staff/rentals','/staff/amendments','/staff/transfers','/staff/ledger','/staff/wear',
 '/staff/content','/staff/users','/staff/password','/admin','/admin/assets','/admin/inventory','/admin/launch','/admin/notifications','/admin/ops','/admin/prices','/staff/help'];
const PEOPLE=[
 {role:'ADMIN',scope:'ALL',storeIds:[] as string[],locale:'ja',width:1440},
 {role:'MANAGER',scope:'ASSIGNED',storeIds:['ONSEN_BASE'],locale:'en',width:390},
 {role:'STAFF',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],locale:'en',width:1440},
 {role:'VIEWER',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],locale:'ja',width:390},
] as const;
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,failed=false,stage='startup';const problems:string[]=[];let visited=0;
const browser=await chromium.launch(),password=randomBytes(24).toString('base64url'),shots='.local/evidence/issue47-role-sweep';
try{
 await mkdir(shots,{recursive:true});
 app=await startDevelopmentApp({built,operations:true});const {origin,db}=app;
 for(let i=0;i<180;i++){try{if((await fetch(origin+'/staff/login')).status<500)break;}catch{/* starting */}await new Promise(r=>setTimeout(r,1000));}
 const root=await bootstrapDevelopmentAdmin(db.pool,{email:'sweep-root@example.invalid',displayName:'SYNTHETIC Sweep Root',password}),rootPrincipal=(await loadStaff(db.pool,root))!;
 await seedRecommendation(db.pool);
 for(const person of PEOPLE){
  const email=`sweep-${person.role.toLowerCase()}@example.invalid`;
  await writeAccount(app.roles.authPool,rootPrincipal,undefined,{active:true,role:person.role,password,email,displayName:'SYNTHETIC Sweep '+person.role,scope:person.scope,storeIds:[...person.storeIds] as never,permissions:{}});
  const context=await browser.newContext({baseURL:origin,viewport:{width:person.width,height:person.width===390?844:900}});
  await context.addInitScript({content:'window.__name=window.__name||(f=>f);'});
  const page=await context.newPage(),errors:string[]=[],external:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{const u=new URL(r.url());if(u.protocol!=='data:'&&u.protocol!=='blob:'&&u.origin!==origin)external.push(u.origin+u.pathname);});
  stage=`${person.role} login`;await page.goto('/staff/login');await page.getByLabel('メールアドレス',{exact:true}).fill(email);await page.getByLabel('パスワード',{exact:true}).fill(password);
  await page.getByRole('button',{name:'ログイン',exact:true}).click();await page.waitForURL(u=>!u.pathname.startsWith('/staff/login'),{timeout:60000});
  await context.addCookies([{name:'zao_staff_locale',value:person.locale,url:origin}]);
  for(const route of ROUTES){
   stage=`${person.role} ${person.locale} ${person.width} ${route}`;const before=errors.length;
   const r=await page.goto(route,{waitUntil:'load',timeout:60000});if((r?.status()??0)>=500)problems.push(`${stage}: HTTP ${r?.status()}`);
   await page.waitForFunction(()=>!document.querySelector('[role="status"]')||!/^(…|セッションを確認中…|Checking your session…)$/.test(document.querySelector('[role="status"]')!.textContent?.trim()??''),undefined,{timeout:15000}).catch(()=>{});await page.waitForTimeout(500);
   if(await page.locator('main h1, .sx-content h1').count()===0)problems.push(`${stage}: no page title`);
   if(await page.evaluate(()=>document.documentElement.lang)!==person.locale)problems.push(`${stage}: html lang`);
   if(person.width===390&&await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1))problems.push(`${stage}: horizontal scroll`);
   // Keyboard: the first Tab from the top of the page reaches a control and its focus is visible.
   await page.evaluate(()=>{(document.activeElement as HTMLElement|null)?.blur();window.scrollTo(0,0);});await page.keyboard.press('Tab');
   const focus=await page.evaluate(()=>{const a=document.activeElement as HTMLElement|null;if(!a||a===document.body)return 'none';const s=getComputedStyle(a);
    return (s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0)||s.boxShadow!=='none'?'visible':'invisible:'+a.tagName.toLowerCase();});
   if(focus!=='visible')problems.push(`${stage}: first Tab focus ${focus}`);
   if(route==='/staff/users'&&person.role!=='ADMIN'&&await page.getByRole('button',{name:/スタッフを作成|Create staff/}).count()>0)problems.push(`${stage}: staff creation offered to ${person.role}`);
   if(route==='/staff/users'&&person.role==='ADMIN'&&await page.getByRole('button',{name:/スタッフを作成|Create staff/}).count()===0)problems.push(`${stage}: administrator cannot create staff`);
   if(errors.length>before)problems.push(`${stage}: page error ${errors.slice(before).join(' | ').slice(0,200)}`);
   await page.screenshot({path:`${shots}/${person.role}-${person.locale}-${person.width}${route.replace(/[/?=&]+/g,'_')}.png`});visited++;
  }
  if(external.length)problems.push(`${person.role}: external requests ${JSON.stringify([...new Set(external)].slice(0,5))}`);
  await context.close();
 }
 stage='report';assert.deepEqual(problems,[],problems.length+' problems:\n'+problems.slice(0,80).join('\n'));
 console.log(JSON.stringify({status:'PASS',roles:PEOPLE.length,routes:ROUTES.length,visited,screenshots:shots,externalRequests:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,visited,problems:problems.length}));console.error(problems.slice(0,120).join('\n')||(e as Error).message?.slice(0,800));}
finally{await browser.close();await app?.stop();}
if(failed)process.exitCode=1;
