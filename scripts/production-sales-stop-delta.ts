import type {PoolClient} from 'pg';
import {bootstrapPlan} from './production-bootstrap';

// Production delta for 0062 (store sales stops, Owner request 2026-11-22). Two fixed steps, each one transaction with an exact read-back:
//   migrate — registry must be exactly 0001–0061 with the canonical checksums; 0062 applies once; the two new tables are owner-owned and
//             start empty. No grant, role, membership, ownership, credential or business-row change.
//   grants  — registry must be exactly 0001–0062; the operations role may read both tables and execute the set function, nothing else;
//             PUBLIC may execute only store_sales_stopped_days (station + day, for the public booking page) and never the set function.
// The operator (production-install-sales-stop.ts) admits only an exact accepted main, verify-full TLS owner session and a verified
// pre-0062 Production restore PASS before calling these. A lost COMMIT is reported as readback-required, never retried.
const refused='PRODUCTION_SALES_STOP_RECONCILIATION_REQUIRED';
export const SALES_STOP_TABLES=['store_sales_stops','store_sales_stop_history'] as const;
export const SALES_STOP_SET_FUNCTION='store_sales_stop_set(text[],date,date,boolean,text)';
export const SALES_STOP_READ_FUNCTION='store_sales_stopped_days(text[],date,date)';
const REQUIRED_TRIGGERS=[['store_sales_stops','store_sales_stops_no_update'],['store_sales_stop_history','store_sales_stop_history_append_only']] as const;

type Entry={id:string;checksum:string;sql:string};
async function plan(database:string){const p=await bootstrapPlan(database);const e=p.entries as Entry[];
 // The plan may carry later migrations; this delta is always exactly 0062 on a 0001-0061 database.
 if(e.length<62||e[61]?.id!=='0062')throw Error(refused);return e.slice(0,62);}
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
/** Structure that normal service traffic cannot change: ownership, the two guard triggers, both functions present. */
export async function salesStopCommittedProof(c:Pick<PoolClient,'query'>,owner:string){
 for(const t of SALES_STOP_TABLES){const r=(await c.query('SELECT pg_get_userbyid(c.relowner)=$1 owner_ok FROM pg_class c WHERE c.oid=to_regclass($2)',[owner,'public.'+t])).rows[0];if(!r||r.owner_ok!==true)throw Error(refused);}
 for(const [table,trigger] of REQUIRED_TRIGGERS)if((await c.query("SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgname=$2 AND tgenabled<>'D' AND NOT tgisinternal",['public.'+table,trigger])).rowCount!==1)throw Error(refused);
 for(const fn of [SALES_STOP_SET_FUNCTION,SALES_STOP_READ_FUNCTION]){const r=(await c.query("SELECT p.prosecdef sd,pg_get_userbyid(p.proowner)=$2 owner_ok FROM pg_proc p WHERE p.oid=to_regprocedure($1)",[fn,owner])).rows[0];if(!r||r.sd!==true||r.owner_ok!==true)throw Error(refused);}
}

