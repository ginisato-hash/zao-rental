import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInput,ledgerAccess,validateFilters,LedgerError} from '../../packages/contracts/src/ledger';
import {SAMPLE} from '../fixtures/ledger-sample';
import {ledgerHandler} from '../../apps/web/src/lib/ledger-http';
test('strict ledger contract rejects authority/identity/transfer fields and stock-as-availability assumptions',()=>{
  for(const [resource,entries] of Object.entries(SAMPLE))for(const entry of entries)assert.ok(parseInput(resource as keyof typeof SAMPLE,'create',entry.data));
  for(const field of ['id','admin','available','labelCopies','initialStoreId','price','din'])assert.throws(()=>parseInput('assets','create',{...SAMPLE.assets[0].data,[field]:true}),LedgerError);
  for(const patch of [{version:1,reason:'test'},{version:1,reason:'test',storeId:'ONSEN_BASE'},{version:1,reason:'test',tier:'PREMIUM'}])assert.throws(()=>parseInput('assets','update',patch),LedgerError);
  assert.throws(()=>parseInput('poles','create',{...SAMPLE.poles[0].data,quantity:-1}),LedgerError);
  assert.throws(()=>parseInput('poles','create',{...SAMPLE.poles[0].data,quantity:1.5}),LedgerError);
});
test('role and store scope are both required; no implicit global administrator',()=>{
  assert.throws(()=>ledgerAccess(null),{code:'AUTHENTICATION_REQUIRED'});
  assert.throws(()=>ledgerAccess({subject:'admin',role:'ADMIN'}),{code:'STORE_SCOPE_REQUIRED'});
  assert.throws(()=>ledgerAccess({subject:'staff',role:'STAFF',storeIds:['MOUNTAIN_BASE']},true),{code:'FORBIDDEN'});
  assert.throws(()=>ledgerAccess({subject:'invalid.subject',role:'ADMIN',storeIds:['MOUNTAIN_BASE']}),{code:'FORBIDDEN'});
});
test('filters are finite and do not silently widen a miss across age/tier',()=>{
  for(const bad of [{storeId:'ALL'},{age:'ANY'},{tier:'PREMIUM_OR_REGULAR'},{offset:-1},{offset:'0'},{q:' '},{available:true}])assert.throws(()=>validateFilters(bad as never),LedgerError);
  validateFilters({storeId:'MOUNTAIN_BASE',age:'KIDS',tier:'REGULAR',size:'100 cm',status:'UNVERIFIED'});
});
test('anonymous and insufficient-role HTTP calls never construct storage or trust headers',async()=>{
  let calls=0;const storage=()=>{calls++;throw new Error('must not access DB');};
  const request=()=>new Request('http://localhost/api/ledger/assets',{method:'POST',headers:{'x-role':'ADMIN','cookie':'role=ADMIN','content-type':'application/json','origin':'http://localhost'},body:'{}'});
  assert.equal((await ledgerHandler(async()=>null,storage)(request())).status,401);
  assert.equal((await ledgerHandler(async()=>({subject:'staff',role:'STAFF',storeIds:['MOUNTAIN_BASE']}),storage)(request())).status,403);assert.equal(calls,0);
});
