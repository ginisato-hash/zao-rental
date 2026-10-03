import type {PoolClient} from 'pg';
import {bootstrapPlan} from './production-bootstrap';
const refused='PRODUCTION_NORMAL_WORKER_RECONCILIATION_REQUIRED';
const functions=['provisional_capacity_receive_import()','payment_reconciliation.dispatch_normal(text,integer,timestamptz)','payment_reconciliation.claim_normal(text,integer,text,timestamptz)','payment_projection.normal_candidates(text,timestamptz,integer)','notification_due_normal(timestamptz,integer)'];
/** Fixed 0053→0055 additive transaction. The operator must first verify backup, exact
 * accepted main, pinned owner/TLS and protection. No grants, credentials or business writes. */
export async function applyProductionNormalWorkerMigration(c:PoolClient,database:string,owner:string){
 const plan=await bootstrapPlan(database);
 if(plan.entries.length!==55||plan.entries[53]?.id!=='0054'||plan.entries[54]?.id!=='0055')throw Error(refused);
 const registry=async(count:number)=>{
  const rows=(await c.query('SELECT id,checksum FROM public.foundation_migrations ORDER BY id')).rows;
  if(rows.length!==count||rows.some((r,i)=>r.id!==plan.entries[i]!.id||r.checksum!==plan.entries[i]!.checksum))throw Error(refused);
 };
 const proof=async()=>{
  for(const fn of functions){
   const row=(await c.query(`SELECT p.prosecdef,pg_get_userbyid(p.proowner)=$1 owner_ok,
    p.proconfig @> ARRAY[CASE WHEN p.pronamespace='payment_reconciliation'::regnamespace THEN 'search_path=pg_catalog, pg_temp' ELSE 'search_path=pg_catalog, public, pg_temp' END] path_ok,
    NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner) owner_only
    FROM pg_proc p WHERE p.oid=$2::regprocedure`,[owner,fn])).rows[0];
   if(!row||Object.values(row).some(v=>v!==true))throw Error(refused);
  }
  const guards=(await c.query(`SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.ops_import_commits'::regclass AND tgname='provisional_capacity_receive_import' AND tgenabled='O') receipt_trigger,
   position('PROVISIONAL_MATERIALIZATION_NOT_ACTIVATED' in pg_get_functiondef('public.provisional_capacity_materialize_bucket(uuid,integer,uuid)'::regprocedure))>0 legacy_guard,
   (SELECT count(*)=0 FROM public.provisional_capacity_receipts) no_business_writes`)).rows[0];
  if(!guards||Object.values(guards).some(v=>v!==true))throw Error(refused);
 };
 let committing=false,committed=false;
 try{
  await c.query('BEGIN');
  await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='15000ms';SET LOCAL idle_in_transaction_session_timeout='20000ms';SET LOCAL search_path=public,pg_catalog");
  await c.query('SELECT pg_advisory_xact_lock(71820401),pg_advisory_xact_lock(71820600)');
  await c.query('LOCK TABLE public.foundation_migrations IN EXCLUSIVE MODE');
  const id=(await c.query('SELECT current_database() db,current_user role,session_user login,pg_get_userbyid(datdba) owner FROM pg_database WHERE datname=current_database()')).rows[0];
  if(!id||id.db!==database||id.role!==owner||id.login!==owner||id.owner!==owner)throw Error(refused);
  await registry(53);
  for(const fn of functions)if((await c.query('SELECT to_regprocedure($1) IS NULL absent',[fn])).rows[0]?.absent!==true)throw Error(refused);
  if((await c.query("SELECT to_regclass('public.provisional_capacity_receipts') IS NULL absent")).rows[0]?.absent!==true)throw Error(refused);
  for(const entry of plan.entries.slice(53)){
   await c.query(entry.sql);
   await c.query('INSERT INTO public.foundation_migrations(id,checksum) VALUES($1,$2)',[entry.id,entry.checksum]);
  }
  await registry(55);await proof();
  committing=true;await c.query('COMMIT');committed=true;
  await c.query('BEGIN READ ONLY');await registry(55);await proof();await c.query('ROLLBACK');
  return {status:'PRODUCTION_NORMAL_WORKER_INSTALLED',applied:plan.entries.slice(53).map(({id,checksum})=>({id,checksum})),historicalApplied:0,grantsAdded:0,credentialChanges:0,businessWrites:0};
 }catch(error){
  await c.query('ROLLBACK').catch(()=>{});
  if(committed)throw Error('PRODUCTION_NORMAL_WORKER_COMMITTED_READBACK_REQUIRED');
  if(committing)throw Error('PRODUCTION_NORMAL_WORKER_COMMIT_UNKNOWN_READBACK_REQUIRED');
  throw error;
 }
}
