import type {PoolClient} from 'pg';
import {bootstrapPlan} from './production-bootstrap';
import {groupNotificationRoleDelta} from './group-notification-role';

// Production delta for 0064 (group order core, Issue #47). Two fixed steps, each one transaction with an exact read-back, plus a read-only verify:
//   migrate - registry must be exactly 0001-0063 with the canonical checksums; 0064 applies once as the database owner (it touches no object owned by the custody
//             executor: the Owner decision of 2026-11-27 moved that part to 0065); every new table is owner-owned and starts empty (no entrance row, no group, no event,
//             no notice); the executor-owned custody functions and the ordinary loan trigger are proven byte-identical before and after. No grant, role, membership,
//             ownership, credential or business-row change.
//   grants  - registry must be exactly 0001-0064; creates the dedicated group application role `<db>_group` (NOLOGIN: the credential and LOGIN are a later, separate
//             Owner step) through the existing NOLOGIN role manager `<db>_role_admin` (the owner never creates a role itself), and gives exactly: group role = hold role
//             privileges (mirrored from the catalog) + group table DML + group_register_actor + the notification delivery columns (the notification worker uses this same
//             role, column-limited); nothing to any other role or PUBLIC. Custody-link grants (operations / executor on group tables) belong to 0065 and are NOT installed here.
//   verify  - READ ONLY: exact registry (0001-0064; a registered 0065 is read separately), owner-owned structure, enabled triggers, SECURITY DEFINER + fixed search_path,
//             exact privileges, the absence (or, if applied, the exact shape) of the custody link, counts only.
// 0065 (the custody link) is deliberately NOT part of this installer: it touches executor-owned objects and waits for a privileged path (RELEASE_RUNBOOK).
// The operator (production-install-group.ts) admits only an exact accepted main, verify-full TLS owner session and a verified pre-0064 Production
// restore PASS before calling the writing steps. A lost COMMIT is reported as readback-required, never retried.
const refused='PRODUCTION_GROUP_RECONCILIATION_REQUIRED';
const NEXT='0064',LINK='0065';
export const GROUP_TABLES=['group_entrance','group_entrance_history','group_orders','group_events','group_members','group_order_parts','group_quotes','group_consents','group_adjustments','group_change_requests','group_payments','group_requests','group_notification_outbox'] as const;
/** The 13 group tables 0064 adds. The custody-side preparation record belongs to the custody link (0065). */
export const CUSTODY_LINK_TABLES=['group_part_preparations'] as const;
export const GROUP_SEQUENCE='group_number_seq';
type FnSpec={sig:string;definer:boolean;executor?:boolean;publicExecute:boolean};
/** Functions 0064 creates (identity arguments). `definer` = SECURITY DEFINER with a fixed search_path. All are owner-owned. */
export const GROUP_FUNCTIONS:ReadonlyArray<FnSpec>=[
 {sig:'group_op_allowed()',definer:false,publicExecute:true},
 {sig:'group_custody_hold_update(inventory_holds,inventory_holds)',definer:true,publicExecute:true},
 {sig:'group_staff_can(text,text,text[])',definer:true,publicExecute:true},
 {sig:'group_register_actor(uuid)',definer:true,publicExecute:false},
 {sig:'group_event_outbox()',definer:true,publicExecute:false},
 ...['group_hold_guard()','group_claim_guard()','group_booking_guard()','group_append_only()','group_entrance_guard()','group_member_guard()','group_part_guard()','group_adjustment_guard()','group_change_request_guard()','group_payment_guard()','group_order_guard()','group_consistency()','group_order_event()'].map(sig=>({sig,definer:false,publicExecute:false})),
];
/** Functions only the custody link (0065) creates. `rental_validate_group_loan()` is executor-owned (like the ordinary loan validator). */
export const CUSTODY_LINK_FUNCTIONS:ReadonlyArray<FnSpec>=[
 {sig:'group_custody_stage_ok(inventory_holds,inventory_holds)',definer:true,publicExecute:true},
 {sig:'group_member_manual_fit(jsonb)',definer:false,publicExecute:true},
 {sig:'rental_validate_group_loan()',definer:true,executor:true,publicExecute:false},
];
/** Executor-owned custody objects the owner path must never change. 0064 leaves them untouched; 0065 replaces the first two (CREATE OR REPLACE keeps owner/ACL). */
export const REPLACED_FUNCTIONS=['rental_apply_receipt(uuid)','rental_stage_guard()'] as const;
export const PROTECTED_CUSTODY_FUNCTIONS=[...REPLACED_FUNCTIONS,'rental_validate_loan()'] as const;
export const GROUP_TRIGGERS:ReadonlyArray<readonly [string,string]>=[
 ['inventory_holds','group_hold_guard'],['inventory_claims','group_claim_guard'],['provisional_capacity_claims','group_claim_guard'],['wear_claims','group_claim_guard'],['rental_bookings','group_booking_guard'],
 ['group_entrance_history','group_entrance_history_guard'],['group_entrance','group_entrance_guard'],['group_events','group_events_guard'],['group_events','group_event_outbox'],
 ['group_members','group_member_guard'],['group_order_parts','group_part_guard'],['group_quotes','group_quotes_guard'],['group_consents','group_consents_guard'],['group_adjustments','group_adjustment_guard'],
 ['group_change_requests','group_change_request_guard'],['group_payments','group_payment_guard'],['group_requests','group_requests_guard'],
 ['group_orders','group_order_guard'],['group_orders','group_consistency'],['group_orders','group_order_event'],
];
export const CUSTODY_LINK_TRIGGERS:ReadonlyArray<readonly [string,string]>=[
 ['group_part_preparations','group_part_preparations_lock'],['group_part_preparations','group_part_preparations_audit'],
 ['rental_loan_items','rental_validate_loan'],['rental_loan_items','rental_validate_group_loan'],
];
export const GROUP_PERMISSIONS=['GROUP_VIEW','GROUP_ENTRANCE_MANAGE','GROUP_APPROVE','GROUP_DISCOUNT','GROUP_RELEASE','GROUP_CANCEL','GROUP_PAYMENT_RECORD'] as const;
/** The group application role also reads these (the allocator and the quote read them); granted only where the hold role does not already have them. */
export const GROUP_EXTRA_READS=['price_books','price_activations','booking_actors','provisional_capacity_buckets'] as const;
const GROUP_DML:ReadonlyArray<readonly [string,string]>=[
 ['SELECT,INSERT,UPDATE','group_entrance,group_orders,group_order_parts,group_change_requests'],
 ['SELECT,INSERT,UPDATE,DELETE','group_members'],
 ['SELECT,INSERT','group_entrance_history,group_events,group_quotes,group_consents,group_adjustments,group_payments,group_requests,group_notification_outbox'],
];
/** Custody link (0065) privileges, NOT installed by this tool (0065 waits for a privileged path). Listed so verify can read a database where 0065 was applied by another
 * route, and so the development role scripts and this file cannot drift: operations reads the confirmed group and records the part's own preparation. */
