import type {PoolClient} from 'pg';
import {bootstrapPlan} from './production-bootstrap';
import {currentRentalTerms} from '../packages/core/src/content/rental-terms';
import {productionStaffNotificationGrants,productionCustomerGrants,STAFF_NOTIFICATION_FUNCTIONS,CUSTOMER_TABLES} from './production-staff-notifications';

// Issue #47 Production delta for 0059 (rental terms acceptance), 0060 (staff inbox / booking email) and 0061 (customer
// identity, staff New order drafts, terms re-consent). Two fixed steps, each one transaction with an exact read-back:
//   migrate — registry must be exactly 0001–0058 with the canonical checksums; 0059→0061 apply together (all or nothing);
//             new objects are owner-owned and start empty (except the one approved terms bundle). No grant, role,
//             membership, ownership, credential or business-row change.
//   grants  — registry must be exactly 0001–0061; adds only the approved operations-role privileges and reads every one
//             back, including what must stay absent (UPDATE/DELETE on the insert-only consent tables, PUBLIC EXECUTE).
// The operator (production-install-staff-delta.ts) admits only an exact accepted main, verify-full TLS owner session and a
// verified Production restore PASS before calling these. A lost COMMIT is reported as readback-required, never retried.
const refused='PRODUCTION_STAFF_DELTA_RECONCILIATION_REQUIRED';
const NEW_TABLES=['rental_terms_bundles','rental_terms_acceptances','staff_booking_events','staff_notification_recipients','staff_notification_outbox','customer_profiles','customer_booking_links','customer_link_requests','staff_order_drafts','rental_terms_reconsents'] as const;

type Entry={id:string;checksum:string;sql:string};
async function plan(database:string){const p=await bootstrapPlan(database);const e=p.entries as Entry[];
 // The plan may carry later migrations (0062+); this delta is always exactly 0059-0061 on a 0001-0058 database.
 if(e.length<61||e[58]?.id!=='0059'||e[59]?.id!=='0060'||e[60]?.id!=='0061')throw Error(refused);return e.slice(0,61);}
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
// The triggers the delta depends on (terms acceptance, staff booking events, customer capture, re-consent guard), all enabled.
const REQUIRED_TRIGGERS=[['rental_bookings','booking_record_terms_acceptance'],['rental_bookings','staff_event_capture'],['rental_bookings','customer_capture_booking'],['rental_terms_reconsents','rental_terms_reconsent_guard']] as const;
/** DELTA-01: after COMMIT the live service may already have recorded new rows (a new booking's terms acceptance, staff event,
 * customer). The read-back therefore proves structure, ownership, triggers and the approved bundle, never "still empty". */
