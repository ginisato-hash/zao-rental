import {open} from 'node:fs/promises';
import {dirname} from 'node:path';
/** R9 controlled operator guard, deliberately independent of the old P4 journal.
 * Exclusive reservation is never removed, even if send fails or the process dies.
 * Not a distributed server guarantee; immutable Square idempotency is separate. */
export async function dispatchS2Once(path,identity,send){
 if(!identity||!Object.values(identity).every(v=>typeof v==='string'&&v.length>0)||typeof send!=='function')throw new Error('S2_GUARD_INVALID');
 const f=await open(path,'wx',0o600);
 try{await f.writeFile(JSON.stringify({state:'RESERVED_POSSIBLY_DISPATCHED_NO_RETRY',at:new Date().toISOString(),...identity})+'\n');await f.sync();}finally{await f.close();}
 const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}
 return await send();
}
