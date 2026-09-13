import assert from 'node:assert/strict';
import {flowFixture} from '../flow/fixture';
const x=await flowFixture();let failed=false;
try{
 const boundary=(await x.db.pool.query("SELECT to_regprocedure('public.rental_apply_receipt(uuid)') IS NOT NULL AS present")).rows[0].present;
 assert.equal(boundary,true,'REQUIRED_COUNTEREXAMPLE: authenticated custody cannot apply a receipt; approved receipt-only boundary is absent');
 console.log('PASS approved receipt-only boundary exists in migrated real PostgreSQL');
}catch(e){failed=true;console.error(e instanceof assert.AssertionError?e.message:'CUSTODY_COUNTEREXAMPLE_FAILED');}finally{await x.close();console.log('Owned counterexample database stopped.');}if(failed)process.exit(1);
