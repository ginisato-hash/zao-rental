import type {PoolClient} from 'pg';
import {bootstrapPlan} from './production-bootstrap';
import {productionRefundAutomationGrants} from './production-payment-roles';
const refusedMigration='PRODUCTION_REFUND_AUTOMATION_RECONCILIATION_REQUIRED',refusedGrants='PRODUCTION_REFUND_AUTOMATION_GRANTS_REFUSED';
const FUNCTIONS=['ops_refund_row(uuid)','ops_refund_claim(uuid)','ops_refund_observe(uuid,jsonb)'] as const;
type Registry=(c:PoolClient,plan:Awaited<ReturnType<typeof bootstrapPlan>>,count:number,refused:string)=>Promise<void>;
/** The registry must be exactly the first `count` canonical entries (same ids and reviewed checksums), nothing more. */
const registry:Registry=async(c,plan,count,refused)=>{
 const rows=(await c.query('SELECT id,checksum FROM public.foundation_migrations ORDER BY id')).rows;
 if(rows.length!==count||rows.some((r,i)=>r.id!==plan.entries[i]!.id||r.checksum!==plan.entries[i]!.checksum))throw Error(refused);
};
async function ownerSession(c:PoolClient,database:string,owner:string,refused:string){
 await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='15000ms';SET LOCAL idle_in_transaction_session_timeout='20000ms';SET LOCAL search_path=public,pg_catalog");
 await c.query('SELECT pg_advisory_xact_lock(71820401),pg_advisory_xact_lock(71820600)');
 const id=(await c.query('SELECT current_database() db,current_user role,session_user login,pg_get_userbyid(datdba) owner FROM pg_database WHERE datname=current_database()')).rows[0];
 if(!id||id.db!==database||id.role!==owner||id.login!==owner||id.owner!==owner)throw Error(refused);
}

/** Fixed 0055→0056 additive transaction: applies exactly the canonical 0056 entry, nothing else (0054/0055 and their grants are
 * never re-run). Preconditions: owner session, registry exactly 0001–0055, the three functions and the removals table absent.
 * Postconditions: registry 0001–0056; the three functions SECURITY DEFINER, owner-owned, pinned search_path, owner-only ACL; role
 * defaults present; the guard carries the 0056 branch. Returns the number of REFUND_OVERRIDE denials removed (pre-change evidence is in
 * staff_permission_override_removals). A lost COMMIT means read-only reconciliation, never a rerun. */
export async function applyProductionRefundAutomationMigration(c:PoolClient,database:string,owner:string){
 const plan=await bootstrapPlan(database),refused=refusedMigration;
 if(plan.entries.length<56||plan.entries[54]?.id!=='0055'||plan.entries[55]?.id!=='0056'||plan.entries[55]?.file!=='0056_refund_automation.sql')throw Error(refused);
 const entry=plan.entries[55]!;
 const proof=async()=>{
  for(const fn of FUNCTIONS){
   const row=(await c.query(`SELECT p.prosecdef,pg_get_userbyid(p.proowner)=$1 owner_ok,p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'] path_ok,
    NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner) owner_only
    FROM pg_proc p WHERE p.oid=$2::regprocedure`,[owner,fn])).rows[0];
   if(!row||Object.values(row).some(v=>v!==true))throw Error(refused);
  }
  const state=(await c.query(`SELECT (SELECT count(*)=6 FROM public.staff_role_permissions WHERE role IN ('STAFF','MANAGER','ADMIN') AND permission IN ('BOOKING_VIEW','REFUND_OVERRIDE')) roles,
   NOT EXISTS(SELECT 1 FROM public.staff_role_permissions WHERE role='VIEWER' AND permission IN ('BOOKING_VIEW','REFUND_OVERRIDE')) viewer,
   position('rental_internal.ops_refund_effects' in pg_get_functiondef('public.ops_financial_guard()'::regprocedure))>0 guard,
   to_regclass('rental_internal.ops_refund_effects') IS NOT NULL effects,
   position('ONLINE_REFUND' in pg_get_viewdef('public.ops_exception_sources'::regclass))>0 console,
   NOT EXISTS(SELECT 1 FROM public.staff_permission_overrides o JOIN public.staff_members s ON s.id=o.staff_id WHERE o.permission='REFUND_OVERRIDE' AND NOT o.allowed AND s.active AND s.role IN ('STAFF','MANAGER','ADMIN')) no_denials`)).rows[0];
  if(!state||Object.values(state).some(v=>v!==true))throw Error(refused);
 };
 let committing=false,committed=false;
 try{
  await c.query('BEGIN');await ownerSession(c,database,owner,refused);
  await c.query('LOCK TABLE public.foundation_migrations IN EXCLUSIVE MODE');
  await registry(c,plan,55,refused);
  for(const fn of FUNCTIONS)if((await c.query('SELECT to_regprocedure($1) IS NULL absent',[fn])).rows[0]?.absent!==true)throw Error(refused);
  if((await c.query("SELECT to_regclass('public.staff_permission_override_removals') IS NULL AND to_regclass('rental_internal.ops_refund_effects') IS NULL absent")).rows[0]?.absent!==true)throw Error(refused);
  const denialsBefore=Number((await c.query(`SELECT count(*)::int n FROM public.staff_permission_overrides o JOIN public.staff_members s ON s.id=o.staff_id WHERE o.permission='REFUND_OVERRIDE' AND NOT o.allowed AND s.active AND s.role IN ('STAFF','MANAGER','ADMIN')`)).rows[0].n);
  await c.query(entry.sql);
  await c.query('INSERT INTO public.foundation_migrations(id,checksum) VALUES($1,$2)',[entry.id,entry.checksum]);
  const archived=Number((await c.query(`SELECT count(*)::int n FROM public.staff_permission_override_removals WHERE migration='0056'`)).rows[0].n);
  if(archived!==denialsBefore)throw Error(refused);
  await registry(c,plan,56,refused);await proof();
  committing=true;await c.query('COMMIT');committed=true;
  await c.query('BEGIN READ ONLY');await registry(c,plan,56,refused);await proof();await c.query('ROLLBACK');
  return {status:'PRODUCTION_REFUND_AUTOMATION_INSTALLED',applied:[{id:entry.id,checksum:entry.checksum}],refundDenialsRemoved:denialsBefore,grantsAdded:0,credentialChanges:0,businessWrites:0};
 }catch(error){
  await c.query('ROLLBACK').catch(()=>{});
  if(committed)throw Error('PRODUCTION_REFUND_AUTOMATION_COMMITTED_READBACK_REQUIRED');
  if(committing)throw Error('PRODUCTION_REFUND_AUTOMATION_COMMIT_UNKNOWN_READBACK_REQUIRED');
  throw error;
 }
}

