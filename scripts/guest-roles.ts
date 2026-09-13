import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {trackPoolLifecycle} from './pool-lifecycle';
import type {Connection} from '../packages/auth/src/config';
/** Dedicated development BFF connection, never browser credentials or staff authority. */
export async function provisionGuestRole(owner:Pool,identity:{namespace:string;database:string;dbPort:number}){
 if(!/^zr_[a-f0-9]{12}$/.test(identity.namespace)||identity.database!==identity.namespace)throw new Error('INVALID_OWNED_DATABASE');
 const user=identity.namespace+'_guest',password=randomBytes(24).toString('hex');
 await owner.query(`CREATE ROLE ${user} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
 await owner.query(`GRANT CONNECT ON DATABASE ${identity.database} TO ${user}`);await owner.query(`GRANT USAGE ON SCHEMA public TO ${user}`);
 await owner.query(`GRANT SELECT,INSERT ON booking_actors,guest_contexts TO ${user}`);
 await owner.query(`GRANT UPDATE(revoked_at) ON guest_contexts TO ${user}`);
 await owner.query(`GRANT SELECT,INSERT,UPDATE ON guest_drafts TO ${user}`);
 await owner.query(`GRANT EXECUTE ON FUNCTION inventory_clock() TO ${user}`);
 const guestDb:Connection={host:'127.0.0.1',port:identity.dbPort,database:identity.database,user,password},guestPool=new Pool({...guestDb,max:4,connectionTimeoutMillis:2000});return {guestDb,guestPool,close:trackPoolLifecycle(guestPool)};
}
