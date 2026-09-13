import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequestPeerBoundary} from '../../packages/core/src/guest/request-peer-boundary';
import {canonicalPeer,trustedGuestPeer} from '../../packages/core/src/guest/trusted-ingress';
test('P5 dispatcher fixture: forged headers cannot bind a Request/clone; explicit metadata only',()=>{
 const b=createRequestPeerBoundary('vercel-direct-fixture'),peer=trustedGuestPeer(b.adapter,b.adapter.id,'synthetic-test-key-at-least-32-characters');
 const r=new Request('https://fixture.invalid',{headers:{'x-forwarded-for':'192.0.2.1','x-vercel-forwarded-for':'192.0.2.2','x-real-ip':'192.0.2.3','x-vercel-id':'fake'}});
 assert.throws(()=>peer(r),{code:'TRUSTED_INGRESS_REQUIRED'});b.bind(r,{adapterId:b.adapter.id,address:'::ffff:192.0.2.10'});const clone=r.clone();assert.throws(()=>peer(clone),{code:'TRUSTED_INGRESS_REQUIRED'});
 b.bind(clone,{adapterId:b.adapter.id,address:'192.0.2.10'});assert.equal(peer(r),peer(clone));r.headers.set('x-forwarded-for','203.0.113.20');assert.equal(peer(r),peer(clone));
 assert.throws(()=>b.bind(r,{adapterId:b.adapter.id,address:'192.0.2.11'}),{code:'TRUSTED_INGRESS_REBIND_REJECTED'});assert.throws(()=>b.bind(new Request(r),{adapterId:'wrong',address:'192.0.2.10'}),{code:'TRUSTED_INGRESS_REQUIRED'});
});
test('P5 canonical peer: IPv4/mapped/IPv6 representations, no lists/zone/padded or unknown peers',()=>{
 for(const ip of ['192.0.2.10','::ffff:192.0.2.10','0:0:0:0:0:ffff:c000:020a'])assert.equal(canonicalPeer(ip),'192.0.2.10');
 assert.equal(canonicalPeer('2001:0DB8:0000:0:0:0:0:1'),'2001:db8::1');
 for(const ip of ['192.0.2.1, 192.0.2.2',' 192.0.2.1','fe80::1%en0','unknown','192.000.2.1',''])assert.throws(()=>canonicalPeer(ip),{code:'TRUSTED_INGRESS_REQUIRED'});
});