/** `afterCommit` exists only so a test can let the live service write between COMMIT and the read-back. */
export async function applyProductionSalesStopMigration(c:PoolClient,database:string,owner:string,seams:{afterCommit?:()=>Promise<void>}={}){
 const entries=await plan(database);let committing=false,committed=false;
 try{
  await begin(c);
  await c.query('SELECT pg_advisory_xact_lock(71820401),pg_advisory_xact_lock(71820600)');
  await c.query('LOCK TABLE public.foundation_migrations IN EXCLUSIVE MODE');
  await identity(c,database,owner);await registry(c,entries,61);
  for(const t of SALES_STOP_TABLES)if((await c.query('SELECT to_regclass($1) IS NULL absent',['public.'+t])).rows[0]?.absent!==true)throw Error(refused);
  const roles=(await c.query('SELECT count(*)::int r,(SELECT count(*)::int FROM pg_auth_members) m FROM pg_roles')).rows[0];
  const entry=entries[61]!;await c.query(entry.sql);await c.query('INSERT INTO public.foundation_migrations(id,checksum) VALUES($1,$2)',[entry.id,entry.checksum]);
  await registry(c,entries,62);await salesStopCommittedProof(c,owner);
  for(const t of SALES_STOP_TABLES)if(Number((await c.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n)!==0)throw Error(refused);
  const after=(await c.query('SELECT count(*)::int r,(SELECT count(*)::int FROM pg_auth_members) m FROM pg_roles')).rows[0];
  if(after.r!==roles.r||after.m!==roles.m)throw Error(refused);
  committing=true;await c.query('COMMIT');committed=true;await seams.afterCommit?.();
  // After COMMIT staff may already stop a day; the read-back proves structure only, never "still empty".
  await begin(c,true);await registry(c,entries,62);await salesStopCommittedProof(c,owner);await c.query('ROLLBACK');
  return {status:'PRODUCTION_SALES_STOP_INSTALLED',applied:[{id:entry.id,checksum:entry.checksum}],grantsAdded:0,roleChanges:0,credentialChanges:0,businessWrites:0};
 }catch(error){
  await c.query('ROLLBACK').catch(()=>{});
  if(committed)throw Error('PRODUCTION_SALES_STOP_COMMITTED_READBACK_REQUIRED');
  if(committing)throw Error('PRODUCTION_SALES_STOP_COMMIT_UNKNOWN_READBACK_REQUIRED');
  throw error;
 }
}

export function productionSalesStopGrants(database:string,operationsRole:string):string[]{
 if(!/^[a-z][a-z0-9_]{0,40}$/.test(database)||operationsRole!==database+'_operations')throw Error('PRODUCTION_SALES_STOP_GRANTS_REFUSED');
 return [`GRANT SELECT ON ${SALES_STOP_TABLES.join(',')} TO ${operationsRole}`,`GRANT EXECUTE ON FUNCTION ${SALES_STOP_SET_FUNCTION} TO ${operationsRole}`];
}
/** Exact expected privileges: the operations role reads both tables and executes the set function; it never writes the tables
 * directly; PUBLIC executes only the read function. */
export async function salesStopGrantProof(c:Pick<PoolClient,'query'>,operationsRole:string){
 const has=async(sql:string,args:unknown[])=>(await c.query(sql,args)).rows[0]?.ok===true;
 if(!await has("SELECT has_function_privilege($1,$2,'EXECUTE') ok",[operationsRole,SALES_STOP_SET_FUNCTION]))throw Error(refused);
 for(const t of SALES_STOP_TABLES)for(const p of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])if(await has('SELECT has_table_privilege($1,$2,$3) ok',[operationsRole,t,p])!==(p==='SELECT'))throw Error(refused);
 if(await has("SELECT has_function_privilege('public',$1,'EXECUTE') ok",[SALES_STOP_SET_FUNCTION]))throw Error(refused);
 if(!await has("SELECT has_function_privilege('public',$1,'EXECUTE') ok",[SALES_STOP_READ_FUNCTION]))throw Error(refused);
}

export async function applyProductionSalesStopGrants(c:PoolClient,database:string,owner:string){
 const entries=await plan(database),operationsRole=database+'_operations';let committing=false,committed=false;
 try{
  await begin(c);
  await identity(c,database,owner);await registry(c,entries,62);
  if((await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[operationsRole])).rowCount!==1)throw Error(refused);
  const sql=productionSalesStopGrants(database,operationsRole);
  for(const s of sql)await c.query(s);
  await salesStopGrantProof(c,operationsRole);
  committing=true;await c.query('COMMIT');committed=true;
  await begin(c,true);await registry(c,entries,62);await salesStopGrantProof(c,operationsRole);await c.query('ROLLBACK');
  return {status:'PRODUCTION_SALES_STOP_GRANTS_INSTALLED',grantStatements:sql.length,roleChanges:0,credentialChanges:0,businessWrites:0};
 }catch(error){
  await c.query('ROLLBACK').catch(()=>{});
  if(committed)throw Error('PRODUCTION_SALES_STOP_GRANTS_COMMITTED_READBACK_REQUIRED');
  if(committing)throw Error('PRODUCTION_SALES_STOP_GRANTS_COMMIT_UNKNOWN_READBACK_REQUIRED');
  throw error;
 }
}
