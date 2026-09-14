import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import type {Connection} from '../packages/auth/src/config';
import {trackPoolLifecycle} from './pool-lifecycle';
/** Dedicated owned development role. No direct table, DDL, membership or inventory rights. */
export async function provisionBookingAccessRole(owner:Pool,identity:{namespace:string;database:string;dbPort:number}){
 if(!/^zr_[a-f0-9]{12}$/.test(identity.namespace)||identity.database!==identity.namespace)throw new Error('INVALID_OWNED_DATABASE');
 const user=identity.namespace+'_booking_access',password=randomBytes(24).toString('hex');
 await owner.query(`CREATE ROLE ${user} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
 await owner.query(`GRANT CONNECT ON DATABASE ${identity.database} TO ${user}`);
 await owner.query(`GRANT USAGE ON SCHEMA booking_access TO ${user}`);
 await owner.query(`GRANT EXECUTE ON FUNCTION booking_access.issue(uuid,text,text,uuid,uuid,text,text),booking_access.read(text),booking_access.revoke(text),booking_access.prepare_recovery(uuid,text,text,uuid,uuid,text,text),booking_access.recovery_delivered(text),booking_access.exchange_recovery(text,uuid,text,text),booking_access.revoke_recovery(text) TO ${user}`);
 const accessDb:Connection={host:'127.0.0.1',port:identity.dbPort,database:identity.database,user,password};
 const accessPool=new Pool({...accessDb,max:4,connectionTimeoutMillis:2000});
 return {accessDb,accessPool,close:trackPoolLifecycle(accessPool)};
}
