import {Pool} from 'pg';
import {additional} from './r14-additional';
import type {DB} from './r14-postgres';
// Test-only fork. Parent-generated synthetic DB credentials travel in a private IPC channel,
// are never placed in command arguments/env/files/logs, and all child pools close before exit.
process.once('message',async(message:{owner:ConstructorParameters<typeof Pool>[0];roles:Record<string,ConstructorParameters<typeof Pool>[0]>;names:NonNullable<DB['r14']>['roles']['names'];identity:DB['identity'];out:string})=>{
 const pool=new Pool(message.owner),pools=Object.fromEntries(Object.entries(message.roles).map(([k,v])=>[k,new Pool(v)])) as NonNullable<DB['r14']>['roles']['pools'];
 const close=async()=>{await Promise.all(Object.values(pools).map(p=>p.end()));};
 try{await additional({pool,identity:message.identity,r14:{roles:{names:message.names,pools,close},completed:new Set(['e2e'])}},message.out);}
 catch(error){console.log('R14_FRESH_TEST_FAILED '+JSON.stringify({code:(error as {code?:string}).code??(error as Error).name,at:(error as Error).stack?.split('\n').find(x=>x.includes('/tests/readiness/'))}));process.exitCode=1;}
 finally{await close();await pool.end();process.disconnect?.();}
});
