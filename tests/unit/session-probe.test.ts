import test from 'node:test';
import assert from 'node:assert/strict';
import {probeSession,SESSION_PROBE_JOIN_MS,bumpSessionEpoch,classifyProbe,reconnectDelay,RECONNECT_DELAYS_MS,endViewIfSessionIs,PROBE_TIMEOUT_MS} from '../../apps/web/src/components/StaffSessionBoundary';
// Concurrent identical /api/session probes collapse into one request; there is no cache, so later probes ask again.
function stub(){const calls:number[]=[];const releases:(()=>void)[]=[];let fail=false;
 (globalThis as {fetch:unknown}).fetch=()=>{calls.push(Date.now());const n=calls.length;return new Promise((resolve,reject)=>{releases.push(()=>fail?reject(new Error('net')):resolve({ok:true,json:async()=>({stamp:'s'+n})}));});};
 return {calls,finish:()=>{while(releases.length)releases.shift()!();},failNext:()=>{fail=true;}};}
test('probes started together share one request and one answer',async()=>{
 const s=stub();let t=1000;const now=()=>t;
 const a=probeSession(now),b=probeSession(now);t+=SESSION_PROBE_JOIN_MS-1;const c=probeSession(now);s.finish();
 const [x,y,z]=await Promise.all([a,b,c]);assert.equal(s.calls.length,1);assert.deepEqual(x,y);assert.deepEqual(y,z);assert.equal(x.body.stamp,'s1');
});
test('a probe that starts later asks the server again and is never served an old answer',async()=>{
 const s=stub();let t=5000;const now=()=>t;
 const first=probeSession(now);s.finish();await first;
 t+=1;const second=probeSession(now);s.finish();const r=await second;assert.equal(s.calls.length,2,'after the first answer arrived nothing is reused');assert.equal(r.body.stamp,'s2');
 t+=SESSION_PROBE_JOIN_MS+5;const slow=probeSession(now);t+=SESSION_PROBE_JOIN_MS+1;const late=probeSession(now);s.finish();await Promise.all([slow,late]);
 assert.equal(s.calls.length,4,'a probe starting after the join window opens its own request');
});
test('a failed probe rejects every joined caller and does not poison the next one',async()=>{
 const s=stub();let t=9000;const now=()=>t;s.failNext();
 const a=probeSession(now),b=probeSession(now);s.finish();await assert.rejects(a);await assert.rejects(b);
 (globalThis as {fetch:unknown}).fetch=()=>Promise.resolve({ok:true,json:async()=>({stamp:'ok'})});t+=SESSION_PROBE_JOIN_MS+1;
 assert.equal((await probeSession(now)).body.stamp,'ok');
});

const ans=(status:number,body:{status?:string;stamp?:string})=>({ok:status>=200&&status<300,status,body});
test('only an explicit invalid-session answer ends a screen; every transient failure is TRANSIENT (8-hour session is never ended by a blip)',()=>{
 assert.equal(classifyProbe(ans(200,{status:'authorized',stamp:'s'}),'s'),'MATCH');
 assert.equal(classifyProbe(ans(200,{status:'authorized',stamp:'other'}),'s'),'CHANGED','another account / changed permissions');
 assert.equal(classifyProbe(ans(401,{status:'anonymous'}),'s'),'ENDED');
 assert.equal(classifyProbe(ans(403,{status:'disabled'}),'s'),'ENDED');assert.equal(classifyProbe(ans(403,{status:'unregistered'}),'s'),'ENDED');
 for(const st of [500,502,503,504,429,408,0])assert.equal(classifyProbe(ans(st,{}),'s'),'TRANSIENT','status '+st);
 assert.equal(classifyProbe(ans(401,{}),'s'),'TRANSIENT','a 401 that is not the session endpoint answer (proxy, gateway) proves nothing');
 assert.equal(classifyProbe(ans(403,{status:'authorized'}),'s'),'TRANSIENT');
 assert.equal(classifyProbe(ans(200,{}),'s'),'TRANSIENT','a 200 without a stamp is not a verification');
 assert.equal(classifyProbe(null,'s'),'TRANSIENT');
});
test('reconnect backoff is bounded and never terminal',()=>{
 assert.equal(reconnectDelay(0),RECONNECT_DELAYS_MS[0]);assert.equal(reconnectDelay(1000),RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length-1]);assert.ok(reconnectDelay(1000)<=30000);assert.equal(reconnectDelay(-5),RECONNECT_DELAYS_MS[0]);
});
test('an auth-state change (epoch bump) is never answered with a probe that left before it',async()=>{
 const s=stub();let t=20000;const now=()=>t;
 const before=probeSession(now);bumpSessionEpoch();t+=1;const after=probeSession(now);s.finish();
 const [x,y]=await Promise.all([before,after]);assert.equal(s.calls.length,2,'the later check made its own request');assert.notEqual(x.body.stamp,y.body.stamp);
 const j1=probeSession(now);const j2=probeSession(now);s.finish();await Promise.all([j1,j2]);assert.equal(s.calls.length,3,'probes of the same epoch still collapse');
});

