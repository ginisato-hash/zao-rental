import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import type {DB} from './r14-postgres';
export async function captureDbEvidence(db:DB,out:string){
 if(db.r14!.completed.has('closed-roles'))return;
 const names=Object.values(db.r14!.roles.names),schemas=['square_webhook','payment_reconciliation','payment_projection'];
 const migrations=(await db.pool.query('SELECT id,checksum FROM foundation_migrations ORDER BY id')).rows;assert.equal(migrations.length,30);
 const version=(await db.pool.query('SHOW server_version')).rows[0].server_version;
 const functions=(await db.pool.query('SELECT n.nspname AS schema,p.proname AS name,pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS security_definer,p.proconfig AS settings FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1::text[]) ORDER BY 1,2',[schemas])).rows;
 const tables=(await db.pool.query('SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema=ANY($1::text[]) ORDER BY 1,2',[schemas])).rows;
 const constraints=(await db.pool.query('SELECT n.nspname AS schema,t.relname AS table,c.conname AS name,c.contype AS type,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=ANY($1::text[]) ORDER BY 1,2,3',[schemas])).rows;
 const indexes=(await db.pool.query('SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=ANY($1::text[]) ORDER BY 1,2,3',[schemas])).rows;
 const triggers=(await db.pool.query('SELECT n.nspname AS schema,c.relname AS table,t.tgname AS trigger,p.proname AS function FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname=ANY($1::text[]) AND NOT t.tgisinternal ORDER BY 1,2,3',[schemas])).rows;
 const grants=(await db.pool.query('SELECT grantee,table_schema,table_name,privilege_type FROM information_schema.role_table_grants WHERE grantee=ANY($1::text[]) ORDER BY 1,2,3,4',[names])).rows;
 const columns=(await db.pool.query('SELECT grantee,table_schema,table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE grantee=ANY($1::text[]) ORDER BY 1,2,3,4,5',[names])).rows;
 const routines=(await db.pool.query('SELECT grantee,routine_schema,routine_name,privilege_type FROM information_schema.routine_privileges WHERE grantee=ANY($1::text[]) ORDER BY 1,2,3',[names])).rows;
 const attributes=(await db.pool.query('SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY($1::text[])',[names])).rows;
 const counts:Record<string,number>={};for(const table of ['rental_bookings','ledger_assets','wear_pools','rental_notifications','rental_loan_items','rental_receipts','payment_projection.events','payment_projection.job_receipts'])counts[table]=(await db.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;
 assert.equal(counts.rental_bookings,1);assert.equal(counts.rental_loan_items,0);assert.equal(counts.rental_receipts,0);assert.equal(counts.rental_notifications,0);assert.equal(counts['payment_projection.events'],1);
 writeFileSync(out+'/db-final-metadata.json',JSON.stringify({kind:'LOCAL_OWNED_SYNTHETIC_ONLY',database:db.identity.database,version,migrations,tables,constraints,indexes,triggers,functions,grants,columns,routines,attributes,counts},null,2));
 await db.r14!.roles.close();
 const active=(await db.pool.query('SELECT count(*)::int n FROM pg_stat_activity WHERE usename=ANY($1::text[])',[names])).rows[0].n;assert.equal(active,0);
 writeFileSync(out+'/runtime-role-closure.json',JSON.stringify({closedAt:new Date().toISOString(),ownedRuntimeRoles:names,remainingConnections:active,finiteChildExited:true,ownerConnectionPendingStop:true},null,2));db.r14!.completed.add('closed-roles');console.log('R14_RUNTIME_ROLE_CONNECTIONS_CLOSED');
}
