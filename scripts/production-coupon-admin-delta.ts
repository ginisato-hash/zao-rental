import type {PoolClient} from 'pg';
import {bootstrapPlan} from './production-bootstrap';

// Production delta for 0063 (coupon administration, Owner request 2026-11-25). Two fixed steps, each one transaction with an exact read-back:
//   migrate — registry must be exactly 0001–0062 with the canonical checksums; 0063 applies once; the new table is owner-owned and starts
//             empty. No grant, role, membership, ownership, credential or business-row change.
//   grants  — registry must be exactly 0001–0063; the pricing role may read/append coupon_status_events and execute the two functions; the
//             operations role (booking) may execute the two functions only; PUBLIC executes nothing; nobody updates or deletes events.
// The operator (production-install-coupon-admin.ts) admits only an exact accepted main, verify-full TLS owner session and a verified
// pre-0063 Production restore PASS before calling these. A lost COMMIT is reported as readback-required, never retried.
const refused='PRODUCTION_COUPON_ADMIN_RECONCILIATION_REQUIRED';
export const COUPON_ADMIN_TABLE='coupon_status_events';
export const COUPON_ADMIN_FUNCTIONS=['coupon_is_active(uuid)','coupon_booking_count(uuid)'] as const;
/** 0063 also replaces the 0053 terminalization function so that a coupon booking can terminalize (only a quote/snapshot coupon mismatch refuses). */
export const TERMINALIZE_FUNCTION='payment_projection.terminalize_expired_unbound_failed_production(uuid,uuid,uuid,text,text,bigint,text)';
const terminalizeIdentity=async(c:Pick<PoolClient,'query'>)=>(await c.query("SELECT pg_get_userbyid(p.proowner) owner,p.prosecdef sd,p.proconfig::text cfg,p.proacl::text acl,p.prosrc LIKE '%q.coupon_id IS DISTINCT FROM nullif(q.snapshot->>''couponVersionId'','''')::uuid%' narrowed,p.prosrc LIKE '%q.coupon_id IS NOT NULL%' legacy FROM pg_proc p WHERE p.oid=to_regprocedure($1)",[TERMINALIZE_FUNCTION])).rows[0] as {owner:string;sd:boolean;cfg:string;acl:string|null;narrowed:boolean;legacy:boolean}|undefined;
const REQUIRED_TRIGGERS=['coupon_status_lock','coupon_status_immutable','coupon_status_audit'] as const;

type Entry={id:string;checksum:string;sql:string};
async function plan(database:string){const p=await bootstrapPlan(database);const e=p.entries as Entry[];
 // The plan may carry later migrations; this delta is always exactly 0063 on a 0001-0062 database.
 if(e.length<63||e[62]?.id!=='0063')throw Error(refused);return e.slice(0,63);}
async function identity(c:PoolClient,database:string,owner:string){
 const id=(await c.query('SELECT current_database() db,current_user role,session_user login,pg_get_userbyid(datdba) owner FROM pg_database WHERE datname=current_database()')).rows[0];
 if(!id||id.db!==database||id.role!==owner||id.login!==owner||id.owner!==owner)throw Error(refused);
}
async function registry(c:PoolClient,entries:Entry[],count:number){
 const rows=(await c.query('SELECT id,checksum FROM public.foundation_migrations ORDER BY id')).rows;
 if(rows.length!==count||rows.some((r,i)=>r.id!==entries[i]!.id||r.checksum!==entries[i]!.checksum))throw Error(refused);
}
async function begin(c:PoolClient,readOnly=false){
 await c.query(readOnly?'BEGIN READ ONLY':'BEGIN');
 await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='15000ms';SET LOCAL idle_in_transaction_session_timeout='20000ms';SET LOCAL search_path=public,pg_catalog");
}
/** Structure that normal service traffic cannot change: table ownership, the three evidence triggers firing in ordinary sessions
 * (tgenabled O or A; R and D refused), both functions present, SECURITY DEFINER, owner-owned with a fixed search_path. */
