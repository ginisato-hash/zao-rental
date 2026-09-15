import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyR15OperationManifest} from '../../scripts/r15-operation-manifest';
import {dispatchR15Once} from '../../packages/db/src/r15-operation-guard';

const original=JSON.stringify({operationId:'synthetic-only',amountJpy:100,currency:'JPY'})+'\n';
const hash=createHash('sha256').update(original).digest('hex');
for(const mode of ['matching','tampered-file','wrong-hash','missing-file','invalid-hash'] as const)test('R15 manifest source '+mode,async()=>{
  const root=await mkdtemp(join(tmpdir(),'r15-manifest-'));
  try{
    const dir=join(root,'docs/execution/p6/r15-evidence');await mkdir(dir,{recursive:true});
    if(mode!=='missing-file')await writeFile(join(dir,'payment-operation-manifest.json'),mode==='tampered-file'?original.replace('100','101'):original);
    let connections=0,sends=0;
    const pool={async connect(){connections++;throw Error('FAKE_DB_BOUNDARY');}};
    const expected=mode==='wrong-hash'?'a'.repeat(64):mode==='invalid-hash'?'invalid':hash;
    const call=async()=>{
      const verified=await verifyR15OperationManifest(expected,root);
      return dispatchR15Once(pool,{manifestSha256:verified,action:'CREATE_PAYMENT',bookingId:'fixture',attemptId:'fixture',idempotencyKey:'fixture',locationId:'fixture',paymentId:null},async()=>{sends++;});
    };
    if(mode==='matching'){
      assert.equal(await verifyR15OperationManifest(hash,root),hash);
      await assert.rejects(call(),/R15_GUARD_UNAVAILABLE_DO_NOT_RETRY/);assert.equal(connections,1);
    }else{
      await assert.rejects(call(),/R15_OPERATION_MANIFEST_SOURCE_MISMATCH/);assert.equal(connections,0);
    }
    assert.equal(sends,0);
  }finally{await rm(root,{recursive:true,force:true});}
});
