import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import type {Connection} from '../packages/auth/src/config';
import {trackPoolLifecycle} from './pool-lifecycle';
/** Flips the migration-created NOLOGIN receiver/reconciler roles into LOGIN identities with
 * fresh local-only passwords, for this disposable cluster only. Grants already exist from
 * migration 0040 — this never grants privilege itself. */
async function provision(owner:Pool,identity:{namespace:string;database:string;dbPort:number},suffix:string){
 if(!/^zr_[a-f0-9]{12}$/.test(identity.namespace)||identity.database!==identity.namespace)throw new Error('INVALID_OWNED_DATABASE');
 const user=identity.namespace+suffix,password=randomBytes(24).toString('hex');
 await owner.query(`ALTER ROLE ${user} LOGIN PASSWORD '${password}'`);
 const db:Connection={host:'127.0.0.1',port:identity.dbPort,database:identity.database,user,password};const pool=new Pool({...db,max:2,connectionTimeoutMillis:2000});return {db,pool,close:trackPoolLifecycle(pool)};
}
export const provisionWebhookReceiverRole=(owner:Pool,identity:{namespace:string;database:string;dbPort:number})=>provision(owner,identity,'_square_webhook_receiver');
export const provisionWebhookReconcilerRole=(owner:Pool,identity:{namespace:string;database:string;dbPort:number})=>provision(owner,identity,'_square_webhook_reconciler');
