import type {PoolClient} from 'pg';
import {bootstrapPlan} from './production-bootstrap';
import {productionPaymentRoleNames} from './production-payment-roles';
import {productionAppRoleNames} from './production-app-roles';
const refused='PRODUCTION_PAYMENT_RUNTIME_RECONCILIATION_REQUIRED';
/** Fixed 0050→0051 upgrade only. The CLI separately binds fresh main and pinned owner/TLS.
 * No role creation, credential rotation, historical migration replay or business-row write. */
export async function applyProductionPaymentRuntimeMigration(c:PoolClient,database:string,owner:string){
 const plan=await bootstrapPlan(database),payment=productionPaymentRoleNames(database),app=productionAppRoleNames(database);
 // Historical one-shot: valid only inside the exact 52-entry plan it ships with; 0052 is never applied or checked here.
 if(plan.entries.length!==52||plan.entries[50]?.id!=='0051'||plan.entries[51]?.id!=='0052')throw Error(refused);
 let committing=false,committed=false;
 try{
  await c.query('BEGIN');
  await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='15000ms';SET LOCAL idle_in_transaction_session_timeout='20000ms';SET LOCAL search_path=public,pg_catalog");
  await c.query('SELECT pg_advisory_xact_lock(71820401)');
  await c.query('LOCK TABLE public.foundation_migrations IN EXCLUSIVE MODE');
  const identity=(await c.query('SELECT current_database() db,current_user role,session_user login,pg_get_userbyid(datdba) owner FROM pg_database WHERE datname=current_database()')).rows[0];
  if(!identity||identity.db!==database||identity.role!==owner||identity.login!==owner||identity.owner!==owner)throw Error(refused);
  const history=(await c.query('SELECT id,checksum FROM public.foundation_migrations ORDER BY id')).rows;
  if(history.length!==50||history.some((r,i)=>r.id!==plan.entries[i]!.id||r.checksum!==plan.entries[i]!.checksum))throw Error(refused);
  const absent=(await c.query("SELECT to_regprocedure('payment_projection.lock_source_production(uuid,text,text)') IS NULL absent")).rows[0];
  const roles=(await c.query('SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY($1::text[])',[Object.values(payment)])).rows;
  if(!absent?.absent||roles.length!==5||roles.some(r=>r.rolcanlogin||r.rolsuper||r.rolcreatedb||r.rolcreaterole||r.rolinherit||r.rolreplication||r.rolbypassrls))throw Error(refused);
  const prior=(await c.query("SELECT has_function_privilege($1,'payment_projection.lock_source(uuid)','EXECUTE') old_reader,has_function_privilege($2,'public.provisional_capacity_effective_quantity(uuid)','EXECUTE') hold_reader",[payment.projector,app.hold])).rows[0];
  if(!prior.old_reader||prior.hold_reader)throw Error(refused);
  const migration=plan.entries[50]!;await c.query(migration.sql);
  await c.query(`GRANT EXECUTE ON FUNCTION payment_projection.lock_source_production(uuid,text,text) TO ${payment.projector}`);
  await c.query(`REVOKE EXECUTE ON FUNCTION payment_projection.lock_source(uuid) FROM ${payment.projector}`);
  await c.query(`GRANT EXECUTE ON FUNCTION public.provisional_capacity_effective_quantity(uuid) TO ${app.hold}`);
  await c.query('INSERT INTO public.foundation_migrations(id,checksum) VALUES($1,$2)',[migration.id,migration.checksum]);
  const actual=(await c.query("SELECT has_function_privilege($1,'payment_projection.lock_source(uuid)','EXECUTE') old_reader,has_function_privilege($1,'payment_projection.lock_source_production(uuid,text,text)','EXECUTE') production_reader,has_function_privilege($2,'public.provisional_capacity_effective_quantity(uuid)','EXECUTE') hold_reader",[payment.projector,app.hold])).rows[0];
  if(actual.old_reader||!actual.production_reader||!actual.hold_reader)throw Error(refused);
  const functionProof=(await c.query(`SELECT p.prosecdef,pg_get_userbyid(p.proowner)=$1 AS correct_owner,
   p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp','lock_timeout=2s'] AND cardinality(p.proconfig)=2 AS settings,
   NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee NOT IN(p.proowner,(SELECT oid FROM pg_roles WHERE rolname=$2))) AS restricted
   FROM pg_proc p WHERE p.oid='payment_projection.lock_source_production(uuid,text,text)'::regprocedure`,[owner,payment.projector])).rows[0];
  if(!functionProof||Object.values(functionProof).some(v=>v!==true))throw Error(refused);
  committing=true;await c.query('COMMIT');committed=true;
  await c.query('BEGIN READ ONLY');const readback=(await c.query('SELECT id,checksum FROM public.foundation_migrations ORDER BY id')).rows;await c.query('ROLLBACK');
  if(readback.length!==51||readback.some((r,i)=>r.id!==plan.entries[i]!.id||r.checksum!==plan.entries[i]!.checksum))throw Error(refused);
  return {status:'PRODUCTION_PAYMENT_RUNTIME_INSTALLED',applied:['0051'],checksum:migration.checksum,historicalApplied:0,grantsAdded:2,grantsRevoked:1,credentialChanges:0,businessWrites:0};
 }catch(error){
  await c.query('ROLLBACK').catch(()=>{});
  if(committed)throw Error('PRODUCTION_PAYMENT_RUNTIME_COMMITTED_READBACK_REQUIRED');
  if(committing)throw Error('PRODUCTION_PAYMENT_RUNTIME_COMMIT_UNKNOWN_READBACK_REQUIRED');
  throw error;
 }
}
export function productionPaymentMigrationSafeError(error:unknown){
 const codes=[refused,'PRODUCTION_PAYMENT_RUNTIME_COMMITTED_READBACK_REQUIRED','PRODUCTION_PAYMENT_RUNTIME_COMMIT_UNKNOWN_READBACK_REQUIRED'];
 return error instanceof Error&&codes.includes(error.message)?error.message:'PRODUCTION_PAYMENT_RUNTIME_OPERATION_FAILED';
}