export async function couponAdminCommittedProof(c:Pick<PoolClient,'query'>,owner:string){
 const t=(await c.query('SELECT pg_get_userbyid(c.relowner)=$1 owner_ok FROM pg_class c WHERE c.oid=to_regclass($2)',[owner,'public.'+COUPON_ADMIN_TABLE])).rows[0];if(!t||t.owner_ok!==true)throw Error(refused);
 for(const trigger of REQUIRED_TRIGGERS)if((await c.query("SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgname=$2 AND tgenabled IN ('O','A') AND NOT tgisinternal",['public.'+COUPON_ADMIN_TABLE,trigger])).rowCount!==1)throw Error(refused);
 for(const fn of COUPON_ADMIN_FUNCTIONS){const r=(await c.query("SELECT p.prosecdef sd,pg_get_userbyid(p.proowner)=$2 owner_ok,coalesce(p.proconfig::text LIKE '%search_path=%',false) sp FROM pg_proc p WHERE p.oid=to_regprocedure($1)",[fn,owner])).rows[0];if(!r||r.sd!==true||r.owner_ok!==true||r.sp!==true)throw Error(refused);}
  // The replaced 0053 function: narrowed coupon refusal in place, still SECURITY DEFINER and owner-owned.
 const f=await terminalizeIdentity(c);if(!f||f.owner!==owner||f.sd!==true||f.narrowed!==true||f.legacy!==false)throw Error(refused);
}

/** `afterCommit` exists only so a test can let the live service write between COMMIT and the read-back. */
export async function applyProductionCouponAdminMigration(c:PoolClient,database:string,owner:string,seams:{afterCommit?:()=>Promise<void>}={}){
 const entries=await plan(database);let committing=false,committed=false;
 try{
  await begin(c);
  await c.query('SELECT pg_advisory_xact_lock(71820401),pg_advisory_xact_lock(71820800)');
  await c.query('LOCK TABLE public.foundation_migrations IN EXCLUSIVE MODE');
  await identity(c,database,owner);await registry(c,entries,62);
  if((await c.query('SELECT to_regclass($1) IS NULL absent',['public.'+COUPON_ADMIN_TABLE])).rows[0]?.absent!==true)throw Error(refused);
  const roles=(await c.query('SELECT count(*)::int r,(SELECT count(*)::int FROM pg_auth_members) m FROM pg_roles')).rows[0];
  const terminalizeBefore=await terminalizeIdentity(c);if(!terminalizeBefore||terminalizeBefore.owner!==owner||terminalizeBefore.legacy!==true)throw Error(refused);
  const entry=entries[62]!;await c.query(entry.sql);await c.query('INSERT INTO public.foundation_migrations(id,checksum) VALUES($1,$2)',[entry.id,entry.checksum]);
  await registry(c,entries,63);await couponAdminCommittedProof(c,owner);
  // CREATE OR REPLACE must keep owner, ACL, SECURITY DEFINER and settings of the 0053 function exactly.
  const terminalizeAfter=await terminalizeIdentity(c);if(JSON.stringify([terminalizeAfter?.owner,terminalizeAfter?.sd,terminalizeAfter?.cfg,terminalizeAfter?.acl])!==JSON.stringify([terminalizeBefore.owner,terminalizeBefore.sd,terminalizeBefore.cfg,terminalizeBefore.acl]))throw Error(refused);
  if(Number((await c.query(`SELECT count(*)::int n FROM public.${COUPON_ADMIN_TABLE}`)).rows[0].n)!==0)throw Error(refused);
  const after=(await c.query('SELECT count(*)::int r,(SELECT count(*)::int FROM pg_auth_members) m FROM pg_roles')).rows[0];
  if(after.r!==roles.r||after.m!==roles.m)throw Error(refused);
  committing=true;await c.query('COMMIT');committed=true;await seams.afterCommit?.();
  // After COMMIT staff may already disable a coupon; the read-back proves structure only, never "still empty".
  await begin(c,true);await registry(c,entries,63);await couponAdminCommittedProof(c,owner);await c.query('ROLLBACK');
  return {status:'PRODUCTION_COUPON_ADMIN_INSTALLED',applied:[{id:entry.id,checksum:entry.checksum}],grantsAdded:0,roleChanges:0,credentialChanges:0,businessWrites:0};
 }catch(error){
  await c.query('ROLLBACK').catch(()=>{});
  if(committed)throw Error('PRODUCTION_COUPON_ADMIN_COMMITTED_READBACK_REQUIRED');
  if(committing)throw Error('PRODUCTION_COUPON_ADMIN_COMMIT_UNKNOWN_READBACK_REQUIRED');
  throw error;
 }
}

