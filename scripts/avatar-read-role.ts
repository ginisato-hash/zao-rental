import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {trackPoolLifecycle} from './pool-lifecycle';
import type {Connection} from '../packages/auth/src/config';
/** Owned local development only. No workspace/raw-object or business-table grants. */
export async function provisionAvatarReadRole(owner:Pool,identity:{namespace:string;database:string;dbPort:number}){
 if(!/^zr_[a-f0-9]{12}$/.test(identity.namespace)||identity.namespace!==identity.database)throw new Error('INVALID_OWNED_DATABASE');
 const user=identity.namespace+'_avatar_read',password=randomBytes(24).toString('hex');
 await owner.query(`CREATE ROLE ${user} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
 await owner.query(`GRANT CONNECT ON DATABASE ${identity.database} TO ${user}`);
 await owner.query(`GRANT USAGE ON SCHEMA public TO ${user}`);
 await owner.query(`GRANT SELECT ON avatar_current_visuals TO ${user}`);
 await owner.query(`GRANT EXECUTE ON FUNCTION avatar_visual_derivative(uuid,text) TO ${user}`);
 const avatarDb:Connection={host:'127.0.0.1',port:identity.dbPort,database:identity.database,user,password};
 const avatarPool=new Pool({...avatarDb,max:4}),close=trackPoolLifecycle(avatarPool);
 return {avatarDb,avatarPool,close};
}
