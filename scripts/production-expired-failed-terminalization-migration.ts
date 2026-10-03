import type {PoolClient} from 'pg';
import {bootstrapPlan} from './production-bootstrap';
import {productionPaymentRoleNames} from './production-payment-roles';
const refused='PRODUCTION_EXPIRED_FAILED_TERMINALIZATION_RECONCILIATION_REQUIRED';
const fn='payment_projection.terminalize_expired_unbound_failed_production(uuid,uuid,uuid,text,text,bigint,text)';
/** Fixed 0052→0053 upgrade. No credentials, historical replay or business-row writes. */
export async function applyProductionExpiredFailedTerminalizationMigration(c:PoolClient,database:string,owner:string){
 const plan=await bootstrapPlan(database),payment=productionPaymentRoleNames(database);
 if(plan.entries.length<53||plan.entries[52]?.id!=='0053')throw Error(refused);
 const posture=async()=>{
  const roles=(await c.query(`SELECT r.rolname,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolinherit,r.rolreplication,r.rolbypassrls,
   EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) membership,
   EXISTS(SELECT 1 FROM pg_database WHERE datdba=r.oid) database_owner,
   EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=r.oid) schema_owner,
   EXISTS(SELECT 1 FROM pg_class WHERE relowner=r.oid) object_owner,
   EXISTS(SELECT 1 FROM pg_proc WHERE proowner=r.oid) function_owner,
   has_database_privilege(r.oid,current_database(),'CREATE') database_create,
   has_schema_privilege(r.oid,'public','CREATE') schema_create,
   has_function_privilege(r.oid,'booking_cancel(uuid,uuid,jsonb)','EXECUTE') direct_cancel,
   has_function_privilege(r.oid,'booking_cancellation_preview(uuid)','EXECUTE') direct_preview
   FROM pg_roles r WHERE rolname=ANY($1::text[])`,[Object.values(payment)])).rows;
  if(roles.length!==5||roles.some(r=>Object.entries(r).some(([k,v])=>k!=='rolname'&&v!==false)))throw Error(refused);
 };
 const proof=async()=>{
  await posture();
  const row=(await c.query(`SELECT p.prosecdef,pg_get_userbyid(p.proowner)=$1 AS correct_owner,
   p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp','lock_timeout=2s'] AND cardinality(p.proconfig)=2 AS settings,
   NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee NOT IN(p.proowner,(SELECT oid FROM pg_roles WHERE rolname=$2))) AS restricted,
   has_function_privilege($2,p.oid,'EXECUTE') AS granted
   FROM pg_proc p WHERE p.oid=$3::regprocedure`,[owner,payment.projector,fn])).rows[0];
  const others=(await c.query("SELECT bool_or(has_function_privilege(r,$2::regprocedure,'EXECUTE')) leaked FROM unnest($1::text[]) t(r)",[Object.values(payment).filter(r=>r!==payment.projector),fn])).rows[0];
  if(!row||Object.values(row).some(v=>v!==true)||others?.leaked!==false)throw Error(refused);
 };
 let committing=false,committed=false;
 try{
  await c.query('BEGIN');
  await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='15000ms';SET LOCAL idle_in_transaction_session_timeout='20000ms';SET LOCAL search_path=public,pg_catalog");
  await c.query('SELECT pg_advisory_xact_lock(71820401)');
  await c.query('LOCK TABLE public.foundation_migrations IN EXCLUSIVE MODE');
  const identity=(await c.query('SELECT current_database() db,current_user role,session_user login,pg_get_userbyid(datdba) owner FROM pg_database WHERE datname=current_database()')).rows[0];
  if(!identity||identity.db!==database||identity.role!==owner||identity.login!==owner||identity.owner!==owner)throw Error(refused);
  const history=(await c.query('SELECT id,checksum FROM public.foundation_migrations ORDER BY id')).rows;
  if(history.length!==52||history.some((r,i)=>r.id!==plan.entries[i]!.id||r.checksum!==plan.entries[i]!.checksum))throw Error(refused);
  const absent=(await c.query('SELECT to_regprocedure($1) IS NULL absent',[fn])).rows[0];
  if(absent?.absent!==true)throw Error(refused);
  await posture();
  const migration=plan.entries[52]!;await c.query(migration.sql);
  await c.query(`GRANT EXECUTE ON FUNCTION ${fn} TO ${payment.projector}`);
  await c.query('INSERT INTO public.foundation_migrations(id,checksum) VALUES($1,$2)',[migration.id,migration.checksum]);
  await proof();
  committing=true;await c.query('COMMIT');committed=true;
  await c.query('BEGIN READ ONLY');
  const readback=(await c.query('SELECT id,checksum FROM public.foundation_migrations ORDER BY id')).rows;
  if(readback.length!==53||readback.some((r,i)=>r.id!==plan.entries[i]!.id||r.checksum!==plan.entries[i]!.checksum))throw Error(refused);
  await proof();await c.query('ROLLBACK');
  return {status:'PRODUCTION_EXPIRED_FAILED_TERMINALIZATION_INSTALLED',applied:['0053'],checksum:migration.checksum,historicalApplied:0,grantsAdded:1,grantsRevoked:0,credentialChanges:0,businessWrites:0};
 }catch(error){
  await c.query('ROLLBACK').catch(()=>{});
  if(committed)throw Error('PRODUCTION_EXPIRED_FAILED_TERMINALIZATION_COMMITTED_READBACK_REQUIRED');
  if(committing)throw Error('PRODUCTION_EXPIRED_FAILED_TERMINALIZATION_COMMIT_UNKNOWN_READBACK_REQUIRED');
  throw error;
 }
}
export function productionExpiredFailedMigrationSafeError(error:unknown){
 const codes=[refused,'PRODUCTION_EXPIRED_FAILED_TERMINALIZATION_COMMITTED_READBACK_REQUIRED','PRODUCTION_EXPIRED_FAILED_TERMINALIZATION_COMMIT_UNKNOWN_READBACK_REQUIRED'];
 return error instanceof Error&&codes.includes(error.message)?error.message:'PRODUCTION_EXPIRED_FAILED_TERMINALIZATION_OPERATION_FAILED';
}