export const CUSTODY_LINK_OPERATIONS_GRANTS:ReadonlyArray<string>=['GRANT SELECT ON group_orders,group_order_parts,group_members,group_payments TO {OPS}','GRANT SELECT,INSERT ON group_part_preparations TO {OPS}','GRANT UPDATE(prepared_at,prepared_by,fit_evidence,version) ON group_part_preparations TO {OPS}'];

type Entry={id:string;checksum:string;sql:string};
/** All plan entries (0001-0065). The delta itself is always exactly 0064 on a 0001-0063 database; 0065 is only ever READ (verify), never applied here. */
async function plan(database:string){const p=await bootstrapPlan(database);const e=p.entries as Entry[];
 if(e.length<65||e[63]?.id!==NEXT||e[64]?.id!==LINK)throw Error(refused);return e;}
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
 await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='30000ms';SET LOCAL idle_in_transaction_session_timeout='40000ms';SET LOCAL search_path=public,pg_catalog");
}
type FnIdentity={owner:string;sd:boolean;cfg:string|null;acl:string|null;def:string};
/** Identity of a function including a digest of its full definition (owner, SECURITY DEFINER, settings, ACL, source). */
const fnIdentity=async(c:Pick<PoolClient,'query'>,sig:string)=>(await c.query('SELECT pg_get_userbyid(p.proowner) owner,p.prosecdef sd,p.proconfig::text cfg,p.proacl::text acl,md5(pg_get_functiondef(p.oid)) def FROM pg_proc p WHERE p.oid=to_regprocedure($1)',[sig])).rows[0] as FnIdentity|undefined;
/** The ordinary loan trigger as the database defines it (unconditional until 0065 limits it to non-group loans). */
const loanTriggerDef=async(c:Pick<PoolClient,'query'>)=>(await c.query("SELECT md5(string_agg(pg_get_triggerdef(t.oid)||'|'||t.tgenabled::text,';' ORDER BY t.tgname)) d FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.rental_loan_items') AND NOT t.tgisinternal")).rows[0]?.d as string|null;

/** Structure that normal service traffic cannot change: owner-owned relations, every guard trigger firing in ordinary sessions (tgenabled O or A;
 * R and D refused), every function present with its SECURITY DEFINER flag, a fixed search_path where the definer needs one, the right owner, the
 * GROUP_* permissions of the ADMIN role, and the no-expiry hold kind. */
export async function groupCommittedProof(c:Pick<PoolClient,'query'>,database:string,owner:string){
 const executor=database+'_custody_executor';
 for(const t of GROUP_TABLES){const r=(await c.query("SELECT c.relkind k,pg_get_userbyid(c.relowner)=$2 owner_ok FROM pg_class c WHERE c.oid=to_regclass($1)",['public.'+t,owner])).rows[0];if(!r||r.k!=='r'||r.owner_ok!==true)throw Error(refused);}
 const sq=(await c.query("SELECT c.relkind k,pg_get_userbyid(c.relowner)=$2 owner_ok FROM pg_class c WHERE c.oid=to_regclass($1)",['public.'+GROUP_SEQUENCE,owner])).rows[0];if(!sq||sq.k!=='S'||sq.owner_ok!==true)throw Error(refused);
 for(const [table,trigger] of GROUP_TRIGGERS)if((await c.query("SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgname=$2 AND tgenabled IN ('O','A') AND NOT tgisinternal",['public.'+table,trigger])).rowCount!==1)throw Error(refused);
 for(const f of GROUP_FUNCTIONS){
  const r=(await c.query("SELECT p.prosecdef sd,pg_get_userbyid(p.proowner) owner,coalesce(p.proconfig::text LIKE '%search_path=%',false) sp FROM pg_proc p WHERE p.oid=to_regprocedure($1)",[f.sig])).rows[0];
  if(!r||r.sd!==f.definer||r.owner!==(f.executor?executor:owner)||(f.definer&&r.sp!==true))throw Error(refused);
 }
 // The executor-owned custody functions keep their executor ownership and are still definers with a fixed path (rental_validate_loan: owner only).
 for(const sig of REPLACED_FUNCTIONS){const r=await fnIdentity(c,sig);if(!r||r.owner!==executor||r.sd!==true||!/search_path=/.test(r.cfg??''))throw Error(refused);}
 {const r=await fnIdentity(c,'rental_validate_loan()');if(!r||r.owner!==executor)throw Error(refused);}
 const perms=(await c.query("SELECT count(*)::int n FROM staff_role_permissions WHERE role='ADMIN' AND permission=ANY($1)",[GROUP_PERMISSIONS as unknown as string[]])).rows[0];
 if(perms.n!==GROUP_PERMISSIONS.length)throw Error(refused);
 if((await c.query("SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.inventory_holds') AND conname='inventory_holds_allocation_stage_check' AND pg_get_constraintdef(oid) LIKE '%GROUP_RESERVED%'")).rowCount!==1)throw Error(refused);
 for(const n of ['inventory_hold_expiry_required','inventory_hold_group_no_expiry'])if((await c.query("SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.inventory_holds') AND conname=$1 AND convalidated",[n])).rowCount!==1)throw Error(refused);
}

