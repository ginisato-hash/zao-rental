import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

/** Verify the actual committed manifest bytes before installing its DB row or
 * invoking any R15 dispatch. The caller must use this returned hash, not a copy.
 * Commit/push/readback remains the operator's prerequisite for external dispatch.
 */
export async function verifyR15OperationManifest(expectedSha256:string,root=process.cwd()):Promise<string>{
  try{
    if(!/^[a-f0-9]{64}$/.test(expectedSha256))throw Error();
    const bytes=await readFile(resolve(root,'docs/execution/p6/r15-evidence/payment-operation-manifest.json'));
    const actual=createHash('sha256').update(bytes).digest('hex');
    if(actual!==expectedSha256)throw Error();
    return actual;
  }catch{throw new Error('R15_OPERATION_MANIFEST_SOURCE_MISMATCH');}
}
