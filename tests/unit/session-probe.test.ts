import test from 'node:test';
import assert from 'node:assert/strict';
import {probeSession,SESSION_PROBE_JOIN_MS} from '../../apps/web/src/components/StaffSessionBoundary';
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
