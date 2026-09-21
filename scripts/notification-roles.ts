import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import type {Connection} from '../packages/auth/src/config';
import {trackPoolLifecycle} from './pool-lifecycle';
/** Owned local operator role only. Function capability, no direct contacts, auth,
 * business writes, token tables, DDL or hosted role mutation. */
export async function provisionNotificationRole(owner:Pool,identity:{namespace:string;database:string;dbPort:number}){
 if(!/^zr_[a-f0-9]{12}$/.test(identity.namespace)||identity.database!==identity.namespace||!Number.isInteger(identity.dbPort)||identity.dbPort<20000||identity.dbPort>29000)throw Error('INVALID_OWNED_DATABASE');
 const user=identity.namespace+'_notification',password=randomBytes(24).toString('hex');
 await owner.query(`CREATE ROLE ${user} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
 await owner.query(`GRANT CONNECT ON DATABASE ${identity.database} TO ${user}`);await owner.query(`GRANT USAGE ON SCHEMA public TO ${user}`);
 await owner.query(`GRANT EXECUTE ON FUNCTION notification_enqueue_confirmed(uuid),notification_sync_confirmed(),notification_claim(uuid),notification_material(uuid,uuid),notification_settle(uuid,uuid,text,text,text),notification_unknown(uuid),notification_reconciled(uuid,text),notification_due() TO ${user}`);
 const notificationDb:Connection={host:'127.0.0.1',port:identity.dbPort,database:identity.database,user,password},notificationPool=new Pool({...notificationDb,max:4,connectionTimeoutMillis:2000});return {notificationDb,notificationPool,close:trackPoolLifecycle(notificationPool)};
}
