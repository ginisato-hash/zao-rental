import 'server-only';
import {Pool} from 'pg';
import {getRuntime} from './staff-runtime';
import type {Connection} from '../../../../packages/auth/src/config';
import {PostgresAvatarVisuals} from '../../../../packages/db/src/avatar-visuals';
let pool:Pool|undefined;
/** Local adapter only; hosted/Production activation requires separate authority. */
export function avatarRuntime(){
 const runtime=getRuntime(),raw=process.env.ZAO_AVATAR_READ_RUNTIME;
 if(!runtime||process.env.NODE_ENV==='production'||!raw)return null;
 const c=JSON.parse(raw) as Connection;
 if(c.host!=='127.0.0.1'||c.database!==runtime.config.namespace||c.user!==runtime.config.namespace+'_avatar_read'||c.port!==runtime.config.authDb.port||!c.password)throw new Error('AVATAR_RUNTIME_INVALID');
 if(!pool){pool=new Pool({...c,max:4});pool.on('error',()=>{});}
 return new PostgresAvatarVisuals(pool);
}
