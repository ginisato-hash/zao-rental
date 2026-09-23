import test from 'node:test';
import assert from 'node:assert/strict';
import {fingerprintDelta,deltaMismatch} from '../../scripts/production-bootstrap';

test('fingerprintDelta uses multiset semantics and a deterministic digest',()=>{
 const d=fingerprintDelta({material:{a:['x','x','y'],b:['q']}},{material:{a:['z','x'],c:['n']}});
 assert.deepEqual(d.categories,{a:{added:['z'],removed:['x','y']},b:{added:[],removed:['q']},c:{added:['n'],removed:[]}});
 assert.equal(fingerprintDelta({material:{b:['q'],a:['y','x','x']}},{material:{c:['n'],a:['x','z']}}).sha256,d.sha256);
 assert.deepEqual(fingerprintDelta({material:{a:['r','r']}},{material:{a:['r']}}).categories.a,{added:[],removed:['r']});
});
test('an unchanged baseline cancels out, while any change on either side is reported by category',()=>{
 const base=['provider-role','provider-grant'];
 const canonical=fingerprintDelta({material:{roles:[],tables:[]}},{material:{roles:['app'],tables:['t']}});
 const provider=fingerprintDelta({material:{roles:[...base],tables:[]}},{material:{roles:[...base,'app'],tables:['t']}});
 assert.deepEqual(deltaMismatch(canonical,provider),[]);assert.equal(canonical.sha256,provider.sha256);
 const baselineChanged=fingerprintDelta({material:{roles:[...base],tables:[]}},{material:{roles:['provider-role','app'],tables:['t']}});
 assert.deepEqual(deltaMismatch(canonical,baselineChanged),['roles']);
 const extra=fingerprintDelta({material:{roles:[],tables:[]}},{material:{roles:['app','intruder'],tables:['t']}});
 assert.deepEqual(deltaMismatch(canonical,extra),['roles']);
});
