import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guestPeerKey} from '../../packages/core/src/guest/security';
import {canonicalPeer} from '../../packages/core/src/guest/trusted-ingress';
import {HoldError} from '../../packages/contracts/src/hold';
import {guestHandler} from '../../apps/web/src/lib/guest-http';
import {bookingAccessHandler} from '../../apps/web/src/lib/booking-access-http';
const key='synthetic-test-key-at-least-32-characters',origin='https://fixture.invalid';
const peer=(address:string)=>guestPeerKey(canonicalPeer(address),key);
test('guest peer key groups IPv6 by /64 and leaves IPv4 per address',()=>{
 assert.equal(peer('2001:db8:1:2::1'),peer('2001:db8:1:2:ffff:ffff:ffff:ffff'));
 assert.equal(peer('2001:db8:1:2::1'),peer('2001:0DB8:0001:0002:0:0:0:abcd'));
 assert.notEqual(peer('2001:db8:1:2::1'),peer('2001:db8:1:3::1'));
 assert.equal(peer('::1'),peer('::2'));
 assert.notEqual(peer('192.0.2.10'),peer('192.0.2.11'));
 assert.equal(peer('::ffff:192.0.2.10'),peer('192.0.2.10'));
 assert.notEqual(peer('::ffff:192.0.2.10'),peer('::ffff:192.0.2.11'));
});
test('guest API charges the global budget only for anonymous entry (new context, recovery)',async()=>{
 const calls:{path:string;entry:boolean}[]=[];let path='';
 const security={service:{policy:{windowSeconds:60},guard:async(_peer:string|undefined,o?:{entry?:boolean})=>{calls.push({path,entry:o?.entry===true});throw new HoldError('GUEST_RATE_LIMITED',429);}},peer:()=>'a'.repeat(64)};
 const api=guestHandler({} as never,()=>{throw new Error('not reached');},origin,false,security as never);
 for(const [method,p] of [['POST','/context'],['POST','/recover'],['GET','/draft'],['GET','/options'],['POST','/draft'],['POST','/preview'],['POST','/recovery-code'],['POST','/prepare-payment']] as const){
  path=method+' '+p;const r=await api(new Request(origin+'/api/guest'+p,{method,headers:{origin},...(method==='POST'?{body:'{}'}:{})}));assert.equal(r.status,429);
 }
 assert.deepEqual(calls.filter(c=>c.entry).map(c=>c.path),['POST /context','POST /recover']);
 assert.equal(calls.length,8);
});
test('booking access charges the global budget only for the anonymous recovery flow',async()=>{
 const calls:{path:string;entry:boolean}[]=[];let path='';
 const api=bookingAccessHandler({} as never,{} as never,origin,async(_r,o)=>{calls.push({path,entry:o?.entry===true});throw new HoldError('GUEST_RATE_LIMITED',429);},{} as never);
 for(const [method,p] of [['GET',''],['POST','/cancel'],['POST','/cancellation-preview'],['POST','/issue'],['POST','/recovery/request'],['POST','/recovery/prepare'],['POST','/recovery/exchange']] as const){
  path=method+' '+p;const r=await api(new Request(origin+'/api/booking-access'+p,{method,headers:{origin},...(method==='POST'?{body:'{}'}:{})}));assert.equal(r.status,429);
 }
 assert.deepEqual(calls.filter(c=>c.entry).map(c=>c.path),['POST /recovery/request','POST /recovery/prepare','POST /recovery/exchange']);
 assert.equal(calls.length,7);
});
