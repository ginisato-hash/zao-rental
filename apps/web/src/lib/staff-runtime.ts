import 'server-only';
import {Pool} from 'pg';
import {createHash} from 'node:crypto';
import {parseRuntime} from '../../../../packages/auth/src/config';
import {createStaffAuth,resolveStaff,type StaffState} from '../../../../packages/auth/src/staff-auth';
let instance:ReturnType<typeof createRuntime>|undefined;
function createRuntime(){
 const config=parseRuntime(process.env.ZAO_DEVELOPMENT_RUNTIME);
 if(!config)return null;
 const holdPool=new Pool({...config.holdDb,max:4,connectionTimeoutMillis:2000});holdPool.on('error',()=>{});
 const authPool=new Pool({...config.authDb,max:4}),ledgerPool=new Pool({...config.ledgerDb,max:4}),loginPool=new Pool({...config.authDb,max:2});
 // Never log raw Pool/driver errors; they may contain connection settings.
 authPool.on('error',()=>{});ledgerPool.on('error',()=>{});loginPool.on('error',()=>{});
 const auth=createStaffAuth(authPool,{origin:config.origin,secret:config.authSecret});
 return {config,holdPool,authPool,ledgerPool,loginPool,auth};
}
export function getRuntime(){if(instance===undefined)instance=createRuntime();return instance;}
export async function staffState(headers:Headers):Promise<StaffState>{
 const runtime=getRuntime();
 if(!runtime?.auth)return {status:'anonymous',principal:null,stamp:null};
 return resolveStaff(runtime.auth,runtime.authPool,headers);
}
export function publicStamp(stamp:string){return createHash('sha256').update(stamp).digest('hex');}
