import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium,type Page} from '@playwright/test';
import {startDevelopmentApp} from '../../scripts/development-app';

// Issue #47 TD audit #7027993255 MAP-01: the station map is operated for real, not only inspected. Desktop: +/− buttons, wheel
// zoom about the cursor, mouse drag, arrow/+/−/0 keys, zoom limits, pins moving exactly with the terrain, tabs and #hash
// deep links. Phone (390px, touch): a one-finger vertical swipe scrolls the page and leaves the map alone; a two-finger pinch
// zooms the map and keeps the pins in step. Synthetic local app; no external request (map links are only rendered).
const built=process.argv.includes('--built');
let app:Awaited<ReturnType<typeof startDevelopmentApp>>|undefined,failed=false,stage='startup',count=0;
const browser=await chromium.launch(),shots='.local/evidence/issue47-map';
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const cam=(p:Page)=>p.evaluate(()=>{const m=/translate\((-?[\d.]+)px, ?(-?[\d.]+)px\) scale\(([\d.e-]+)\)/.exec((document.querySelector('#map .cv') as HTMLElement).style.transform)!;return {tx:+m[1]!,ty:+m[2]!,k:+m[3]!};});
// Pin screen position relative to the map viewport, from its own transform (left edge offset removed for flipped labels).
const pin=(p:Page,label:string)=>p.evaluate(l=>{const e=document.querySelector(`#map .pins [aria-label="${l}"]`) as HTMLElement;const m=/translate\((-?[\d.]+)px, ?(-?[\d.]+)px\)/.exec(e.style.transform)!;const dx=e.classList.contains('l')?-(e.offsetWidth-44):0;return {x:+m[1]!-dx,y:+m[2]!};},label);
const box=async(p:Page)=>(await p.locator('#map .mv').boundingBox())!;
const close=(a:number,b:number,eps=1.5)=>Math.abs(a-b)<=eps;
try{
 await mkdir(shots,{recursive:true});
 app=await startDevelopmentApp({built});const {origin}=app;
 for(let i=0;i<180;i++){try{if((await fetch(origin+'/ja')).status<500)break;}catch{/* starting */}await new Promise(r=>setTimeout(r,1000));}
 const external:string[]=[];
 const desk=await browser.newContext({baseURL:origin,viewport:{width:1440,height:900},reducedMotion:'reduce'}),p=await desk.newPage();
 p.on('request',r=>{const u=new URL(r.url());if(u.protocol!=='data:'&&u.protocol!=='blob:'&&u.origin!==origin)external.push(u.origin);});
 await p.goto('/ja/pickup-return');await p.locator('#map .mv').scrollIntoViewIfNeeded();await p.waitForTimeout(300);
 // A pin is where the camera puts its map point: world point = (screen − t)/k must not change under any camera move.
 const world=async(label:string)=>{const c=await cam(p),q=await pin(p,label);return {x:(q.x-c.tx)/c.k,y:(q.y-c.ty)/c.k};};
 const w0=await world('Mountain Station');

 await check('buttons: + zooms in about the centre, − zooms out, Show all restores the overview; pins stay on their map point',async()=>{
  const a=await cam(p);await p.getByRole('button',{name:'拡大'}).click();const b=await cam(p);assert.ok(b.k>a.k*1.3,'zoomed in');
  const w=await world('Mountain Station');assert.ok(close(w.x,w0.x,1)&&close(w.y,w0.y,1),'pin moved with the terrain');
  await p.getByRole('button',{name:'縮小'}).click();const c=await cam(p);assert.ok(close(c.k,a.k,1e-3),'back to the same scale');
  await p.getByRole('button',{name:'拡大'}).click();await p.getByRole('button',{name:'全体表示'}).click();const d=await cam(p);assert.ok(close(d.k,a.k,1e-3)&&close(d.tx,a.tx)&&close(d.ty,a.ty),'overview restored');
 });
 await check('wheel zooms about the cursor: the map point under the pointer does not move',async()=>{
  const r=await box(p),cx=r.x+r.width*0.3,cy=r.y+r.height*0.6;await p.mouse.move(cx,cy);const a=await cam(p);
  const under={x:(cx-r.x-a.tx)/a.k,y:(cy-r.y-a.ty)/a.k};await p.mouse.wheel(0,-240);await p.waitForTimeout(150);const b=await cam(p);
  assert.ok(b.k>a.k,'wheel up zooms in');const after={x:(cx-r.x-b.tx)/b.k,y:(cy-r.y-b.ty)/b.k};assert.ok(close(after.x,under.x,2)&&close(after.y,under.y,2),'cursor point fixed '+JSON.stringify({under,after}));
  const scrolled=await p.evaluate(()=>scrollY);await p.mouse.wheel(0,-240);assert.equal(await p.evaluate(()=>scrollY),scrolled,'wheel over the map zooms instead of scrolling the page');
  await p.getByRole('button',{name:'全体表示'}).click();
 });
 await check('mouse drag pans by exactly the drag distance (within the clamp) and pins follow',async()=>{
  await p.getByRole('button',{name:'拡大'}).click();await p.getByRole('button',{name:'拡大'}).click();const r=await box(p),a=await cam(p);
  // Drag toward the side with room so the clamp at the map edge does not cut the movement short.
  const dx=a.tx<-80?60:-60,dy=a.ty<-60?40:-40;
  await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.down();await p.mouse.move(r.x+r.width/2+dx,r.y+r.height/2+dy,{steps:8});await p.mouse.up();
  const b=await cam(p);assert.ok(close(b.tx-a.tx,dx,2)&&close(b.ty-a.ty,dy,2),'pan '+JSON.stringify({want:[dx,dy],got:[b.tx-a.tx,b.ty-a.ty],a}));assert.equal(b.k,a.k);
  const w=await world('Mountain Station');assert.ok(close(w.x,w0.x,1)&&close(w.y,w0.y,1));
 });
 await check('keyboard on the focused map: arrows pan 80px, + and − zoom, 0 returns to the overview',async()=>{
  await p.locator('#map .mv').focus();const a=await cam(p);await p.keyboard.press('ArrowRight');const b=await cam(p);assert.ok(close(b.tx,a.tx-80,1)||b.tx===a.tx,'arrow pans unless at the edge');
  await p.keyboard.press('ArrowDown');await p.keyboard.press('+');const c=await cam(p);assert.ok(c.k>b.k);await p.keyboard.press('-');assert.ok(close((await cam(p)).k,b.k,1e-3));
  await p.keyboard.press('0');const all=await cam(p);await p.getByRole('button',{name:'全体表示'}).click();assert.deepEqual(await cam(p),all);
 });
 await check('zoom limits: + is disabled at the maximum, − at the minimum; repeated presses never exceed them',async()=>{
  for(let i=0;i<12;i++){const zin=p.getByRole('button',{name:'拡大'});if(await zin.isDisabled())break;await zin.click();}
  assert.equal(await p.getByRole('button',{name:'拡大'}).isDisabled(),true);const max=(await cam(p)).k;await p.mouse.move((await box(p)).x+50,(await box(p)).y+50);await p.mouse.wheel(0,-600);assert.ok(close((await cam(p)).k,max,1e-6),'wheel cannot pass the maximum');
  for(let i=0;i<14;i++){const zo=p.getByRole('button',{name:'縮小'});if(await zo.isDisabled())break;await zo.click();}
  assert.equal(await p.getByRole('button',{name:'縮小'}).isDisabled(),true);await p.getByRole('button',{name:'全体表示'}).click();
 });
 await check('tabs and #hash deep links select a station (card + pressed tab) and frame it; a pin opens its station',async()=>{
  await p.goto('/ja/pickup-return#central');await p.waitForTimeout(300);assert.equal(await p.locator('#map .tabs button[data-v="central"]').getAttribute('aria-pressed'),'true');
  assert.equal(await p.locator('#map .panel .card[data-v="central"]').isVisible(),true);assert.equal(await p.locator('#map .panel .card[data-v="mountain"]').isVisible(),false);
  await p.locator('#map .tabs button[data-v="mountain"]').click();assert.match(p.url(),/#mountain$/);assert.equal(await p.locator('#map .panel .card[data-v="mountain"]').isVisible(),true);
  await p.locator('#map .tabs button[data-v="all"]').click();await p.locator('#map .pins [aria-label="Central Station"]').click();assert.equal(await p.locator('#map .tabs button[data-v="central"]').getAttribute('aria-pressed'),'true');
  const links=await p.locator('#map .panel .card[data-v="central"] .maps a').evaluateAll(a=>a.map(x=>(x as HTMLAnchorElement).href));assert.ok(links.some(h=>h.startsWith('https://www.google.com/maps'))&&links.some(h=>h.startsWith('https://maps.apple.com')));
  await p.screenshot({path:`${shots}/map-ja-1440.png`});
 });
 await desk.close();

 const phone=await browser.newContext({baseURL:origin,viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'}),m=await phone.newPage();
 m.on('request',r=>{const u=new URL(r.url());if(u.protocol!=='data:'&&u.protocol!=='blob:'&&u.origin!==origin)external.push(u.origin);});
 await m.goto('/en/pickup-return');await m.locator('#map .mv').scrollIntoViewIfNeeded();await m.waitForTimeout(300);
 const cdp=await phone.newCDPSession(m);const touch=(type:'touchStart'|'touchMove'|'touchEnd',points:{x:number;y:number}[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map((q,i)=>({x:q.x,y:q.y,id:i}))});
 await check('phone: a one-finger vertical swipe on the map scrolls the page and does not move the map',async()=>{
  const r=(await m.locator('#map .mv').boundingBox())!,a=await cam(m),y0=await m.evaluate(()=>scrollY),x=r.x+r.width/2,y=r.y+r.height*0.7;
  await touch('touchStart',[{x,y}]);for(let i=1;i<=8;i++)await touch('touchMove',[{x,y:y-i*25}]);await touch('touchEnd',[]);await m.waitForTimeout(400);
  assert.ok(await m.evaluate(()=>scrollY)>y0,'page scrolled');assert.deepEqual(await cam(m),a,'map camera unchanged by one finger');
 });
 await check('phone: a two-finger pinch zooms the map and pins stay on their map point; no horizontal page scroll',async()=>{
  await m.locator('#map .mv').scrollIntoViewIfNeeded();const r=(await m.locator('#map .mv').boundingBox())!,a=await cam(m),cx=r.x+r.width/2,cy=r.y+r.height/2;
  const wb=await m.evaluate(()=>0);void wb;const before=await (async()=>{const q=await pin(m,'Mountain Station');return {x:(q.x-a.tx)/a.k,y:(q.y-a.ty)/a.k};})();
  await touch('touchStart',[{x:cx-30,y:cy},{x:cx+30,y:cy}]);for(let i=1;i<=8;i++)await touch('touchMove',[{x:cx-30-i*10,y:cy},{x:cx+30+i*10,y:cy}]);await touch('touchEnd',[]);await m.waitForTimeout(200);
  const b=await cam(m);assert.ok(b.k>a.k*1.5,'pinch zoomed '+JSON.stringify({a:a.k,b:b.k}));
  const q=await pin(m,'Mountain Station');const after={x:(q.x-b.tx)/b.k,y:(q.y-b.ty)/b.k};assert.ok(close(after.x,before.x,1)&&close(after.y,before.y,1),'pin in step');
  assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await m.screenshot({path:`${shots}/map-en-390-pinched.png`});
 });
 await phone.close();
 assert.deepEqual([...new Set(external)],[],'no external request');
 console.log(JSON.stringify({status:'PASS',cases:count,externalRequests:0,screenshots:shots}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,message:(e as Error).message?.slice(0,600)}));}
finally{await browser.close();await app?.stop();}
if(failed)process.exitCode=1;
