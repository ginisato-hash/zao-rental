import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import type {Connection} from '../packages/auth/src/config';
import {trackPoolLifecycle} from './pool-lifecycle';
/** Development/test provisioning of the dedicated group application role `<database>_group` (the database guards in 0064 only
 * accept group writes from exactly this role). It is the allocator's authority class: it receives the same privileges as the
 * existing `_hold` role (so the existing planner/claim writers behave identically) plus the group-specific delta below.
 * Production gets the same delta through the reviewed role-delta procedure (docs/execution/GROUP_INVITE_CORE.md). */
export async function provisionGroupRole(owner:Pool,identity:{namespace:string;database:string;dbPort:number}){
 if(!/^zr_[a-f0-9]{12}$/.test(identity.namespace)||identity.database!==identity.namespace)throw new Error('INVALID_OWNED_DATABASE');
 const user=identity.namespace+'_group',hold=identity.namespace+'_hold',password=randomBytes(24).toString('hex');
 await owner.query(`CREATE ROLE ${user} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
 await owner.query(`GRANT CONNECT ON DATABASE ${identity.database} TO ${user}`);await owner.query(`GRANT USAGE ON SCHEMA public TO ${user}`);
 // Mirror the hold role (tables, columns, sequences, functions) as read from the catalog.
 const tables=(await owner.query<{t:string;p:string}>(`SELECT table_name t,privilege_type p FROM information_schema.table_privileges WHERE grantee=$1 AND table_schema='public'`,[hold])).rows;
 for(const {t,p} of tables)await owner.query(`GRANT ${p} ON "${t}" TO ${user}`);
 const cols=(await owner.query<{t:string;c:string;p:string}>(`SELECT table_name t,column_name c,privilege_type p FROM information_schema.column_privileges WHERE grantee=$1 AND table_schema='public'`,[hold])).rows;
 for(const {t,c,p} of cols)await owner.query(`GRANT ${p}("${c}") ON "${t}" TO ${user}`);
 const seqs=(await owner.query<{n:string}>(`SELECT c.relname n FROM pg_class c,aclexplode(c.relacl) a WHERE c.relkind='S' AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname=$1)`,[hold])).rows;
 for(const {n} of seqs)await owner.query(`GRANT USAGE ON SEQUENCE "${n}" TO ${user}`);
 const fns=(await owner.query<{f:string}>(`SELECT p.oid::regprocedure::text f FROM pg_proc p,aclexplode(p.proacl) a WHERE a.privilege_type='EXECUTE' AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname=$1)`,[hold])).rows;
 for(const {f} of fns)await owner.query(`GRANT EXECUTE ON FUNCTION ${f} TO ${user}`);
 // Group-specific delta.
 await owner.query(`GRANT SELECT ON price_books,price_activations,booking_actors,provisional_capacity_buckets TO ${user}`).catch(()=>{});
 await owner.query(`GRANT SELECT,INSERT,UPDATE ON group_entrance,group_orders,group_order_parts,group_change_requests TO ${user}`);
 await owner.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON group_members TO ${user}`);
 await owner.query(`GRANT SELECT,INSERT ON group_entrance_history,group_events,group_quotes,group_consents,group_adjustments,group_payments,group_requests,group_notification_outbox TO ${user}`);
 await owner.query(`GRANT USAGE ON SEQUENCE group_number_seq TO ${user}`);
 await owner.query(`GRANT EXECUTE ON FUNCTION group_register_actor(uuid) TO ${user}`);
 const db:Connection={host:'127.0.0.1',port:identity.dbPort,database:identity.database,user,password};const pool=new Pool({...db,max:6,connectionTimeoutMillis:3000});const close=trackPoolLifecycle(pool);return {groupDb:db,groupPool:pool,close};
}
