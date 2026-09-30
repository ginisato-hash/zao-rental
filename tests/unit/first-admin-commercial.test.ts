import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {firstAdminCommercialSafeError} from '../../scripts/lib/first-admin-commercial';
test('commercial completion has no permission, identity or password arguments and redacts failures',()=>{
 const secret=randomBytes(32).toString('base64url');
 for(const args of [['--permission','QUOTE_VIEW'],['--input','/unused'],['--password',secret]]){
  const r=spawnSync(process.execPath,['--import','tsx','scripts/production-complete-first-admin-commercial.ts',...args],{encoding:'utf8',env:{...process.env,PRODUCTION_STAFF_BOOTSTRAP_DATABASE_URL:secret}});
  assert.equal(r.status,1);assert.equal(r.stdout,'');assert.deepEqual(JSON.parse(r.stderr),{status:'STOP',code:'PRODUCTION_STAFF_BOOTSTRAP_ARGUMENTS_REJECTED'});assert.ok(!(r.stdout+r.stderr).includes(secret));
 }
 assert.equal(firstAdminCommercialSafeError(Error('driver '+secret)),'PRODUCTION_FIRST_ADMIN_PERMISSION_OPERATION_FAILED');
 for(const code of ['RECONCILIATION_REQUIRED','COMMITTED_READBACK_REQUIRED','COMMIT_UNKNOWN_READBACK_REQUIRED'])assert.equal(firstAdminCommercialSafeError(Error('PRODUCTION_FIRST_ADMIN_PERMISSION_'+code)),'PRODUCTION_FIRST_ADMIN_PERMISSION_'+code);
});