/** 0064 only: the custody link must be wholly absent and ordinary custody exactly as before (no group column on a loan, the ordinary loan validator
 * unconditional, no group loan validator, no preparation record). A half-applied link is refused. */
export async function custodyLinkAbsentProof(c:Pick<PoolClient,'query'>){
 const cols=(await c.query("SELECT attname,attnotnull FROM pg_attribute WHERE attrelid=to_regclass('public.rental_loan_items') AND attname IN ('group_part_id','hold_id','booking_id') AND NOT attisdropped ORDER BY attname")).rows as {attname:string;attnotnull:boolean}[];
 if(cols.length!==1||cols[0]!.attname!=='booking_id'||cols[0]!.attnotnull!==true)throw Error(refused);
 for(const t of CUSTODY_LINK_TABLES)if((await c.query('SELECT to_regclass($1) IS NULL absent',['public.'+t])).rows[0]?.absent!==true)throw Error(refused);
 for(const f of CUSTODY_LINK_FUNCTIONS)if((await c.query('SELECT to_regprocedure($1) IS NULL absent',[f.sig])).rows[0]?.absent!==true)throw Error(refused);
 const t=(await c.query("SELECT t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) d FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.rental_loan_items') AND t.tgname IN ('rental_validate_loan','rental_validate_group_loan') AND NOT t.tgisinternal")).rows as {tgname:string;tgenabled:string;d:string}[];
 if(t.length!==1||t[0]!.tgname!=='rental_validate_loan'||!['O','A'].includes(t[0]!.tgenabled)||/ WHEN /.test(t[0]!.d))throw Error(refused);
}
/** 0065 registered (applied by a privileged path outside this installer): the link must have exactly the reviewed shape. Read separately from the core. */
export async function custodyLinkAppliedProof(c:Pick<PoolClient,'query'>,database:string,owner:string){
 const executor=database+'_custody_executor';
 const cols=(await c.query("SELECT attname,attnotnull FROM pg_attribute WHERE attrelid=to_regclass('public.rental_loan_items') AND attname IN ('group_part_id','hold_id','booking_id') AND NOT attisdropped ORDER BY attname")).rows as {attname:string;attnotnull:boolean}[];
 if(cols.map(x=>x.attname).join()!=='booking_id,group_part_id,hold_id'||cols.find(x=>x.attname==='booking_id')!.attnotnull!==false)throw Error(refused);
 for(const t of CUSTODY_LINK_TABLES){const r=(await c.query("SELECT c.relkind k,pg_get_userbyid(c.relowner)=$2 owner_ok FROM pg_class c WHERE c.oid=to_regclass($1)",['public.'+t,owner])).rows[0];if(!r||r.k!=='r'||r.owner_ok!==true)throw Error(refused);}
 for(const [table,trigger] of CUSTODY_LINK_TRIGGERS)if((await c.query("SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgname=$2 AND tgenabled IN ('O','A') AND NOT tgisinternal",['public.'+table,trigger])).rowCount!==1)throw Error(refused);
 const wh=(await c.query("SELECT t.tgname,pg_get_triggerdef(t.oid) d FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.rental_loan_items') AND t.tgname IN ('rental_validate_loan','rental_validate_group_loan') AND NOT t.tgisinternal")).rows as {tgname:string;d:string}[];
 if(wh.length!==2||!/group_part_id IS NULL/.test(wh.find(r=>r.tgname==='rental_validate_loan')!.d)||!/group_part_id IS NOT NULL/.test(wh.find(r=>r.tgname==='rental_validate_group_loan')!.d))throw Error(refused);
 for(const f of CUSTODY_LINK_FUNCTIONS){
  const r=(await c.query("SELECT p.prosecdef sd,pg_get_userbyid(p.proowner) owner,coalesce(p.proconfig::text LIKE '%search_path=%',false) sp FROM pg_proc p WHERE p.oid=to_regprocedure($1)",[f.sig])).rows[0];
  if(!r||r.sd!==f.definer||r.owner!==(f.executor?executor:owner)||(f.definer&&r.sp!==true))throw Error(refused);
 }
}

