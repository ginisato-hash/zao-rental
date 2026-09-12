import test from 'node:test';
import assert from 'node:assert/strict';
import {LedgerService} from '../../packages/core/src/catalog/ledger-service';
test('missing or invalid server write authorizer fails closed before any database access',()=>{
 const pool=new Proxy({},{get(){throw new Error('DATABASE_MUST_NOT_BE_TOUCHED');}});
 const principal={subject:'synthetic-config-test',role:'ADMIN',storeIds:['MOUNTAIN_BASE']};
 for(const callback of [undefined,null,false])assert.throws(()=>Reflect.construct(LedgerService,[pool,principal,callback]),{code:'WRITE_AUTHORITY_NOT_CONFIGURED'});
});