export async function committedProof(c:PoolClient,owner:string){
 for(const t of NEW_TABLES){const r=(await c.query('SELECT pg_get_userbyid(c.relowner)=$1 owner_ok FROM pg_class c WHERE c.oid=to_regclass($2)',[owner,'public.'+t])).rows[0];if(!r||r.owner_ok!==true)throw Error(refused);}
 for(const [table,trigger] of REQUIRED_TRIGGERS)if((await c.query("SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgname=$2 AND tgenabled<>'D' AND NOT tgisinternal",['public.'+table,trigger])).rowCount!==1)throw Error(refused);
 const t=currentRentalTerms();if((await c.query('SELECT 1 FROM public.rental_terms_bundles WHERE version=$1 AND sha256=$2',[t.version,t.sha256])).rowCount!==1)throw Error(refused);
}
async function objectsProof(c:PoolClient,owner:string){
 for(const t of NEW_TABLES){
  const r=(await c.query(`SELECT pg_get_userbyid(c.relowner)=$1 owner_ok,c.relrowsecurity IS NOT NULL present FROM pg_class c WHERE c.oid=to_regclass('public.'||$2)`,[owner,t])).rows[0];
  if(!r||r.owner_ok!==true)throw Error(refused);
  const n=Number((await c.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n);
  if(n!==(t==='rental_terms_bundles'?1:0))throw Error(refused);
 }
}

/** `afterCommit` exists only so a test can let the live service write between COMMIT and the read-back. */
export async function applyProductionStaffDeltaMigration(c:PoolClient,database:string,owner:string,seams:{afterCommit?:()=>Promise<void>}={}){
 const entries=await plan(database);let committing=false,committed=false;
 try{
  await begin(c);
  await c.query('SELECT pg_advisory_xact_lock(71820401),pg_advisory_xact_lock(71820600)');
  await c.query('LOCK TABLE public.foundation_migrations IN EXCLUSIVE MODE');
  await identity(c,database,owner);await registry(c,entries,58);
  for(const t of NEW_TABLES)if((await c.query('SELECT to_regclass($1) IS NULL absent',['public.'+t])).rows[0]?.absent!==true)throw Error(refused);
  const roles=(await c.query('SELECT count(*)::int r,(SELECT count(*)::int FROM pg_auth_members) m FROM pg_roles')).rows[0];
  for(const entry of entries.slice(58)){await c.query(entry.sql);await c.query('INSERT INTO public.foundation_migrations(id,checksum) VALUES($1,$2)',[entry.id,entry.checksum]);}
  await registry(c,entries,61);await objectsProof(c,owner);
  const after=(await c.query('SELECT count(*)::int r,(SELECT count(*)::int FROM pg_auth_members) m FROM pg_roles')).rows[0];
  if(after.r!==roles.r||after.m!==roles.m)throw Error(refused);
  committing=true;await c.query('COMMIT');committed=true;await seams.afterCommit?.();
  // Inside the migration transaction the new tables were proven empty (bundle: one). After COMMIT only invariants that
  // normal service traffic cannot change are read back; a failure reports readback-required and never re-migrates.
  await begin(c,true);await registry(c,entries,61);await committedProof(c,owner);await c.query('ROLLBACK');
  return {status:'PRODUCTION_STAFF_DELTA_INSTALLED',applied:entries.slice(58).map(({id,checksum})=>({id,checksum})),grantsAdded:0,roleChanges:0,credentialChanges:0,businessWrites:0};
 }catch(error){
  await c.query('ROLLBACK').catch(()=>{});
  if(committed)throw Error('PRODUCTION_STAFF_DELTA_COMMITTED_READBACK_REQUIRED');
  if(committing)throw Error('PRODUCTION_STAFF_DELTA_COMMIT_UNKNOWN_READBACK_REQUIRED');
  throw error;
 }
}

/** Exact expected privileges of the operations role on the delta objects: present ones and those that must stay absent. */
export async function staffDeltaGrantProof(c:Pick<PoolClient,'query'>,operationsRole:string){
 const has=async(sql:string,args:unknown[])=>(await c.query(sql,args)).rows[0]?.ok===true;
 for(const fn of [...STAFF_NOTIFICATION_FUNCTIONS,'customer_link_legacy(uuid,uuid,text)','customer_booking_visible(text,uuid)','provisional_capacity_effective_quantity(uuid)'])
  if(!await has("SELECT has_function_privilege($1,$2,'EXECUTE') ok",[operationsRole,fn]))throw Error(refused);
 const table=(t:string,p:string)=>has('SELECT has_table_privilege($1,$2,$3) ok',[operationsRole,t,p]);
 const expect:Record<string,string[]>={rental_terms_acceptances:['SELECT'],rental_terms_reconsents:['SELECT','INSERT'],staff_order_drafts:['SELECT','INSERT'],
  ...Object.fromEntries(CUSTOMER_TABLES.map(t=>[t,['SELECT']])),staff_booking_events:[],staff_notification_outbox:[],staff_notification_recipients:[]};
 for(const [t,allowed] of Object.entries(expect))for(const p of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])if(await table(t,p)!==allowed.includes(p))throw Error(refused);
 if(await has("SELECT has_function_privilege('public','customer_link_legacy(uuid,uuid,text)','EXECUTE') ok",[]))throw Error(refused);
 // staff drafts: column UPDATE only on the advancing columns, never on identity/ownership columns.
 if(!await has("SELECT has_column_privilege($1,'staff_order_drafts','revision','UPDATE') ok",[operationsRole])||await has("SELECT has_column_privilege($1,'staff_order_drafts','id','UPDATE') ok",[operationsRole]))throw Error(refused);
}

export async function applyProductionStaffDeltaGrants(c:PoolClient,database:string,owner:string){
 const entries=await plan(database),operationsRole=database+'_operations';let committing=false,committed=false;
 try{
  await begin(c);
  await identity(c,database,owner);await registry(c,entries,61);
  if((await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[operationsRole])).rowCount!==1)throw Error(refused);
  const sql=[...productionStaffNotificationGrants(database,operationsRole),...productionCustomerGrants(database,operationsRole)];
  for(const s of sql)await c.query(s);
  await staffDeltaGrantProof(c,operationsRole);
  committing=true;await c.query('COMMIT');committed=true;
  await begin(c,true);await registry(c,entries,61);await staffDeltaGrantProof(c,operationsRole);await c.query('ROLLBACK');
  return {status:'PRODUCTION_STAFF_DELTA_GRANTS_INSTALLED',grantStatements:sql.length,roleChanges:0,credentialChanges:0,businessWrites:0};
 }catch(error){
  await c.query('ROLLBACK').catch(()=>{});
  if(committed)throw Error('PRODUCTION_STAFF_DELTA_GRANTS_COMMITTED_READBACK_REQUIRED');
  if(committing)throw Error('PRODUCTION_STAFF_DELTA_GRANTS_COMMIT_UNKNOWN_READBACK_REQUIRED');
  throw error;
 }
}