function fakeWindow(){const events:string[]=[];(globalThis as {window:unknown}).window={dispatchEvent:(e:{type:string})=>{events.push(e.type);return true;}};return events;}
test('a 401 verdict for an OLD auth state never closes the screen of a newer valid session (A pending -> B signs in -> stale ENDED arrives)',async()=>{
 const events=fakeWindow();let release:(v:unknown)=>void=()=>{};
 (globalThis as {fetch:unknown}).fetch=()=>new Promise(res=>{release=res;});
 const pending=endViewIfSessionIs('A');
 bumpSessionEpoch(); // another tab signed in as B while the old probe is in flight
 release({ok:false,status:401,json:async()=>({status:'anonymous'})});await pending;
 assert.deepEqual(events,['zao-auth-recheck'],'re-verify, never end');
});
test('a 401 verdict in the SAME auth state still ends the screen (real expiry/sign-out)',async()=>{
 const events=fakeWindow();
 (globalThis as {fetch:unknown}).fetch=()=>Promise.resolve({ok:false,status:401,json:async()=>({status:'anonymous'})});
 await new Promise(r=>setTimeout(r,SESSION_PROBE_JOIN_MS+5));await endViewIfSessionIs('A');
 assert.deepEqual(events,['zao-auth-ended']);
});
test('transient probe failures and a different valid session never end the screen from endViewIfSessionIs',async()=>{
 for(const [name,fetcher,expected] of [
  ['network error',()=>Promise.reject(new Error('net')),['zao-auth-recheck']],
  ['503',()=>Promise.resolve({ok:false,status:503,json:async()=>({})}),['zao-auth-recheck']],
  ['another valid session',()=>Promise.resolve({ok:true,status:200,json:async()=>({status:'authorized',stamp:'B'})}),[]],
 ] as const){const events=fakeWindow();(globalThis as {fetch:unknown}).fetch=fetcher;bumpSessionEpoch();await endViewIfSessionIs('A');assert.deepEqual(events,expected,name);}
});
test('a probe that never answers is aborted after PROBE_TIMEOUT_MS and is a transient failure (cannot hang a check forever)',async()=>{
 assert.ok(PROBE_TIMEOUT_MS>=3000&&PROBE_TIMEOUT_MS<=30000);
 let signal:AbortSignal|undefined;
 (globalThis as {fetch:unknown}).fetch=(_u:string,init:{signal?:AbortSignal})=>new Promise((_res,rej)=>{signal=init.signal;init.signal?.addEventListener('abort',()=>rej(new Error('aborted')));});
 bumpSessionEpoch();await new Promise(r=>setTimeout(r,SESSION_PROBE_JOIN_MS+5));
 const realSetTimeout=globalThis.setTimeout;(globalThis as {setTimeout:unknown}).setTimeout=((fn:()=>void,ms?:number)=>realSetTimeout(fn,ms===PROBE_TIMEOUT_MS?5:ms)) as typeof setTimeout;
 try{await assert.rejects(probeSession());assert.equal(signal?.aborted,true);}finally{(globalThis as {setTimeout:unknown}).setTimeout=realSetTimeout;}
});
