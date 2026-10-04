import type {PoolClient} from 'pg';
import {bootstrapPlan} from './production-bootstrap';
import {productionNormalWorkerGrants,productionPaymentRoleNames} from './production-payment-roles';
const refused='PRODUCTION_NORMAL_WORKER_GRANTS_REFUSED';
/** The four Owner-approved EXECUTE grants (Issue 47 comment 5970223877), one per function, nothing else. */
export function normalWorkerExecuteTargets(database:string){
 const n=productionPaymentRoleNames(database),operations=database+'_operations';
 return [
  {fn:'payment_reconciliation.dispatch_normal(text,integer,timestamptz)',role:n.dispatcher},
  {fn:'payment_reconciliation.claim_normal(text,integer,text,timestamptz)',role:n.worker},
  {fn:'payment_projection.normal_candidates(text,timestamptz,integer)',role:n.projector},
  {fn:'notification_due_normal(timestamptz,integer)',role:operations},
 ] as const;
}
type AclRow={fn:string;grantee:string;priv:string};
const ACL_SQL=`SELECT p.oid::regprocedure::text AS fn,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type AS priv
 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid>=16384 AND p.pronamespace::regnamespace::text NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,3`;
const key=(r:AclRow)=>`${r.fn}|${r.grantee}|${r.priv}`;
/** Additive finite-worker surface only: exactly four EXECUTE grants on the four reviewed functions, in one transaction under the
 * registry/inventory locks. Preconditions: owner session, the exact 55-entry registry, each function owned by the owner with an owner-only ACL.
 * Postcondition: the ACL delta over every user function is exactly those four additions, and per function only the owner and the one approved role
 * (directly and through membership) can execute; PUBLIC and every other neondb_ role cannot. A lost COMMIT means read-only reconciliation, never a rerun. */
export async function applyProductionNormalWorkerGrants(c:PoolClient,database:string,owner:string){
 const targets=normalWorkerExecuteTargets(database),statements=productionNormalWorkerGrants(database,database+'_operations');
 if(statements.length!==4||statements.some((s,i)=>s!==`GRANT EXECUTE ON FUNCTION ${targets[i]!.fn} TO ${targets[i]!.role}`))throw Error(refused);
 const plan=await bootstrapPlan(database);
 if(plan.entries.length!==55)throw Error(refused);
 const registry=async()=>{
  const rows=(await c.query('SELECT id,checksum FROM public.foundation_migrations ORDER BY id')).rows;
  if(rows.length!==55||rows.some((r,i)=>r.id!==plan.entries[i]!.id||r.checksum!==plan.entries[i]!.checksum))throw Error(refused);
 };
 const acl=async()=>(await c.query<AclRow>(ACL_SQL)).rows;
 const proof=async(before?:AclRow[],after?:AclRow[])=>{
  for(const t of targets){
   const row=(await c.query(`SELECT pg_get_userbyid(p.proowner)=$2 AS owner_ok FROM pg_proc p WHERE p.oid=$1::regprocedure`,[t.fn,owner])).rows[0];
   if(!row||row.owner_ok!==true)throw Error(refused);
   // Superusers always hold every privilege; every other role (directly or through membership) and PUBLIC must not.
   const holders=(await c.query<{rolname:string}>(`SELECT r.rolname FROM pg_roles r WHERE r.rolname<>$2 AND NOT r.rolsuper AND has_function_privilege(r.oid,$1::regprocedure,'EXECUTE') ORDER BY 1`,[t.fn,owner])).rows.map(r=>r.rolname);
   const publicExecute=(await c.query<{x:boolean}>(`SELECT has_function_privilege('public',$1::regprocedure,'EXECUTE') AS x`,[t.fn])).rows[0]!.x;
   if(after&&(JSON.stringify(holders)!==JSON.stringify([t.role])||publicExecute))throw Error(refused);
   if(!after&&(holders.length||publicExecute))throw Error(refused);
  }
  if(before&&after){
   const was=new Set(before.map(key)),now=new Set(after.map(key));
   const added=[...now].filter(k=>!was.has(k)).sort(),removed=[...was].filter(k=>!now.has(k));
   // regprocedure prints canonical type names (timestamp with time zone), so resolve each signature through the catalogue.
   const canonical=await Promise.all(targets.map(async t=>`${(await c.query<{n:string}>('SELECT $1::regprocedure::text AS n',[t.fn])).rows[0]!.n}|${t.role}|EXECUTE`));
   const expected=canonical.sort();
   if(removed.length||JSON.stringify(added)!==JSON.stringify(expected))throw Error(refused);
  }
 };
 let committing=false,committed=false;
 try{
  await c.query('BEGIN');
  await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='15000ms';SET LOCAL idle_in_transaction_session_timeout='20000ms';SET LOCAL search_path=public,pg_catalog");
  await c.query('SELECT pg_advisory_xact_lock(71820401),pg_advisory_xact_lock(71820600)');
  const id=(await c.query('SELECT current_database() db,current_user role,session_user login,pg_get_userbyid(datdba) owner FROM pg_database WHERE datname=current_database()')).rows[0];
  if(!id||id.db!==database||id.role!==owner||id.login!==owner||id.owner!==owner)throw Error(refused);
  await registry();
  const before=await acl();
  await proof();
  for(const sql of statements)await c.query(sql);
  const after=await acl();
  await proof(before,after);
  committing=true;await c.query('COMMIT');committed=true;
  await c.query('BEGIN READ ONLY');await registry();await proof(before,await acl());await c.query('ROLLBACK');
  return {status:'PRODUCTION_NORMAL_WORKER_GRANTS_INSTALLED',grants:targets.map(t=>({fn:t.fn,role:t.role})),otherAclChanges:0,schemaChanges:0,credentialChanges:0,businessWrites:0};
 }catch(error){
  await c.query('ROLLBACK').catch(()=>{});
  if(committed)throw Error('PRODUCTION_NORMAL_WORKER_GRANTS_COMMITTED_READBACK_REQUIRED');
  if(committing)throw Error('PRODUCTION_NORMAL_WORKER_GRANTS_COMMIT_UNKNOWN_READBACK_REQUIRED');
  throw error;
 }
}