type AclRow={fn:string;grantee:string;priv:string};
const ACL_SQL=`SELECT p.oid::regprocedure::text AS fn,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type AS priv
 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid>=16384 AND p.pronamespace::regnamespace::text NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,3`;
/** Exactly three EXECUTE grants (the 0056 functions → <db>_operations), one transaction, registry exactly 0001–0056. The ACL delta over
 * every user function must be exactly those three additions, and per function only the owner and the operations role can execute. */
export async function applyProductionRefundAutomationGrants(c:PoolClient,database:string,owner:string){
 const refused=refusedGrants,role=database+'_operations',statements=productionRefundAutomationGrants(database,role);
 if(statements.length!==3||statements.some((s,i)=>s!==`GRANT EXECUTE ON FUNCTION ${FUNCTIONS[i]} TO ${role}`))throw Error(refused);
 const plan=await bootstrapPlan(database);
 if(plan.entries.length<56||plan.entries[55]?.id!=='0056')throw Error(refused);
 const acl=async()=>(await c.query<AclRow>(ACL_SQL)).rows,key=(r:AclRow)=>`${r.fn}|${r.grantee}|${r.priv}`;
 const proof=async(before?:AclRow[],after?:AclRow[])=>{
  for(const fn of FUNCTIONS){
   const owned=(await c.query(`SELECT pg_get_userbyid(p.proowner)=$2 AS ok FROM pg_proc p WHERE p.oid=$1::regprocedure`,[fn,owner])).rows[0];
   if(owned?.ok!==true)throw Error(refused);
   const holders=(await c.query<{rolname:string}>(`SELECT r.rolname FROM pg_roles r WHERE r.rolname<>$2 AND NOT r.rolsuper AND has_function_privilege(r.oid,$1::regprocedure,'EXECUTE') ORDER BY 1`,[fn,owner])).rows.map(r=>r.rolname);
   const publicExecute=(await c.query<{x:boolean}>(`SELECT has_function_privilege('public',$1::regprocedure,'EXECUTE') AS x`,[fn])).rows[0]!.x;
   if(after&&(JSON.stringify(holders)!==JSON.stringify([role])||publicExecute))throw Error(refused);
   if(!after&&(holders.length||publicExecute))throw Error(refused);
  }
  if(before&&after){
   const was=new Set(before.map(key)),now=new Set(after.map(key));
   const added=[...now].filter(k=>!was.has(k)).sort(),removed=[...was].filter(k=>!now.has(k));
   const expected=(await Promise.all(FUNCTIONS.map(async fn=>`${(await c.query<{n:string}>('SELECT $1::regprocedure::text AS n',[fn])).rows[0]!.n}|${role}|EXECUTE`))).sort();
   if(removed.length||JSON.stringify(added)!==JSON.stringify(expected))throw Error(refused);
  }
 };
 let committing=false,committed=false;
 try{
  await c.query('BEGIN');await ownerSession(c,database,owner,refused);
  await registry(c,plan,56,refused);
  const before=await acl();await proof();
  for(const sql of statements)await c.query(sql);
  const after=await acl();await proof(before,after);
  committing=true;await c.query('COMMIT');committed=true;
  await c.query('BEGIN READ ONLY');await registry(c,plan,56,refused);await proof(before,await acl());await c.query('ROLLBACK');
  return {status:'PRODUCTION_REFUND_AUTOMATION_GRANTS_INSTALLED',grants:FUNCTIONS.map(fn=>({fn,role})),otherAclChanges:0,schemaChanges:0,credentialChanges:0,businessWrites:0};
 }catch(error){
  await c.query('ROLLBACK').catch(()=>{});
  if(committed)throw Error('PRODUCTION_REFUND_AUTOMATION_GRANTS_COMMITTED_READBACK_REQUIRED');
  if(committing)throw Error('PRODUCTION_REFUND_AUTOMATION_GRANTS_COMMIT_UNKNOWN_READBACK_REQUIRED');
  throw error;
 }
}
