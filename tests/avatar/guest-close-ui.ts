import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {closeGuestAndAwaitLogout} from './guest-close';

// AVATAR-CI-01 counterexamples for closeGuestAndAwaitLogout, on a synthetic page served by page.route (no network, no app).
// The page mimics the guest footer: a close button that is disabled while busy, posts /api/guest/logout and navigates.
const ORIGIN='http://guest-close.test';
const PAGE=(busyMs:number)=>`<!doctype html><meta charset="utf-8"><button id="close" ${busyMs?'disabled':''}>この予約画面を閉じる</button>
<script>const b=document.getElementById('close');window.posts=0;
${busyMs?`setTimeout(()=>{b.disabled=false;},${busyMs});`:''}
b.addEventListener('click',async()=>{if(b.disabled)return;b.disabled=true;window.posts++;const r=await fetch('/api/guest/logout',{method:'POST',body:'{}'});if(r.ok)location.assign('/ja');});</script>`;
const browser=await chromium.launch();let failed=false,stage='start',count=0;
async function check(name:string,fn:(p:import('@playwright/test').Page,posts:()=>number)=>Promise<void>,busyMs:number,answer:(r:import('@playwright/test').Route)=>Promise<void>){
 stage=name;const ctx=await browser.newContext(),p=await ctx.newPage();let posts=0;
 await p.route(ORIGIN+'/**',async r=>{const u=new URL(r.request().url());
  if(u.pathname==='/api/guest/logout'){posts++;return answer(r);}
  if(u.pathname==='/ja')return r.fulfill({contentType:'text/html',body:'<!doctype html><title>ja</title><p>トップ</p>'});
  return r.fulfill({contentType:'text/html',body:PAGE(busyMs)});});
 await p.goto(ORIGIN+'/book');await fn(p,()=>posts);await ctx.close();count++;console.log('PASS '+name);
}
try{
 await check('busy then enabled: waits for the button, one POST, 200, navigation',async(p,posts)=>{
  const r=await closeGuestAndAwaitLogout(p,p.getByRole('button',{name:'この予約画面を閉じる'}),{answerMs:5000});assert.equal(r.status(),200);
  await p.waitForURL(ORIGIN+'/ja');assert.equal(posts(),1);},1200,r=>r.fulfill({status:200,json:{ok:true}}));
 await check('immediate 200 and immediate navigation: the answer is not missed and there is no second click',async(p,posts)=>{
  const r=await closeGuestAndAwaitLogout(p,p.getByRole('button',{name:'この予約画面を閉じる'}),{answerMs:5000});assert.equal(r.status(),200);
  await p.waitForURL(ORIGIN+'/ja');assert.equal(posts(),1,'exactly one logout');},0,r=>r.fulfill({status:200,json:{ok:true}}));
 await check('delayed 200 (longer than the observe window): no re-send, the same request’s answer is awaited',async(p,posts)=>{
  const r=await closeGuestAndAwaitLogout(p,p.getByRole('button',{name:'この予約画面を閉じる'}),{observeMs:300,answerMs:8000});assert.equal(r.status(),200);
  await p.waitForURL(ORIGIN+'/ja');assert.equal(posts(),1,'no second logout while the first is pending');},0,async r=>{await new Promise(f=>setTimeout(f,2500));await r.fulfill({status:200,json:{ok:true}});});
 await check('no logout at all (button never enabled): fails closed with the reason, no POST',async(p,posts)=>{
  await assert.rejects(closeGuestAndAwaitLogout(p,p.getByRole('button',{name:'この予約画面を閉じる'}),{attempts:2,observeMs:200,answerMs:1500}),/disabled|Timeout|never/i);
  assert.equal(posts(),0);},600000,r=>r.fulfill({status:200,json:{ok:true}}));
 await check('POST issued but no answer: fails closed with the reason, still exactly one POST',async(p,posts)=>{
  await assert.rejects(closeGuestAndAwaitLogout(p,p.getByRole('button',{name:'この予約画面を閉じる'}),{observeMs:300,answerMs:1500}),/no answer/);
  assert.equal(posts(),1);},0,async()=>{await new Promise(f=>setTimeout(f,4000));});
 console.log(JSON.stringify({status:'PASS',cases:count,externalRequests:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,message:(e as Error).message?.slice(0,500)}));}
finally{await browser.close();}
if(failed)process.exitCode=1;
