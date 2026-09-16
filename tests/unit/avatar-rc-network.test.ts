import test from 'node:test';
import assert from 'node:assert/strict';
import {rcNetworkMetadata} from '../avatar/phase7b-network-observer';
const origin='https://preview.example';
test('RC recorder separates same-origin APP from the observed official Toolbar script',()=>{
 assert.equal(rcNetworkMetadata(origin,{url:origin+'/private?token=hidden',resourceType:'fetch'}).classification,'APP');
 assert.equal(rcNetworkMetadata(origin,{url:'https://vercel.live/hidden?secret=hidden',resourceType:'script'}).classification,'PLATFORM_PROVIDER');
});
test('app-initiated provider traffic remains APP, never a provider exemption',()=>{
 assert.equal(rcNetworkMetadata(origin,{url:'https://vercel.live/x',resourceType:'script',initiatorSource:'APP_SCRIPT'}).classification,'APP');
});
test('unobserved provider hosts, ports, schemes and resource types remain UNKNOWN',()=>{
 for(const url of ['http://vercel.live/x','https://vercel.live:8443/x','https://evil.vercel.live/x','https://vercel.com/x','https://unrelated.example/x'])assert.equal(rcNetworkMetadata(origin,{url,resourceType:'script'}).classification,'UNKNOWN');
 assert.equal(rcNetworkMetadata(origin,{url:'https://vercel.live/x',resourceType:'fetch'}).classification,'UNKNOWN');
});
test('RC recorder removes extension identities, paths, queries, fragments and extra data',()=>{
 assert.deepEqual(rcNetworkMetadata(origin,{url:'chrome-extension://secret-id/private?token=secret'}),{classification:'BROWSER_INTERNAL',count:1});
 const input={url:'https://preview.example/private?token=secret#secret',resourceType:'fetch'};
 for(const key of ['headers','cookies','authorization','body','postData','stack','sessionId'])Object.defineProperty(input,key,{get(){throw Error('forbidden read');}});
 const safe=rcNetworkMetadata(origin,input);assert.doesNotMatch(JSON.stringify(safe),/private|token|secret|headers|cookies|authorization|postData|stack|sessionId/);
 assert.deepEqual(Object.keys(safe).sort(),['scheme','hostname','port','resourceType','initiatorClass','sameOrigin','classification','count'].sort());
});