export function productionCouponAdminGrants(database:string,pricingRole:string,operationsRole:string):string[]{
 if(!/^[a-z][a-z0-9_]{0,40}$/.test(database)||pricingRole!==database+'_pricing'||operationsRole!==database+'_operations')throw Error('PRODUCTION_COUPON_ADMIN_GRANTS_REFUSED');
 const fns=COUPON_ADMIN_FUNCTIONS.join(',');
 return [`GRANT SELECT,INSERT ON ${COUPON_ADMIN_TABLE} TO ${pricingRole}`,`GRANT EXECUTE ON FUNCTION ${fns} TO ${pricingRole}`,`GRANT EXECUTE ON FUNCTION ${fns} TO ${operationsRole}`];
}
/** Exact expected privileges (the same set as the production role plan): pricing reads/appends events and executes both functions;
 * operations executes both functions only; nobody updates, deletes or truncates the events; PUBLIC executes nothing. */
export async function couponAdminGrantProof(c:Pick<PoolClient,'query'>,pricingRole:string,operationsRole:string){
 const has=async(sql:string,args:unknown[])=>(await c.query(sql,args)).rows[0]?.ok===true;
 for(const role of [pricingRole,operationsRole])for(const fn of COUPON_ADMIN_FUNCTIONS)if(!await has("SELECT has_function_privilege($1,$2,'EXECUTE') ok",[role,fn]))throw Error(refused);
 for(const fn of COUPON_ADMIN_FUNCTIONS)if(await has("SELECT has_function_privilege('public',$1,'EXECUTE') ok",[fn]))throw Error(refused);
 for(const p of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']){
  if(await has('SELECT has_table_privilege($1,$2,$3) ok',[pricingRole,COUPON_ADMIN_TABLE,p])!==(p==='SELECT'||p==='INSERT'))throw Error(refused);
  if(await has('SELECT has_table_privilege($1,$2,$3) ok',[operationsRole,COUPON_ADMIN_TABLE,p]))throw Error(refused);
  if(await has('SELECT has_table_privilege(\'public\',$1,$2) ok',[COUPON_ADMIN_TABLE,p]))throw Error(refused);
 }
}

export async function applyProductionCouponAdminGrants(c:PoolClient,database:string,owner:string){
 const entries=await plan(database),pricingRole=database+'_pricing',operationsRole=database+'_operations';let committing=false,committed=false;
 try{
  await begin(c);
  await identity(c,database,owner);await registry(c,entries,63);
  if((await c.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1)',[[pricingRole,operationsRole]])).rowCount!==2)throw Error(refused);
  const sql=productionCouponAdminGrants(database,pricingRole,operationsRole);
  for(const s of sql)await c.query(s);
  await couponAdminGrantProof(c,pricingRole,operationsRole);
  committing=true;await c.query('COMMIT');committed=true;
  await begin(c,true);await registry(c,entries,63);await couponAdminGrantProof(c,pricingRole,operationsRole);await c.query('ROLLBACK');
  return {status:'PRODUCTION_COUPON_ADMIN_GRANTS_INSTALLED',grantStatements:sql.length,roleChanges:0,credentialChanges:0,businessWrites:0};
 }catch(error){
  await c.query('ROLLBACK').catch(()=>{});
  if(committed)throw Error('PRODUCTION_COUPON_ADMIN_GRANTS_COMMITTED_READBACK_REQUIRED');
  if(committing)throw Error('PRODUCTION_COUPON_ADMIN_GRANTS_COMMIT_UNKNOWN_READBACK_REQUIRED');
  throw error;
 }
}

/** Read-only check of the installed 0063 delta (no write, BEGIN READ ONLY): exact 0001-0063 registry, owner-owned table and the two
 * SECURITY DEFINER functions with fixed search_path, the three evidence triggers enabled, the exact grants, and counts of status events and
 * disabled coupons. Used to read back after an uncertain COMMIT and before/after a deployment rollback (RELEASE_RUNBOOK). Counts only. */
export async function verifyProductionCouponAdmin(c:PoolClient,database:string,owner:string){
 const entries=await plan(database);
 try{
  await begin(c,true);
  await identity(c,database,owner);await registry(c,entries,63);await couponAdminCommittedProof(c,owner);await couponAdminGrantProof(c,database+'_pricing',database+'_operations');
  const r=(await c.query(`SELECT count(*)::int events,(SELECT count(*)::int FROM public.coupon_versions v WHERE NOT public.coupon_is_active(v.id)) disabled,(SELECT count(*)::int FROM public.coupon_versions) coupons FROM public.${COUPON_ADMIN_TABLE}`)).rows[0];
  await c.query('ROLLBACK');
  return {status:'PRODUCTION_COUPON_ADMIN_VERIFIED',registry:63,eventLog:'APPEND_ONLY',statusEvents:Number(r.events),disabledCoupons:Number(r.disabled),coupons:Number(r.coupons),writes:0};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}
}
