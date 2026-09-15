import {Pool,type PoolConfig} from 'pg';
import {dispatchR15Once,type R15Operation} from '../../packages/db/src/r15-operation-guard';
// Owned local test child only. Credentials are RAM IPC, not argv/env/logs/files.
process.once('message',async(m:{config:PoolConfig;op:R15Operation;crash:boolean})=>{
 if(process.env.NODE_ENV!=='test'||m.config.host!=='127.0.0.1')process.exit(24);
 const p=new Pool(m.config);
 try{await dispatchR15Once(p,m.op,async()=>{if(m.crash)process.exit(23);return true;});process.exitCode=0;}
 catch{process.exitCode=22;}
 finally{await p.end();process.disconnect?.();}
});
