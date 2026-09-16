import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startIsolatedPostgres} from './postgres';
import {migrate} from '../packages/db/src/index';
import {run,type DB} from '../tests/readiness/r14-postgres';
// Explicit finite command. No external transport, Preview, credentials or background worker.
if(process.env.NODE_ENV==='production')throw new Error('R14_DEVELOPMENT_ONLY');
const output=resolve('.local/r14-acceptance');await mkdir(output,{recursive:true,mode:0o700});
const db:Awaited<ReturnType<typeof startIsolatedPostgres>>&DB=await startIsolatedPostgres();
let validationFailed=false;
try{await migrate(db.pool);await run(db,output);}
catch(error){console.error('R14_ACCEPTANCE_FAILED',{code:(error as {code?:string}).code??'TEST_FAILURE'});validationFailed=true;}
finally{try{await db.r14?.roles.close();}finally{await db.stop();}await writeFile(resolve(output,'closure.json'),JSON.stringify({stoppedAt:new Date().toISOString(),ownedDatabaseStopped:true,providerRequests:0}));}

// All owned resources are already closed. async-exit-hook beforeExit forces 0,
// so a failed finite test must exit explicitly after cleanup.
if(validationFailed)process.exit(1);
