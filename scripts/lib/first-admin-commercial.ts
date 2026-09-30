import type {PoolClient} from 'pg';
import {FIRST_ADMIN_OWNER_EMAIL_FINGERPRINT} from './first-admin-bootstrap';
const actor='production-first-admin-commercial-permissions';
const reconciliation='PRODUCTION_FIRST_ADMIN_PERMISSION_RECONCILIATION_REQUIRED';
function refuse():never{throw Error(reconciliation);}
async function target(c:PoolClient){
 const counts=(await c.query(`SELECT (SELECT count(*)::int FROM staff_members) staff,(SELECT count(*)::int FROM auth_user) users,(SELECT count(*)::int FROM auth_account) accounts,(SELECT count(*)::int FROM staff_store_access) stores`)).rows[0];
 if(counts.staff!==1||counts.users!==1||counts.accounts!==1||counts.stores!==0)refuse();
 // Fingerprint only; profile/password/session values never leave this query.
 const row=(await c.query(`SELECT m.id,m.active,m.role,m.scope,m.revision,a."providerId",a."accountId"=m.id AS account_matches,encode(sha256(convert_to(lower(btrim(u.email)),'UTF8')),'hex') AS email_fingerprint FROM staff_members m JOIN auth_user u ON u.id=m.id JOIN auth_account a ON a."userId"=m.id`)).rows[0];
 if(!row||!row.active||row.role!=='ADMIN'||row.scope!=='ALL'||row.providerId!=='credential'||!row.account_matches||row.email_fingerprint!==FIRST_ADMIN_OWNER_EMAIL_FINGERPRINT)refuse();
 const overrides=(await c.query('SELECT permission,allowed FROM staff_permission_overrides WHERE staff_id=$1 ORDER BY permission',[row.id])).rows;
 if(overrides.length<1||overrides.length>2||!overrides.some(p=>p.permission==='PRICE_EDIT'&&p.allowed)||overrides.some(p=>!['PRICE_EDIT','QUOTE_VIEW'].includes(p.permission)||p.allowed!==true))refuse();
 const audit=Number((await c.query("SELECT count(*)::int n FROM staff_audit WHERE actor_staff_id=$1 AND target_staff_id=$2 AND event='PERMISSION_CHANGED'",[actor,row.id])).rows[0].n);
 return {...row,ready:overrides.some(p=>p.permission==='QUOTE_VIEW'),audit};
}
/** Internal transaction; the attended CLI first enforces fresh-main, fixed DB/TLS/owner.
 * No target, permission, identity or expected-state override is accepted. */
export async function completeFirstAdminCommercial(c:PoolClient){
 let committing=false,committed=false;
 try{
  await c.query('BEGIN');
  await c.query("SET LOCAL lock_timeout='10000ms'; SET LOCAL statement_timeout='10000ms'; SET LOCAL idle_in_transaction_session_timeout='15000ms'; SET LOCAL search_path=public,pg_catalog");
  await c.query('SELECT pg_advisory_xact_lock(7080501)');
  await c.query('LOCK TABLE staff_members,auth_user,auth_account,staff_store_access,staff_permission_overrides IN SHARE ROW EXCLUSIVE MODE');
  const before=await target(c);
  if(before.ready){await c.query('ROLLBACK');return {status:'ALREADY_READY',staff_members:1,PRICE_EDIT:true,QUOTE_VIEW:true,writes:0};}
  if(before.audit!==0)refuse();
  await c.query("SELECT set_config('zao.staff_actor',$1,true)",[actor]);
  await c.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,'QUOTE_VIEW',true)",[before.id]);
  const after=await target(c);
  if(!after.ready||after.id!==before.id||after.revision!==before.revision+1||after.audit!==1)refuse();
  committing=true;await c.query('COMMIT');committed=true;
  // Read-only reconciliation after COMMIT, not a second mutation attempt.
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const readback=await target(c);const sessions=(await c.query('SELECT count(*)::int n FROM auth_session')).rows[0].n as number;await c.query('ROLLBACK');
  if(!readback.ready||readback.id!==before.id||readback.revision!==after.revision||readback.audit!==1)refuse();
  return {status:'FIRST_ADMIN_COMMERCIAL_READY',staff_members:1,PRICE_EDIT:true,QUOTE_VIEW:true,active:true,role:'ADMIN',scope:'ALL',PERMISSION_CHANGED:1,revisionIncrement:1,auth_session:sessions,writes:1};
 }catch(error){
  await c.query('ROLLBACK').catch(()=>{});
  if(committed)throw Error('PRODUCTION_FIRST_ADMIN_PERMISSION_COMMITTED_READBACK_REQUIRED');
  if(committing)throw Error('PRODUCTION_FIRST_ADMIN_PERMISSION_COMMIT_UNKNOWN_READBACK_REQUIRED');
  throw error;
 }
}
export function firstAdminCommercialSafeError(error:unknown){
 const codes=[reconciliation,'PRODUCTION_FIRST_ADMIN_PERMISSION_COMMITTED_READBACK_REQUIRED','PRODUCTION_FIRST_ADMIN_PERMISSION_COMMIT_UNKNOWN_READBACK_REQUIRED'];
 return error instanceof Error&&codes.includes(error.message)?error.message:'PRODUCTION_FIRST_ADMIN_PERMISSION_OPERATION_FAILED';
}
