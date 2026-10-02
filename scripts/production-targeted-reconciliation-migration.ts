import type {PoolClient} from 'pg';
import {bootstrapPlan} from './production-bootstrap';
import {productionPaymentRoleNames} from './production-payment-roles';
const refused='PRODUCTION_TARGETED_RECONCILIATION_RECONCILIATION_REQUIRED';
const functions={
 dispatch:'payment_reconciliation.dispatch_target_production(text,text)',
 claim:'payment_reconciliation.claim_target_production(text,text,text)',
 context:'payment_reconciliation.load_context_target_production(uuid,uuid,text,text)',
} as const;
/** Fixed 0051→0052 upgrade only. The CLI separately binds fresh main and pinned owner/TLS.
 * No role creation, credential or VALID UNTIL change, historical migration replay or business-row write. */
export async function applyProductionTargetedReconciliationMigration(c:PoolClient,database:string,owner:string){
 const plan=await bootstrapPlan(database),payment=productionPaymentRoleNames(database);
 if(plan.entries.length!==52||plan.entries[51]?.id!=='0052')throw Error(refused);
 let committing=false,committed=false;
 try{
  await c.query('BEGIN');
  await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='15000ms';SET LOCAL idle_in_transaction_session_timeout='20000ms';SET LOCAL search_path=public,pg_catalog");
  await c.query('SELECT pg_advisory_xact_lock(71820401)');
  await c.query('LOCK TABLE public.foundation_migrations IN EXCLUSIVE MODE');
  const identity=(await c.query('SELECT current_database() db,current_user role,session_user login,pg_get_userbyid(datdba) owner FROM pg_database WHERE datname=current_database()')).rows[0];
  if(!identity||identity.db!==database||identity.role!==owner||identity.login!==owner||identity.owner!==owner)throw Error(refused);
  const history=(await c.query('SELECT id,checksum FROM public.foundation_migrations ORDER BY id')).rows;
  if(history.length!==51||history.some((r,i)=>r.id!==plan.entries[i]!.id||r.checksum!==plan.entries[i]!.checksum))throw Error(refused);
  const absent=(await c.query('SELECT to_regprocedure($1) IS NULL a,to_regprocedure($2) IS NULL b,to_regprocedure($3) IS NULL c',[functions.dispatch,functions.claim,functions.context])).rows[0];
  const roles=(await c.query('SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY($1::text[])',[Object.values(payment)])).rows;
  if(!absent||!absent.a||!absent.b||!absent.c||roles.length!==5||roles.some(r=>r.rolsuper||r.rolcreatedb||r.rolcreaterole||r.rolinherit||r.rolreplication||r.rolbypassrls))throw Error(refused);
  const migration=plan.entries[51]!;await c.query(migration.sql);
  await c.query(`GRANT EXECUTE ON FUNCTION ${functions.dispatch} TO ${payment.dispatcher}`);
  await c.query(`GRANT EXECUTE ON FUNCTION ${functions.claim},${functions.context} TO ${payment.worker}`);
  await c.query('INSERT INTO public.foundation_migrations(id,checksum) VALUES($1,$2)',[migration.id,migration.checksum]);
  const expectedGrantee:Record<string,string>={[functions.dispatch]:payment.dispatcher,[functions.claim]:payment.worker,[functions.context]:payment.worker};
  for(const [fn,grantee] of Object.entries(expectedGrantee)){
   const proof=(await c.query(`SELECT p.prosecdef,pg_get_userbyid(p.proowner)=$1 AS correct_owner,
    p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'] AND cardinality(p.proconfig)=CASE WHEN p.proname='load_context_target_production' THEN 1 ELSE 2 END AND (p.proname='load_context_target_production' OR p.proconfig @> ARRAY['lock_timeout=2s']) AS settings,
    NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee NOT IN(p.proowner,(SELECT oid FROM pg_roles WHERE rolname=$2))) AS restricted,
    has_function_privilege($2,p.oid,'EXECUTE') AS granted
    FROM pg_proc p WHERE p.oid=$3::regprocedure`,[owner,grantee,fn])).rows[0];
   if(!proof||Object.values(proof).some(v=>v!==true))throw Error(refused);
   const others=(await c.query("SELECT coalesce(bool_or(has_function_privilege(r,$2::regprocedure,'EXECUTE')),false) leaked FROM unnest($1::text[]) t(r)",[Object.values(payment).filter(role=>role!==grantee),fn])).rows[0];
   if(others?.leaked!==false)throw Error(refused);
  }
  committing=true;await c.query('COMMIT');committed=true;
  await c.query('BEGIN READ ONLY');const readback=(await c.query('SELECT id,checksum FROM public.foundation_migrations ORDER BY id')).rows;await c.query('ROLLBACK');
  if(readback.length!==52||readback.some((r,i)=>r.id!==plan.entries[i]!.id||r.checksum!==plan.entries[i]!.checksum))throw Error(refused);
  return {status:'PRODUCTION_TARGETED_RECONCILIATION_INSTALLED',applied:['0052'],checksum:migration.checksum,historicalApplied:0,grantsAdded:3,grantsRevoked:0,credentialChanges:0,businessWrites:0};
 }catch(error){
  await c.query('ROLLBACK').catch(()=>{});
  if(committed)throw Error('PRODUCTION_TARGETED_RECONCILIATION_COMMITTED_READBACK_REQUIRED');
  if(committing)throw Error('PRODUCTION_TARGETED_RECONCILIATION_COMMIT_UNKNOWN_READBACK_REQUIRED');
  throw error;
 }
}
export function productionTargetedMigrationSafeError(error:unknown){
 const codes=[refused,'PRODUCTION_TARGETED_RECONCILIATION_COMMITTED_READBACK_REQUIRED','PRODUCTION_TARGETED_RECONCILIATION_COMMIT_UNKNOWN_READBACK_REQUIRED'];
 return error instanceof Error&&codes.includes(error.message)?error.message:'PRODUCTION_TARGETED_RECONCILIATION_OPERATION_FAILED';
}
