import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import type {Connection} from '../packages/auth/src/config';
import {trackPoolLifecycle} from './pool-lifecycle';
/** Flips the migration-created NOLOGIN `<database>_backup` role into a LOGIN identity with a
 * fresh local-only password, for this disposable cluster only. Grants (CONNECT, pg_read_all_data)
 * already exist from migration 0040 — this never grants privilege itself. */
export async function provisionBackupRole(owner:Pool,identity:{namespace:string;database:string;dbPort:number}){
 if(!/^zr_[a-f0-9]{12}$/.test(identity.namespace)||identity.database!==identity.namespace)throw new Error('INVALID_OWNED_DATABASE');
 const user=identity.namespace+'_backup',password=randomBytes(24).toString('hex');
 await owner.query(`ALTER ROLE ${user} LOGIN PASSWORD '${password}'`);
 const backupDb:Connection={host:'127.0.0.1',port:identity.dbPort,database:identity.database,user,password};const backupPool=new Pool({...backupDb,max:2,connectionTimeoutMillis:2000});return {backupDb,backupPool,close:trackPoolLifecycle(backupPool)};
}
