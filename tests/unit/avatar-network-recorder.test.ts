import test from 'node:test';
import assert from 'node:assert/strict';
import {SafeNetworkRecorder,safeNetworkMetadata} from '../avatar/safe-network-recorder';
import {safeInitiator} from '../avatar/phase7-network-observer';
const origin='https://preview.example.test';
for(const [name,url,secret]of [
  ['path','https://external.example.test/private-path-sentinel','private-path-sentinel'],
  ['query','https://external.example.test/?token=query-sentinel','query-sentinel'],
  ['fragment','https://external.example.test/#fragment-sentinel','fragment-sentinel'],
  ['signed URL','https://external.example.test/asset?X-Amz-Signature=signed-sentinel&X-Amz-Credential=credential-sentinel','sentinel'],
  ['userinfo','https://user-sentinel:password-sentinel@external.example.test/','sentinel'],
])test('recorder never retains '+name,()=>{const r=new SafeNetworkRecorder(origin);r.record({url:url!,resourceType:'fetch'});assert.ok(!JSON.stringify(r.snapshot()).includes(secret!));assert.equal(r.snapshot().length,1);});
for(const key of ['headers','cookie','authorization','body','postData','stack','requestId','sessionId'])test('recorder does not inspect or serialize '+key,()=>{
  const input={url:'https://external.example.test/',resourceType:'fetch'};Object.defineProperty(input,key,{enumerable:true,get(){throw Error('forbidden field read');}});
  const r=new SafeNetworkRecorder(origin);r.record(input);assert.ok(!JSON.stringify(r.snapshot()).includes(key));
});
test('extension records omit ID and every URL component',()=>{for(const scheme of ['chrome-extension','moz-extension','safari-web-extension'])assert.deepEqual(safeNetworkMetadata(origin,{url:scheme+'://extension-id-sentinel/secret?token=sentinel',resourceType:'script'}),{classification:'BROWSER_EXTENSION',count:1});});
test('same origin includes scheme and normalized port',()=>{
  const r=safeNetworkMetadata(origin,{url:origin+':443/path'});assert.ok('sameOrigin'in r&&r.sameOrigin);assert.ok('port'in r&&r.port===443);
  for(const url of ['http://preview.example.test/','https://preview.example.test:8443/','https://preview.example.test.attacker.invalid/']){const other=safeNetworkMetadata(origin,{url});assert.ok('sameOrigin'in other&&!other.sameOrigin&&other.blocked);}
});
test('duplicates aggregate across paths queries and fragments without retaining them',()=>{
  const r=new SafeNetworkRecorder(origin);for(const suffix of ['/one?secret=a','/two#secret-b','/three'])r.record({url:'https://external.example.test'+suffix,resourceType:'script',initiatorType:'parser'});
  assert.equal(r.snapshot().length,1);assert.equal(r.snapshot()[0]?.count,3);const snapshot=r.snapshot();snapshot[0]!.count=99;assert.equal(r.snapshot()[0]?.count,3);
});
test('untrusted classification fields and malformed URLs cannot become evidence',()=>{
  for(const url of ['not a URL secret-sentinel','data:text/plain,secret-sentinel','blob:https://preview.example.test/secret-sentinel','custom-secret-sentinel://id/']){const r=safeNetworkMetadata(origin,{url,resourceType:'type-secret-sentinel',initiatorType:'secret-sentinel',initiatorSource:'secret-sentinel'});assert.ok(!JSON.stringify(r).includes('sentinel'));}
});
test('only allowlisted metadata keys are serializable',()=>{
  assert.deepEqual(Object.keys(safeNetworkMetadata(origin,{url:'https://external.example.test/path'})).sort(),['scheme','hostname','port','resourceType','initiatorType','initiatorSource','sameOrigin','classification','blocked','count'].sort());
});
test('CDP initiator stack is reduced to enums without URL or script identifiers',()=>{
  const input={type:'script',stack:{callFrames:[{url:origin+'/_next/static/secret-sentinel.js?token=sentinel',scriptId:'sentinel',lineNumber:123,columnNumber:456}]}};
  assert.deepEqual(safeInitiator(origin,input),{initiatorType:'script',initiatorSource:'APP_SCRIPT'});
  assert.deepEqual(safeInitiator(origin,{type:'secret-sentinel',stack:{callFrames:[{url:'chrome-extension://extension-id-sentinel/script.js'}]}}),{initiatorType:'unknown',initiatorSource:'BROWSER_INTERNAL'});
  assert.deepEqual(safeInitiator(origin,{type:'script',stack:{callFrames:[{url:'https://vercel.live/example'}]}}),{initiatorType:'script',initiatorSource:'UNKNOWN'});
});