/** `afterCommit` exists only so a test can let the live service write between COMMIT and the read-back. */
export async function applyProductionGroupMigration(c:PoolClient,database:string,owner:string,seams:{afterCommit?:()=>Promise<void>}={}){
 const entries=await plan(database);let committing=false,committed=false;
 try{
  await begin(c);
  await c.query('SELECT pg_advisory_xact_lock(71820401),pg_advisory_xact_lock(71820600)');
  await c.query('LOCK TABLE public.foundation_migrations IN EXCLUSIVE MODE');
  await identity(c,database,owner);await registry(c,entries,63);
  if((await c.query('SELECT to_regclass($1) IS NULL absent',['public.group_orders'])).rows[0]?.absent!==true)throw Error(refused);
  const roles=(await c.query('SELECT count(*)::int r,(SELECT count(*)::int FROM pg_auth_members) m FROM pg_roles')).rows[0];
  const before:Record<string,FnIdentity|undefined>={};for(const sig of PROTECTED_CUSTODY_FUNCTIONS)before[sig]=await fnIdentity(c,sig);
  for(const sig of PROTECTED_CUSTODY_FUNCTIONS)if(!before[sig]||(sig!=='rental_validate_loan()'&&before[sig]!.sd!==true))throw Error(refused);
  const loanTriggers=await loanTriggerDef(c);
  await custodyLinkAbsentProof(c);
  const entry=entries[63]!;
  // 0064 touches no executor-owned object (the custody link is 0065), so the owner applies it. Should PostgreSQL still refuse a statement (42501: the Production
  // topology changed, or someone edited the file), the whole transaction rolls back and the refusal is one fixed code; nothing is partially applied.
  try{await c.query(entry.sql);}catch(e){if((e as {code?:string}).code==='42501')throw Error('PRODUCTION_GROUP_EXECUTOR_OWNED_OBJECTS_BLOCKED');throw e;}
  await c.query('INSERT INTO public.foundation_migrations(id,checksum) VALUES($1,$2)',[entry.id,entry.checksum]);
  await registry(c,entries,64);await groupCommittedProof(c,database,owner);
  // The executor-owned custody functions and the ordinary loan trigger are byte-identical (owner, ACL, SECURITY DEFINER, settings, source); the link stays absent.
  for(const sig of PROTECTED_CUSTODY_FUNCTIONS){const a=await fnIdentity(c,sig);if(JSON.stringify(a)!==JSON.stringify(before[sig]))throw Error(refused);}
  if(await loanTriggerDef(c)!==loanTriggers)throw Error(refused);await custodyLinkAbsentProof(c);
  for(const t of GROUP_TABLES)if(Number((await c.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n)!==0)throw Error(refused);
  const after=(await c.query('SELECT count(*)::int r,(SELECT count(*)::int FROM pg_auth_members) m FROM pg_roles')).rows[0];
  if(after.r!==roles.r||after.m!==roles.m)throw Error(refused);
  committing=true;await c.query('COMMIT');committed=true;await seams.afterCommit?.();
  // After COMMIT the live service may already write; the read-back proves structure only, never "still empty".
  await begin(c,true);await registry(c,entries,64);await groupCommittedProof(c,database,owner);await custodyLinkAbsentProof(c);await c.query('ROLLBACK');
  return {status:'PRODUCTION_GROUP_INSTALLED',applied:[{id:entry.id,checksum:entry.checksum}],grantsAdded:0,roleChanges:0,credentialChanges:0,businessWrites:0};
 }catch(error){
  await c.query('ROLLBACK').catch(()=>{});
  if(committed)throw Error('PRODUCTION_GROUP_COMMITTED_READBACK_REQUIRED');
  if(committing)throw Error('PRODUCTION_GROUP_COMMIT_UNKNOWN_READBACK_REQUIRED');
  throw error;
 }
}

const IDENT=/^[a-z][a-z0-9_]{0,40}$/;
const q=(v:string)=>{if(!/^[a-z][a-z0-9_]{0,62}$/.test(v))throw Error('PRODUCTION_GROUP_GRANTS_REFUSED');return '"'+v+'"';};
export type GroupRoles={group:string;hold:string;operations:string;manager:string;executor:string};
export function groupRoleNames(database:string):GroupRoles{
 if(!IDENT.test(database))throw Error('PRODUCTION_GROUP_GRANTS_REFUSED');
 return {group:database+'_group',hold:database+'_hold',operations:database+'_operations',manager:database+'_role_admin',executor:database+'_custody_executor'};
}
/** Group-specific privileges (everything the hold role does not already give the group role). Pure and fixed. */
export function productionGroupDeltaGrants(database:string):string[]{
 const r=groupRoleNames(database),g=q(r.group);
 return [
  ...GROUP_DML.map(([p,t])=>`GRANT ${p} ON ${t} TO ${g}`),
  `GRANT USAGE ON SEQUENCE ${GROUP_SEQUENCE} TO ${g}`,
  `GRANT EXECUTE ON FUNCTION group_register_actor(uuid) TO ${g}`,
  groupNotificationRoleDelta(r.group).replace(/ TO .*$/,` TO ${g}`),
 ];
}
export const ROLE_CREATE_SQL=(database:string)=>`CREATE ROLE ${q(groupRoleNames(database).group)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`;

type Acl={tables:string[];columns:string[];sequences:string[];functions:string[];schemas:string[]};
/** Everything a role is granted outside the group objects, as comparable strings, read from the catalog (system schemas excluded). */
async function roleAcl(c:Pick<PoolClient,'query'>,role:string):Promise<Acl>{
 const rel=(await c.query(`SELECT n.nspname||'.'||c.relname||'|'||a.privilege_type k,c.relkind kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
  WHERE c.relkind IN ('r','v','m','p','S') AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname=$1) AND c.relname<>ALL($2) ORDER BY 1`,[role,[...GROUP_TABLES,...CUSTODY_LINK_TABLES,GROUP_SEQUENCE]])).rows as {k:string;kind:string}[];
 const cols=(await c.query(`SELECT n.nspname||'.'||c.relname||'.'||t.attname||'|'||a.privilege_type k FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace,aclexplode(t.attacl) a
  WHERE t.attacl IS NOT NULL AND NOT t.attisdropped AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname=$1) AND c.relname<>ALL($2) ORDER BY 1`,[role,[...GROUP_TABLES,...CUSTODY_LINK_TABLES,GROUP_SEQUENCE]])).rows.map(r=>r.k as string);
 const fns=(await c.query(`SELECT p.oid::regprocedure::text k FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND a.privilege_type='EXECUTE' AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname=$1) AND p.oid::regprocedure::text<>ALL($2) ORDER BY 1`,[role,[...GROUP_FUNCTIONS,...CUSTODY_LINK_FUNCTIONS].map(f=>f.sig)])).rows.map(r=>r.k as string);
 const schemas=(await c.query(`SELECT n.nspname||'|'||a.privilege_type k FROM pg_namespace n,aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND n.nspname NOT LIKE 'pg_%' AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname=$1) ORDER BY 1`,[role])).rows.map(r=>r.k as string);
 return {tables:rel.filter(r=>r.kind!=='S').map(r=>r.k),sequences:rel.filter(r=>r.kind==='S').map(r=>r.k),columns:cols,functions:fns,schemas};
}
const norm=(v:Acl,extraTables:string[])=>JSON.stringify({...v,tables:[...v.tables,...extraTables].sort()});
/** Statements that mirror the hold role (tables, columns, sequences, functions, schema USAGE) onto the group role, from the live catalog. */
async function holdMirror(c:Pick<PoolClient,'query'>,database:string):Promise<string[]>{
 const r=groupRoleNames(database),g=q(r.group),hold=await roleAcl(c,r.hold),out:string[]=[`GRANT CONNECT ON DATABASE ${q(database)} TO ${g}`];
 const id=(s:string)=>{const [n,...rest]=s.split('.');return '"'+n+'"."'+rest.join('.')+'"';};
 for(const k of hold.schemas){const [n,p]=k.split('|');if(p==='USAGE')out.push(`GRANT USAGE ON SCHEMA "${n}" TO ${g}`);}
 for(const k of hold.tables){const [o,p]=k.split('|');out.push(`GRANT ${p} ON ${id(o!)} TO ${g}`);}
 for(const k of hold.columns){const [o,p]=k.split('|');const parts=o!.split('.');out.push(`GRANT ${p}("${parts[2]}") ON "${parts[0]}"."${parts[1]}" TO ${g}`);}
 for(const k of hold.sequences){const [o,p]=k.split('|');out.push(`GRANT ${p} ON SEQUENCE ${id(o!)} TO ${g}`);}
 for(const f of hold.functions)out.push(`GRANT EXECUTE ON FUNCTION ${f} TO ${g}`);
 return out;
}

const GROUP_TABLE_ACL=['group_entrance','group_orders','group_order_parts','group_change_requests'].flatMap(t=>['SELECT','INSERT','UPDATE'].map(p=>`${t}|group|${p}`))
 .concat(['SELECT','INSERT','UPDATE','DELETE'].map(p=>`group_members|group|${p}`))
 .concat(['group_entrance_history','group_events','group_quotes','group_consents','group_adjustments','group_payments','group_requests','group_notification_outbox'].flatMap(t=>['SELECT','INSERT'].map(p=>`${t}|group|${p}`)));
/** Exact expected non-owner ACL of the group relations (table level, then column level). 0064 alone: only the group role. With the custody link (0065, applied by
 * another route): operations also reads the group tables and records the part preparation, and the executor (owner of the group loan validator) reads four tables. */
export function expectedGroupAcl(r:GroupRoles,link:boolean=false){
 const tableLevel=[...GROUP_TABLE_ACL.map(s=>s.replace('|group|','|'+r.group+'|')),
  ...(link?[...['group_orders','group_order_parts','group_members','group_payments'].map(t=>`${t}|${r.operations}|SELECT`),
   `group_part_preparations|${r.operations}|SELECT`,`group_part_preparations|${r.operations}|INSERT`,
   ...['group_order_parts','group_orders','group_members','group_part_preparations'].map(t=>`${t}|${r.executor}|SELECT`)]:[])].sort();
 const columnLevel=[...['status','attempt_count','next_attempt_at','claim_id','claim_until','provider_message_id','sent_at','last_safe_failure_code'].map(c=>`group_notification_outbox.${c}|${r.group}|UPDATE`),
  ...(link?['prepared_at','prepared_by','fit_evidence','version'].map(c=>`group_part_preparations.${c}|${r.operations}|UPDATE`):[])].sort();
 return {tableLevel,columnLevel};
}
/** Exact privileges: the group relations carry exactly the expected non-owner ACL; the group role equals the hold role plus the delta; PUBLIC holds
 * nothing on the group relations and no EXECUTE on the functions 0064 revoked; the group role is a plain NOLOGIN-capable application role. */
export async function groupGrantProof(c:Pick<PoolClient,'query'>,database:string,owner:string,link:boolean=false){
 const r=groupRoleNames(database),exp=expectedGroupAcl(r,link);
 const role=(await c.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,(SELECT count(*)::int FROM pg_auth_members m WHERE m.member=r.oid) memberships FROM pg_roles r WHERE rolname=$1",[r.group])).rows[0];
 if(!role||role.rolsuper||role.rolcreatedb||role.rolcreaterole||role.rolreplication||role.rolbypassrls||role.rolinherit||role.memberships!==0)throw Error(refused);
 const names=[...GROUP_TABLES,...(link?CUSTODY_LINK_TABLES:[])] as string[];
 const t=(await c.query(`SELECT c.relname||'|'||(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)||'|'||a.privilege_type k FROM pg_class c,aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1) AND a.grantee<>c.relowner ORDER BY 1`,[names])).rows.map(x=>x.k as string);
 if(JSON.stringify(t)!==JSON.stringify(exp.tableLevel))throw Error(refused);
 const col=(await c.query(`SELECT c.relname||'.'||t.attname||'|'||(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)||'|'||a.privilege_type k FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid,aclexplode(t.attacl) a WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1) AND t.attacl IS NOT NULL AND NOT t.attisdropped ORDER BY 1`,[names])).rows.map(x=>x.k as string);
 if(JSON.stringify(col)!==JSON.stringify(exp.columnLevel))throw Error(refused);
 const seq=(await c.query(`SELECT (CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)||'|'||a.privilege_type k FROM pg_class c,aclexplode(coalesce(c.relacl,acldefault('s',c.relowner))) a WHERE c.oid='public.group_number_seq'::regclass AND a.grantee<>c.relowner ORDER BY 1`)).rows.map(x=>x.k as string);
 if(JSON.stringify(seq)!==JSON.stringify([r.group+'|USAGE']))throw Error(refused);
 for(const f of [...GROUP_FUNCTIONS,...(link?CUSTODY_LINK_FUNCTIONS:[])]){
  const a=(await c.query(`SELECT (CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END) g FROM pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x WHERE p.oid=to_regprocedure($1) AND x.privilege_type='EXECUTE' AND x.grantee<>p.proowner ORDER BY 1`,[f.sig])).rows.map(x=>x.g as string);
  const want=f.sig==='group_register_actor(uuid)'?[r.group]:f.publicExecute?['PUBLIC']:[];
  if(JSON.stringify(a)!==JSON.stringify(want)){if(process.env.GROUP_DEBUG)console.error("FN_ACL",f.sig,a,want);throw Error(refused);}
 }
 // The group role = the hold role everywhere else (mirror) + only the four extra reads where the hold role lacks them.
 const hold=await roleAcl(c,r.hold),grp=await roleAcl(c,r.group);
 const extra:string[]=[];for(const t of GROUP_EXTRA_READS){const have=hold.tables.includes(`public.${t}|SELECT`);if(!have)extra.push(`public.${t}|SELECT`);}
 const grpWithoutDb={...grp,schemas:grp.schemas.filter(s=>s.endsWith('|USAGE'))};
 const holdNorm={...hold,schemas:hold.schemas.filter(s=>s.endsWith('|USAGE'))};
 if(norm(grpWithoutDb,[])!==norm(holdNorm,extra))throw Error(refused);
 if(!(await c.query("SELECT has_database_privilege($1,current_database(),'CONNECT') ok",[r.group])).rows[0].ok)throw Error(refused);
 if((await c.query("SELECT has_database_privilege($1,current_database(),'CREATE') ok,has_schema_privilege($1,'public','CREATE') s",[r.group])).rows[0].ok!==false)throw Error(refused);
 if((await c.query("SELECT has_schema_privilege($1,'public','CREATE') s",[r.group])).rows[0].s!==false)throw Error(refused);
 void owner;
}

export async function applyProductionGroupGrants(c:PoolClient,database:string,owner:string){
 const entries=await plan(database),r=groupRoleNames(database);let committing=false,committed=false;
 try{
  await begin(c);
  await identity(c,database,owner);await registry(c,entries,64);
  // hold, operations, the manager and the executor exist; the group role does not exist yet (a second run is refused).
  const present=(await c.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1)',[[r.hold,r.operations,r.manager,r.executor,r.group]])).rows.map(x=>x.rolname as string).sort();
  if(JSON.stringify(present)!==JSON.stringify([r.executor,r.hold,r.manager,r.operations].sort()))throw Error(refused);
  const before=(await c.query("SELECT count(*)::int r,(SELECT count(*)::int FROM pg_auth_members) m FROM pg_roles")).rows[0];
  // The owner never creates a role (it would keep an irrevocable ADMIN membership): the NOLOGIN manager does, exactly as for the 17 operational roles.
  await c.query(`SET LOCAL ROLE ${q(r.manager)}`);await c.query(ROLE_CREATE_SQL(database));await c.query('RESET ROLE');
  await identity(c,database,owner);
  const mirror=await holdMirror(c,database);
  const extra:string[]=[];for(const t of GROUP_EXTRA_READS){if(!(await roleAcl(c,r.hold)).tables.includes(`public.${t}|SELECT`))extra.push(`GRANT SELECT ON ${t} TO ${q(r.group)}`);}
  const sql=[...mirror,...extra,...productionGroupDeltaGrants(database)];
  for(const s of sql)await c.query(s);
  await groupGrantProof(c,database,owner);
  const m=(await c.query("SELECT pg_get_userbyid(roleid) role,pg_get_userbyid(member) member FROM pg_auth_members WHERE roleid=$1::regrole OR member=$1::regrole",[r.group])).rows;
  if(m.length!==1||m[0].member!==r.manager)throw Error(refused);
  const after=(await c.query("SELECT count(*)::int r,(SELECT count(*)::int FROM pg_auth_members) m FROM pg_roles")).rows[0];
  if(after.r!==before.r+1||after.m!==before.m+1)throw Error(refused);
  committing=true;await c.query('COMMIT');committed=true;
  await begin(c,true);await registry(c,entries,64);await groupGrantProof(c,database,owner);await c.query('ROLLBACK');
  return {status:'PRODUCTION_GROUP_GRANTS_INSTALLED',grantStatements:sql.length,roleChanges:1,credentialChanges:0,businessWrites:0};
 }catch(error){
  await c.query('ROLLBACK').catch(()=>{});
  if(committed)throw Error('PRODUCTION_GROUP_GRANTS_COMMITTED_READBACK_REQUIRED');
  if(committing)throw Error('PRODUCTION_GROUP_GRANTS_COMMIT_UNKNOWN_READBACK_REQUIRED');
  throw error;
 }
}

/** The ONLY accepted way for the owner to hold the executor's authority: exactly one membership row on `<db>_custody_executor`, member = the owner,
 * INHERIT and SET true, ADMIN false (docs/execution/group/CUSTODY_LINK_PRIVILEGED_PATH.md section 4, granted by the platform for one window). */
export async function executorMembershipProof(c:Pick<PoolClient,'query'>,database:string,owner:string,expected:'GRANTED'|'ABSENT'){
 const rows=(await c.query("SELECT pg_get_userbyid(a.member) member,a.admin_option,a.inherit_option,a.set_option FROM pg_auth_members a WHERE a.roleid=to_regrole($1)",[groupRoleNames(database).executor])).rows as {member:string;admin_option:boolean;inherit_option:boolean;set_option:boolean}[];
 if(expected==='ABSENT'){if(rows.length!==0)throw Error(refused);return;}
 if(rows.length!==1||rows[0]!.member!==owner||rows[0]!.admin_option!==false||rows[0]!.inherit_option!==true||rows[0]!.set_option!==true)throw Error(refused);
}

/** READ ONLY: may 0065 be applied now? Reports the state of the 0064 core, the absent link and the platform-granted membership; writes nothing. */
export async function preflightProductionCustodyLink(c:PoolClient,database:string,owner:string){
 const entries=await plan(database);
 try{
  await begin(c,true);await identity(c,database,owner);await registry(c,entries,64);await groupCommittedProof(c,database,owner);await custodyLinkAbsentProof(c);await groupGrantProof(c,database,owner);
  const members=Number((await c.query('SELECT count(*)::int n FROM pg_auth_members WHERE roleid=to_regrole($1)',[groupRoleNames(database).executor])).rows[0].n);
  let membership:'GRANTED'|'ABSENT'|'UNEXPECTED'='UNEXPECTED';
  try{await executorMembershipProof(c,database,owner,'GRANTED');membership='GRANTED';}catch{if(members===0)membership='ABSENT';}
  await c.query('ROLLBACK');
  return {status:'PRODUCTION_CUSTODY_LINK_PREFLIGHT',registry:64,custodyLink:'NOT_APPLIED',executorMembership:membership,executorMembers:members,ready:membership==='GRANTED',writes:0};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}
}

/** 0065, once, as the database owner, in ONE transaction. Requires the platform-granted executor membership (see executorMembershipProof). Nothing is applied
 * without it (PostgreSQL would refuse anyway with 42501; this refuses first, with a fixed code). Before/after proof: the ordinary loan validator is
 * byte-identical; the two replaced custody functions keep executor ownership, SECURITY DEFINER and their fixed search_path; no role, membership or
 * credential changes; the custody-side privileges the link needs are granted in the same transaction and proven exact. */
export async function applyProductionCustodyLink(c:PoolClient,database:string,owner:string,seams:{afterCommit?:()=>Promise<void>}={}){
 const entries=await plan(database),r=groupRoleNames(database);let committing=false,committed=false;
 try{
  await begin(c);
  await c.query('SELECT pg_advisory_xact_lock(71820401),pg_advisory_xact_lock(71820600)');
  await c.query('LOCK TABLE public.foundation_migrations IN EXCLUSIVE MODE');
  await identity(c,database,owner);await registry(c,entries,64);await groupCommittedProof(c,database,owner);await custodyLinkAbsentProof(c);await groupGrantProof(c,database,owner);
  try{await executorMembershipProof(c,database,owner,'GRANTED');}catch{throw Error('PRODUCTION_CUSTODY_LINK_PRIVILEGED_PATH_REQUIRED');}
  const before:Record<string,FnIdentity|undefined>={};for(const sig of PROTECTED_CUSTODY_FUNCTIONS)before[sig]=await fnIdentity(c,sig);
  for(const sig of PROTECTED_CUSTODY_FUNCTIONS)if(!before[sig])throw Error(refused);
  const roles=(await c.query('SELECT count(*)::int r,(SELECT count(*)::int FROM pg_auth_members) m,(SELECT md5(string_agg(rolname||rolcanlogin::text||rolsuper::text||rolcreaterole::text||coalesce(rolvaliduntil::text,\'\'),\',\' ORDER BY rolname)) FROM pg_roles) a FROM pg_roles')).rows[0];
  const entry=entries[64]!;
  // 0065 hands rental_validate_group_loan() to the executor (ALTER FUNCTION ... OWNER TO): PostgreSQL requires the NEW owner to hold CREATE on the schema. Exactly as
  // the original bootstrap bridge did (scripts/production-bootstrap.ts), the executor gets it for this one transaction and loses it again before COMMIT; the schema ACL
  // must read back identical. The public schema belongs to pg_database_owner, i.e. to the database owner who runs this.
  const schemaAcl=async()=>(await c.query("SELECT coalesce(nspacl::text,'') a FROM pg_namespace WHERE nspname='public'")).rows[0]!.a as string;
  const aclBefore=await schemaAcl();
  await c.query(`GRANT CREATE ON SCHEMA public TO ${q(r.executor)}`);
  try{await c.query(entry.sql);}catch(e){if(process.env.GROUP_DEBUG)console.error('CUSTODY_LINK_STATEMENT_ERROR',(e as Error).message);if((e as {code?:string}).code==='42501')throw Error('PRODUCTION_CUSTODY_LINK_PRIVILEGED_PATH_REQUIRED');throw e;}
  await c.query(`REVOKE CREATE ON SCHEMA public FROM ${q(r.executor)}`);
  if(await schemaAcl()!==aclBefore)throw Error(refused);
  await c.query('INSERT INTO public.foundation_migrations(id,checksum) VALUES($1,$2)',[entry.id,entry.checksum]);
  for(const g of CUSTODY_LINK_OPERATIONS_GRANTS)await c.query(g.replace('{OPS}',q(r.operations)));
  await registry(c,entries,65);await groupCommittedProof(c,database,owner);await custodyLinkAppliedProof(c,database,owner);await groupGrantProof(c,database,owner,true);
  // The ordinary loan validator is byte-identical; the two replaced functions are still executor-owned definers with a fixed path.
  const ordinary=await fnIdentity(c,'rental_validate_loan()');if(JSON.stringify(ordinary)!==JSON.stringify(before['rental_validate_loan()']))throw Error(refused);
  for(const sig of REPLACED_FUNCTIONS){const a=await fnIdentity(c,sig);const b=before[sig]!;if(!a||a.owner!==b.owner||a.sd!==b.sd||a.cfg!==b.cfg||a.acl!==b.acl)throw Error(refused);}
  const after=(await c.query('SELECT count(*)::int r,(SELECT count(*)::int FROM pg_auth_members) m,(SELECT md5(string_agg(rolname||rolcanlogin::text||rolsuper::text||rolcreaterole::text||coalesce(rolvaliduntil::text,\'\'),\',\' ORDER BY rolname)) FROM pg_roles) a FROM pg_roles')).rows[0];
  if(after.r!==roles.r||after.m!==roles.m||after.a!==roles.a)throw Error(refused);
  await executorMembershipProof(c,database,owner,'GRANTED');
  committing=true;await c.query('COMMIT');committed=true;await seams.afterCommit?.();
  await begin(c,true);await registry(c,entries,65);await groupCommittedProof(c,database,owner);await custodyLinkAppliedProof(c,database,owner);await groupGrantProof(c,database,owner,true);await c.query('ROLLBACK');
  return {status:'PRODUCTION_CUSTODY_LINK_INSTALLED',applied:[{id:entry.id,checksum:entry.checksum}],grantStatements:CUSTODY_LINK_OPERATIONS_GRANTS.length,roleChanges:0,credentialChanges:0,businessWrites:0,executorMembershipRevokeRequired:true};
 }catch(error){
  await c.query('ROLLBACK').catch(()=>{});
  if(committed)throw Error('PRODUCTION_CUSTODY_LINK_COMMITTED_READBACK_REQUIRED');
  if(committing)throw Error('PRODUCTION_CUSTODY_LINK_COMMIT_UNKNOWN_READBACK_REQUIRED');
  throw error;
 }
}

/** Read-only check of the installed 0064 delta (no write, BEGIN READ ONLY): exact 0001-0064 registry, owner-owned relations, every guard trigger
 * enabled, SECURITY DEFINER functions with fixed search_path, exact privileges, and counts of groups, entrance rows, events and pending notices.
 * Used to read back after an uncertain COMMIT and before/after a deployment rollback (RELEASE_RUNBOOK). Counts only; no identifier or content. */
export async function verifyProductionGroup(c:PoolClient,database:string,owner:string){
 const entries=await plan(database);
 try{
  await begin(c,true);
  await identity(c,database,owner);
  // 0001-0064 is the accepted state. A registered 0065 (custody link, applied by another route) is read separately: its exact shape and the extra privileges it needs.
  const registered=Number((await c.query('SELECT count(*)::int n FROM public.foundation_migrations')).rows[0].n);
  if(registered!==64&&registered!==65)throw Error(refused);
  const link=registered===65;await registry(c,entries,registered);await groupCommittedProof(c,database,owner);
  if(link)await custodyLinkAppliedProof(c,database,owner);else await custodyLinkAbsentProof(c);
  await groupGrantProof(c,database,owner,link);
  const login=(await c.query('SELECT rolcanlogin FROM pg_roles WHERE rolname=$1',[groupRoleNames(database).group])).rows[0]?.rolcanlogin===true;
  const n=(await c.query(`SELECT (SELECT count(*)::int FROM public.group_orders) groups,(SELECT count(*)::int FROM public.group_orders WHERE status IN ('REVIEW_HELD','CHANGES_REQUESTED','CONFIRMED')) held,
   (SELECT count(*)::int FROM public.group_entrance) entrance,(SELECT count(*)::int FROM public.group_events) events,
   (SELECT count(*)::int FROM public.group_notification_outbox WHERE status IN ('PENDING','RETRYABLE_FAILURE','UNKNOWN')) pending_notices,
   (SELECT count(*)::int FROM public.inventory_holds WHERE allocation_stage='GROUP_RESERVED') group_holds`)).rows[0];
  await c.query('ROLLBACK');
  return {status:'PRODUCTION_GROUP_VERIFIED',registry:registered,custodyLink:link?'APPLIED':'NOT_APPLIED',groupRoleLogin:login,tables:GROUP_TABLES.length,groups:Number(n.groups),activeGroups:Number(n.held),entranceRows:Number(n.entrance),events:Number(n.events),pendingNotices:Number(n.pending_notices),groupHolds:Number(n.group_holds),writes:0};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}
}
