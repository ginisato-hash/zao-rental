import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {migrationPlan,migrationsDirectory} from '../packages/db/src/index';
import {readFile} from 'node:fs/promises';
import {productionStaffNotificationGrants,productionCustomerGrants} from './production-staff-notifications';
import {staffDeltaGrantProof} from './production-staff-delta';
import {productionSalesStopGrants,salesStopGrantProof} from './production-sales-stop-delta';
import {productionCouponAdminGrants,couponAdminGrantProof} from './production-coupon-admin-delta';
/** Production cutover to a freshly bootstrapped database (Issue #47 / TD #7214138953 §A).
 *
 * Why: 0065 cannot be applied to the existing Production database by its owner (executor-owned objects),
 * and no external party may be asked. A NEW database in the same cluster, built by the proven bootstrap
 * (0001–0065, ephemeral creator), carries 0065 natively. This module moves the DATA of the 0001–0064
 * database into it and proves the result. It never touches schema, roles or grants of either database:
 * it copies rows with USER triggers suspended per table (append-only and audit triggers would otherwise
 * reject or re-derive rows), re-enables them, and re-proves the trigger state.
 *
 * Design rules:
 *  - rows are copied verbatim (to_jsonb → jsonb_populate_recordset), identity values and sequence positions included;
 *  - the source is fenced (runtime roles NOLOGIN + sessions terminated + default read-only) BEFORE the copy: no CDC, the window is the copy;
 *  - the target stays default_transaction_read_only until the final reconciliation passes: before that point rollback loses nothing;
 *  - every step is appended to a hash-chained audit log; evidence carries counts and digests only, never row content. */
export const CUTOVER_VERSION='production-cutover/1';
/** Tables that exist only after 0065 and must stay empty on the way in. */
export const TARGET_ONLY_TABLES=['public.group_part_preparations'] as const;
/** Columns added by 0065 to an existing table: absent in the source, NULL in the target, ignored in digests. */
export const TARGET_ONLY_COLUMNS:Record<string,string[]>={'public.rental_loan_items':['group_part_id','hold_id']};
/** The migration registry is created by each database's own bootstrap; never copied. */
export const TRANSIENT_EXECUTOR_TABLES=['rental_internal.effects','rental_internal.amendment_effects','rental_internal.stocktake_effects'] as const;
/** Not copied: the registry (each database's own bootstrap writes it) and the executor-owned transaction-local effect tables. The latter are INSERTed and
 * DELETEd inside one SECURITY DEFINER transaction (txid/pid bound) and are empty at rest; the owner cannot read or alter them (executor-owned), so emptiness is
 * read from the statistics collector and, by design, guaranteed once the source has no runtime session left. */
export const NOT_COPIED=['public.foundation_migrations',...TRANSIENT_EXECUTOR_TABLES] as const;
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const qi=(v:string)=>'"'+v.replace(/"/g,'""')+'"';
const qt=(t:string)=>t.split('.').map(qi).join('.');
type Q=Pool|PoolClient;
const canonicalChecksum=async(file:string)=>sha(await readFile(migrationsDirectory+'/'+file,'utf8'));

export async function listTables(pool:Q){
 return (await pool.query<{t:string}>(`SELECT n.nspname||'.'||c.relname t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema' ORDER BY 1`)).rows.map(r=>r.t);
}
export async function tableColumns(pool:Q){
 const out=new Map<string,{name:string;generated:boolean;identityAlways:boolean}[]>();
 for(const r of (await pool.query<{t:string;c:string;g:string;i:string;ig:string|null}>(`SELECT table_schema||'.'||table_name t,column_name c,is_generated g,is_identity i,identity_generation ig
  FROM information_schema.columns WHERE table_schema NOT LIKE 'pg\\_%' AND table_schema<>'information_schema' ORDER BY table_schema,table_name,ordinal_position`)).rows){
  const list=out.get(r.t)??[];list.push({name:r.c,generated:r.g==='ALWAYS',identityAlways:r.i==='YES'&&r.ig==='ALWAYS'});out.set(r.t,list);
 }
 return out;
}
export type DeferredKey={table:string;constraint:string;parent:string};
/** Foreign-key parents first. A cycle (and a self-reference) is broken by deferring, inside the copy transaction only, the foreign keys of the
 * table that has the fewest unmet parents and the most dependents; those constraints are made DEFERRABLE, checked IMMEDIATE before the
 * transaction ends, and returned to NOT DEFERRABLE, so the committed schema is unchanged (and proved unchanged by schemaState). */
export async function loadPlan(pool:Q,tables:string[]){
 const edges=(await pool.query<{c:string;p:string;n:string;d:boolean}>(`SELECT cn.nspname||'.'||cl.relname c,pn.nspname||'.'||pr.relname p,k.conname n,k.condeferrable d FROM pg_constraint k
  JOIN pg_class cl ON cl.oid=k.conrelid JOIN pg_namespace cn ON cn.oid=cl.relnamespace JOIN pg_class pr ON pr.oid=k.confrelid JOIN pg_namespace pn ON pn.oid=pr.relnamespace WHERE k.contype='f' ORDER BY 1,2,3`)).rows;
 const set=new Set(tables),fks=edges.filter(e=>set.has(e.c)&&set.has(e.p));
 const deferred:DeferredKey[]=[],broken=new Set<string>();
 const defer=(e:{c:string;p:string;n:string})=>{if(!broken.has(e.c+'|'+e.n)){broken.add(e.c+'|'+e.n);deferred.push({table:e.c,constraint:e.n,parent:e.p});}};
 for(const e of fks)if(e.c===e.p)defer(e);
 const unmet=(t:string,done:Set<string>)=>fks.filter(e=>e.c===t&&e.p!==t&&!done.has(e.p)&&!broken.has(e.c+'|'+e.n));
 const order:string[]=[],done=new Set<string>();
 while(order.length<tables.length){
  let ready=tables.filter(t=>!done.has(t)&&unmet(t,done).length===0);
  if(!ready.length){
   const rest=tables.filter(t=>!done.has(t));
   const score=(t:string)=>[unmet(t,done).length,-fks.filter(e=>e.p===t&&e.c!==t&&!done.has(e.c)).length,t] as const;
   const pick=[...rest].sort((a,b)=>{const x=score(a),y=score(b);return x[0]-y[0]||x[1]-y[1]||(x[2]<y[2]?-1:1);})[0]!;
   for(const e of unmet(pick,done))defer(e);
   ready=[pick];
  }
  for(const t of ready){order.push(t);done.add(t);}
 }
 return{order,deferred};
}
export async function loadOrder(pool:Q,tables:string[]){return (await loadPlan(pool,tables)).order;}
export type TableDigest={rows:number;sha256:string};
/** Server-side digest per table over the verbatim row JSON, minus the columns that exist only in the target. */
export async function tableDigests(pool:Q,tables:string[],ignore:Record<string,string[]>={}){
 const out:Record<string,TableDigest>={};
 for(const t of tables){
  const r=(await pool.query(`SELECT count(*)::int n,coalesce(encode(sha256(convert_to(string_agg(j::text,E'\\n' ORDER BY j::text),'UTF8')),'hex'),'') d
   FROM (SELECT to_jsonb(x)-$1::text[] AS j FROM ${qt(t)} x) s`,[ignore[t]??[]])).rows[0];
  out[t]={rows:r.n,sha256:r.d};
 }
 return out;
}
/** Sequence positions. last_value is NULL for a sequence that was never used. */
export async function sequencePositions(pool:Q){
 return (await pool.query<{s:string;v:string|null}>(`SELECT schemaname||'.'||sequencename s,last_value::text v FROM pg_sequences ORDER BY 1`)).rows;
}
/** Exact sequence state: last_value AND is_called (a never-called sequence and one called at its start value differ). Where the owner may not read a sequence
 * (executor-owned), the catalogue view is the only evidence and is_called is derived from it. */
export type SequenceState={s:string;v:string|null;c:boolean};
export async function sequenceStates(pool:Q):Promise<SequenceState[]>{
 const names=(await pool.query<{s:string;v:string|null}>(`SELECT schemaname||'.'||sequencename s,last_value::text v FROM pg_sequences ORDER BY 1`)).rows;
 const out:SequenceState[]=[];
 for(const q of names){
  try{const r=(await pool.query(`SELECT last_value::text v,is_called c FROM ${qt(q.s)}`)).rows[0];out.push({s:q.s,v:r.v as string,c:r.c as boolean});}
  catch{out.push({s:q.s,v:q.v,c:q.v!==null});}
 }
 return out;
}
/** Every foreign key re-proved by anti-join (a catalogue-valid constraint is not evidence). */
export async function foreignKeyOrphans(pool:Q){
 const fks=(await pool.query<{name:string;child:string;parent:string;cc:string[];pc:string[]}>(`SELECT k.conname name,cn.nspname||'.'||cl.relname child,pn.nspname||'.'||pr.relname parent,
  (SELECT array_agg(a.attname::text ORDER BY q.o) FROM unnest(k.conkey) WITH ORDINALITY q(att,o) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=q.att) cc,
  (SELECT array_agg(a.attname::text ORDER BY q.o) FROM unnest(k.confkey) WITH ORDINALITY q(att,o) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=q.att) pc
  FROM pg_constraint k JOIN pg_class cl ON cl.oid=k.conrelid JOIN pg_namespace cn ON cn.oid=cl.relnamespace JOIN pg_class pr ON pr.oid=k.confrelid JOIN pg_namespace pn ON pn.oid=pr.relnamespace
  WHERE k.contype='f' AND cn.nspname NOT LIKE 'pg\\_%'`)).rows;
 const bad:string[]=[];
 for(const k of fks){
  const on=k.cc.map((c,i)=>`p.${qi(k.pc[i]!)}=ch.${qi(c)}`).join(' AND '),nn=k.cc.map(c=>`ch.${qi(c)} IS NOT NULL`).join(' AND ');
  const n=Number((await pool.query(`SELECT count(*)::int n FROM ${qt(k.child)} ch WHERE ${nn} AND NOT EXISTS(SELECT 1 FROM ${qt(k.parent)} p WHERE ${on})`)).rows[0].n);
  if(n)bad.push(k.name);
 }
 return {checked:fks.length,orphans:bad};
}
/** User-trigger enablement per table; every user trigger must be 'O' (origin) again after a load. */
export async function triggerStates(pool:Q){
 return (await pool.query<{t:string;trig:string;state:string}>(`SELECT n.nspname||'.'||c.relname t,g.tgname trig,g.tgenabled::text state FROM pg_trigger g
  JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT g.tgisinternal AND n.nspname NOT LIKE 'pg\\_%' ORDER BY 1,2`)).rows;
}
export async function registry(pool:Q){return (await pool.query<{id:string;checksum:string}>('SELECT id,checksum FROM public.foundation_migrations ORDER BY id')).rows;}
/** Source must be exactly the canonical 0001–0064 prefix (or longer, to assert refusals); target exactly the canonical full plan. */
export async function assertRegistries(source:Q,target:Q,sourceCount=migrationPlan.length-1){
 const expected=await Promise.all(migrationPlan.map(async m=>({id:m.id,checksum:await canonicalChecksum(m.file)})));
 const s=await registry(source),t=await registry(target);
 if(JSON.stringify(s)!==JSON.stringify(expected.slice(0,sourceCount)))throw new Error('CUTOVER_SOURCE_REGISTRY_UNEXPECTED '+s.length);
 if(JSON.stringify(t)!==JSON.stringify(expected))throw new Error('CUTOVER_TARGET_REGISTRY_UNEXPECTED '+t.length);
 return {source:s.length,target:t.length};
}
/** Table-set contract: target = source + the 0065 tables; nothing else may differ, and 0065-only tables must be empty. */
export async function assertTableSets(source:Q,target:Q){
 const s=await listTables(source),t=await listTables(target);
 const missing=s.filter(x=>!t.includes(x)),extra=t.filter(x=>!s.includes(x));
 if(missing.length)throw new Error('CUTOVER_TARGET_MISSING_TABLES '+missing.join(','));
 if(JSON.stringify(extra.sort())!==JSON.stringify([...TARGET_ONLY_TABLES].sort()))throw new Error('CUTOVER_TARGET_EXTRA_TABLES '+extra.join(','));
 for(const e of TARGET_ONLY_TABLES)if(Number((await target.query(`SELECT count(*)::int n FROM ${qt(e)}`)).rows[0].n))throw new Error('CUTOVER_TARGET_ONLY_TABLE_NOT_EMPTY '+e);
 return {tables:s.length,targetOnly:extra};
}
/** Upper bound for one table in this copy design (one transaction, server-side cursor, bounded batches). Larger tables are refused, never silently truncated. */
export const MAX_TABLE_ROWS=5_000_000;
/** Reads one table as the server's own JSON text (no JavaScript number parsing: bigint/numeric/timestamps keep every digit), in bounded batches. */
async function readTable(source:Q,t:string,batch:number,maxRows:number,sink:(texts:string[])=>Promise<void>):Promise<number>{
 const isPool=typeof (source as Pool).connect==='function'&&!('release' in source);
 const c=isPool?await (source as Pool).connect():source as PoolClient;
 let n=0;
 try{
  const total=Number((await c.query(`SELECT count(*)::int n FROM ${qt(t)}`)).rows[0].n);
  if(total>maxRows)throw new Error('CUTOVER_TABLE_TOO_LARGE '+t+' '+total);
  if(!isPool){const all=(await c.query(`SELECT to_jsonb(x)::text v FROM ${qt(t)} x`)).rows.map(r=>r.v as string);for(let i=0;i<all.length;i+=batch)await sink(all.slice(i,i+batch));return all.length;}
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await c.query(`DECLARE zao_cutover_cursor NO SCROLL CURSOR FOR SELECT to_jsonb(x)::text v FROM ${qt(t)} x`);
  for(;;){
   const rows=(await c.query(`FETCH ${batch} FROM zao_cutover_cursor`)).rows.map(r=>r.v as string);
   if(!rows.length)break;
   n+=rows.length;await sink(rows);
  }
  await c.query('COMMIT');
  if(n!==total)throw new Error('CUTOVER_SOURCE_CHANGED_DURING_READ '+t);
  return n;
 }catch(e){if(isPool)await c.query('ROLLBACK').catch(()=>undefined);throw e;}
 finally{if(isPool)c.release();}
}
export type CopyReport={tables:number;rows:number;perTable:Record<string,number>;sequences:number;sequencesUnused:number;deferredConstraints:number};
/** Copies every row of every table (except NOT_COPIED) from source into the target, in the caller's transaction.
 * User triggers of each table are disabled only for its load and re-enabled before the transaction ends. Tables with rows in the
 * target are replaced (migration-seeded rows are not authoritative; the source is). Source-only columns must be NULL. */
export async function copyData(source:Q,client:PoolClient,options:{batch?:number;maxRows?:number;faultAfterTable?:string;ignoreSourceOnly?:Record<string,string[]>}={}):Promise<CopyReport>{
 const batch=options.batch??500;
 const destination=new Set(await listTables(client));
 const copied=(await listTables(source)).filter(t=>!(NOT_COPIED as readonly string[]).includes(t));
 const cols=await tableColumns(client),scols=await tableColumns(source);
 // A table the destination does not have is only acceptable when it is an empty 0065-only table.
 for(const t of copied)if(!destination.has(t)){
  if(!(TARGET_ONLY_TABLES as readonly string[]).includes(t)||Number((await source.query(`SELECT count(*)::int n FROM ${qt(t)}`)).rows[0].n))throw new Error('CUTOVER_DESTINATION_MISSING_TABLE '+t);
 }
 const {order,deferred}=await loadPlan(client,copied.filter(t=>destination.has(t)));
 const perTable:Record<string,number>={};let rows=0;
 const disabled:string[]=[];
 const madeDeferrable:DeferredKey[]=[];
 try{
  // Cycle-breaking foreign keys are made deferrable for this transaction only and are restored (and proved restored) below.
  for(const d of deferred){
   if((await client.query('SELECT condeferrable FROM pg_constraint WHERE conname=$1 AND conrelid=$2::regclass',[d.constraint,qt(d.table)])).rows[0].condeferrable)continue;
   await client.query(`ALTER TABLE ${qt(d.table)} ALTER CONSTRAINT ${qi(d.constraint)} DEFERRABLE INITIALLY IMMEDIATE`);madeDeferrable.push(d);
  }
  if(deferred.length)await client.query('SET CONSTRAINTS ALL DEFERRED');
  // Delete children first so that replacing seeded parents cannot violate a foreign key.
  for(const t of [...order].reverse()){await client.query(`ALTER TABLE ${qt(t)} DISABLE TRIGGER USER`);disabled.push(t);}
  for(const t of [...order].reverse())await client.query(`DELETE FROM ${qt(t)}`);
  for(const t of order){
   const tc=cols.get(t)!,sc=scols.get(t)!,targetNames=new Set(tc.map(c=>c.name)),sourceNames=new Set(sc.map(c=>c.name));
   const sourceOnly=sc.filter(c=>!targetNames.has(c.name)).map(c=>c.name);
   const tolerated=options.ignoreSourceOnly?.[t]??[];
   for(const c of sourceOnly.filter(c=>tolerated.includes(c)))
    if(Number((await source.query(`SELECT count(*)::int n FROM ${qt(t)} WHERE ${qi(c)} IS NOT NULL`)).rows[0].n))throw new Error('CUTOVER_SOURCE_ONLY_COLUMN_NOT_NULL '+t+'.'+c);
   if(sourceOnly.some(c=>!tolerated.includes(c)))throw new Error('CUTOVER_SOURCE_ONLY_COLUMNS '+t+' '+sourceOnly.join(','));
   const unexpected=tc.filter(c=>!sourceNames.has(c.name)&&!c.generated).map(c=>c.name);
   const allowed=TARGET_ONLY_COLUMNS[t]??[];
   if(unexpected.some(c=>!allowed.includes(c)))throw new Error('CUTOVER_TARGET_ONLY_COLUMN_UNAPPROVED '+t+' '+unexpected.join(','));
   const writable=tc.filter(c=>sourceNames.has(c.name)&&!c.generated).map(c=>c.name);
   const identity=tc.some(c=>c.identityAlways),list=writable.map(qi).join(',');
   const n=await readTable(source,t,batch,options.maxRows??MAX_TABLE_ROWS,async texts=>{
    // The rows travel as the server's own jsonb text: never parsed or re-serialised by JavaScript (no precision loss).
    await client.query(`INSERT INTO ${qt(t)}(${list})${identity?' OVERRIDING SYSTEM VALUE':''} SELECT ${list} FROM jsonb_populate_recordset(NULL::${qt(t)},$1::jsonb)`,['['+texts.join(',')+']']);
   });
   perTable[t]=n;rows+=n;
   if(options.faultAfterTable===t)throw new Error('CUTOVER_INJECTED_FAULT '+t);
  }
  // Sequence positions follow the source exactly (gaps included), never max(column).
  let sequences=0,sequencesUnused=0;
  const target=new Set((await client.query<{s:string}>(`SELECT schemaname||'.'||sequencename s FROM pg_sequences`)).rows.map(r=>r.s));
  for(const q of await sequenceStates(source)){
   if(q.v===null||!target.has(q.s))continue;
   // last_value AND is_called: an unused sequence stays unused (setval(..,false)), a used one continues after its last value.
   await client.query('SELECT setval($1::regclass,$2::bigint,$3::boolean)',[q.s,q.v,q.c]);if(q.c)sequences++;else sequencesUnused++;
  }
  if(deferred.length){
   // Every deferred foreign key is checked now; only then is the constraint returned to exactly its committed definition.
   await client.query('SET CONSTRAINTS ALL IMMEDIATE');
   for(const d of madeDeferrable)await client.query(`ALTER TABLE ${qt(d.table)} ALTER CONSTRAINT ${qi(d.constraint)} NOT DEFERRABLE`);
  }
  return {tables:order.length,rows,perTable,sequences,sequencesUnused,deferredConstraints:deferred.length};
 }finally{
  // Always restore, also on failure inside an aborted transaction the ROLLBACK does it; on success this makes it explicit.
  for(const t of disabled)await client.query(`ALTER TABLE ${qt(t)} ENABLE TRIGGER USER`).catch(()=>undefined);
 }
}
export type Audit={seq:number;step:string;at:string;detail:Record<string,unknown>;prev:string;hash:string};
/** Hash-chained step log. Detail is counts/digests/names only. */
export function auditChain(now:()=>Date=()=>new Date()){
 const entries:Audit[]=[];
 return{entries,
  add(step:string,detail:Record<string,unknown>={}){
   const prev=entries.length?entries[entries.length-1]!.hash:'0'.repeat(64),seq=entries.length+1,at=now().toISOString();
   const hash=sha(JSON.stringify({seq,step,at,detail,prev}));entries.push({seq,step,at,detail,prev,hash});return hash;
  },
  verify(){let prev='0'.repeat(64);return entries.every((e,i)=>{const ok=e.seq===i+1&&e.prev===prev&&e.hash===sha(JSON.stringify({seq:e.seq,step:e.step,at:e.at,detail:e.detail,prev:e.prev}));prev=e.hash;return ok;});},
 };
}
/** Snapshot of everything the fence changes, taken BEFORE it changes anything (persisted by the caller through `record`). `dbSetting` is the database-level
 * default_transaction_read_only value that existed before (null = none), so that restoring is exact and not a blind RESET. */
export type Fence={roles:string[];wasLogin:string[];terminated:number;terminateDenied:boolean;dbSetting:string|null;verified:boolean};
export type FenceState={loginRoles:string[];dbSetting:string|null;sessions:number};
/** The REAL state of the source, read from the database (never inferred from a local file): who can log in, the database default, how many sessions of `roles` exist. */
export async function readFenceState(pool:Q,database:string,roles:string[]):Promise<FenceState>{
 const login=(await pool.query<{rolname:string}>('SELECT rolname FROM pg_roles WHERE rolname=ANY($1) AND rolcanlogin ORDER BY 1',[roles])).rows.map(r=>r.rolname);
 const cfg=(await pool.query<{c:string[]|null}>('SELECT s.setconfig c FROM pg_db_role_setting s JOIN pg_database d ON d.oid=s.setdatabase WHERE d.datname=$1 AND s.setrole=0',[database])).rows[0]?.c??[];
 const entry=cfg.find(x=>x.startsWith('default_transaction_read_only='));
 const sessions=Number((await pool.query('SELECT count(*)::int n FROM pg_stat_activity WHERE usename=ANY($1) AND pid<>pg_backend_pid()',[roles])).rows[0].n);
 return{loginRoles:login,dbSetting:entry?entry.slice('default_transaction_read_only='.length):null,sessions};
}
/** Fences the source: runtime roles that can log in are made NOLOGIN (through the role-administration role the owner can SET to), their sessions are terminated
 * where the caller is permitted to, and the database defaults to read-only.
 *  - the snapshot is handed to `record` BEFORE the first change, and is attached to EVERY error thrown from here on, so a partial fence is always restorable;
 *  - each boundary is read back from the database: the fence is only reported when no role can log in, the default is read-only and zero sessions remain
 *    (NOLOGIN does not end a session, so termination is retried until the deadline);
 *  - `extraRoles` (e.g. a receiver role) are included in the session proof. */
export async function fenceSource(owner:Pool,database:string,runtimeRoles:string[],options:{managerRole:string;waitMs?:number;extraRoles?:string[];record?:(f:Fence)=>Promise<void>|void;faultPartial?:boolean}):Promise<Fence>{
 const present=(await owner.query<{rolname:string;rolcanlogin:boolean}>('SELECT rolname,rolcanlogin FROM pg_roles WHERE rolname=ANY($1) ORDER BY 1',[runtimeRoles])).rows;
 const names=present.map(r=>r.rolname),wasLogin=present.filter(r=>r.rolcanlogin).map(r=>r.rolname);
 const watched=[...new Set([...names,...(options.extraRoles??[])])];
 const before=await readFenceState(owner,database,watched);
 const fence:Fence={roles:names,wasLogin,terminated:0,terminateDenied:false,dbSetting:before.dbSetting,verified:false};
 await options.record?.(fence);
 let client:PoolClient|undefined;
 try{
  client=await owner.connect();
  await client.query(`SET ROLE ${qi(options.managerRole)}`);
  for(const [i,r] of wasLogin.entries()){
   await client.query(`ALTER ROLE ${qi(r)} NOLOGIN`);
   if(options.faultPartial&&i===0)throw new Error('CUTOVER_INJECTED_FAULT fence-partial');
  }
  await client.query('RESET ROLE');
  await client.query(`ALTER DATABASE ${qi(database)} SET default_transaction_read_only=on`);
  const deadline=Date.now()+(options.waitMs??5000);
  for(;;){
   const sessions=(await client.query<{pid:number}>('SELECT pid FROM pg_stat_activity WHERE usename=ANY($1) AND pid<>pg_backend_pid()',[watched])).rows;
   if(!sessions.length)break;
   for(const s of sessions){
    try{await client.query('SELECT pg_terminate_backend($1)',[s.pid]);fence.terminated++;}catch{fence.terminateDenied=true;}
   }
   if(Date.now()>deadline)throw new Error('CUTOVER_FENCE_SESSIONS_REMAIN');
   await new Promise(r=>setTimeout(r,100));
  }
  const after=await readFenceState(client,database,watched);
  if(after.loginRoles.some(r=>names.includes(r))||after.dbSetting!=='on'||after.sessions!==0)throw new Error('CUTOVER_FENCE_READBACK_FAILED');
  fence.verified=true;
  return fence;
 }catch(e){throw Object.assign(e instanceof Error?e:new Error(String(e)),{fence});}
 finally{if(client){await client.query('RESET ROLE').catch(()=>undefined);client.release();}}
}
/** A database that defaults to read-only also hands read-only sessions to the operator: every control statement is an explicit READ WRITE transaction. */
export async function readWrite(pool:Pool,statements:string[],asRole?:string){
 const client=await pool.connect();
 try{
  await client.query('BEGIN READ WRITE');
  if(asRole)await client.query(`SET LOCAL ROLE ${qi(asRole)}`);
  for(const sql of statements)await client.query(sql);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>undefined);throw e;}finally{client.release();}
}
/** Restores EXACTLY the snapshot (logins and the previous database default) and proves it by reading the database back; throws when it cannot prove it. */
export async function unfenceSource(owner:Pool,database:string,fence:Fence,managerRole:string){
 if(fence.wasLogin.length)await readWrite(owner,fence.wasLogin.map(r=>`ALTER ROLE ${qi(r)} LOGIN`),managerRole);
 await readWrite(owner,[fence.dbSetting===null?`ALTER DATABASE ${qi(database)} RESET default_transaction_read_only`:`ALTER DATABASE ${qi(database)} SET default_transaction_read_only=${fence.dbSetting==='on'?'on':'off'}`]);
 const now=await readFenceState(owner,database,fence.roles);
 const restoredLogin=fence.wasLogin.every(r=>now.loginRoles.includes(r)),restoredSetting=now.dbSetting===fence.dbSetting;
 if(!restoredLogin||!restoredSetting)throw new Error('CUTOVER_UNFENCE_UNVERIFIED');
 return true as const;
}
/** The irreversible boundary, written INTO THE TARGET DATABASE (the database comment, which its owner can set without superuser rights and anyone can read) before anything is
 * activated: the first LOGIN grant, the lift of the read-only default and the credential switch all come after it. Its presence is read back from the database; a local file alone never decides. */
export const ACTIVATION_MARKER='zao-cutover-activation';
export async function readActivationMarker(pool:Q,database:string):Promise<string|null>{
 const row=(await pool.query<{c:string|null}>('SELECT shobj_description(oid,\'pg_database\') c FROM pg_database WHERE datname=$1',[database])).rows[0];
 const c=row?.c??null;
 return c!==null&&c.startsWith(ACTIVATION_MARKER+':')?c.slice(ACTIVATION_MARKER.length+1):null;
}
export async function writeActivationMarker(pool:Pool,database:string,value:string){
 if(!/^STARTED:[0-9TZ:.-]{10,40}$/.test(value))throw new Error('CUTOVER_ACTIVATION_MARKER_VALUE');
 await readWrite(pool,[`COMMENT ON DATABASE ${qi(database)} IS '${ACTIVATION_MARKER}:${value}'`]);
 if(await readActivationMarker(pool,database)!==value)throw new Error('CUTOVER_ACTIVATION_MARKER_UNVERIFIED');
}
/** Grants LOGIN to the target runtime roles through the role-administration role and reads every one back. Never called before the activation boundary. */
export async function grantRuntimeLogin(owner:Pool,roles:string[],managerRole:string){
 await readWrite(owner,roles.map(r=>`ALTER ROLE ${qi(r)} LOGIN`),managerRole);
 const login=(await owner.query<{rolname:string}>('SELECT rolname FROM pg_roles WHERE rolname=ANY($1) AND rolcanlogin',[roles])).rows.map(r=>r.rolname);
 if(!roles.every(r=>login.includes(r)))throw new Error('CUTOVER_TARGET_LOGIN_UNVERIFIED');
}
/** Work that a second worker could do on the data: an active reconciliation lease or a delivery in flight. `executorTransientRows` is statistics-based and only
 * meaningful when no runtime session exists (the effect tables are filled and emptied inside one SECURITY DEFINER transaction), so it is part of the
 * post-fence proof, not of the live pre-fence check. */
export async function inFlightWork(pool:Q){
 const q=async(sql:string)=>Number((await pool.query(sql)).rows[0].n);
 return{reconciliationLeases:await q('SELECT count(*)::int n FROM payment_reconciliation.jobs WHERE lease_token IS NOT NULL'),
  bookingDeliveries:await q("SELECT count(*)::int n FROM public.booking_notification_outbox WHERE status='SENDING'"),
  staffDeliveries:await q("SELECT count(*)::int n FROM public.staff_notification_outbox WHERE status='SENDING'"),
  groupDeliveries:await q("SELECT count(*)::int n FROM public.group_notification_outbox WHERE status='SENDING'"),
  executorTransientRows:await q(`SELECT coalesce(sum(n_live_tup),0)::int n FROM pg_stat_all_tables WHERE schemaname||'.'||relname=ANY(ARRAY['${TRANSIENT_EXECUTOR_TABLES.join("','")}'])`)};
}
/** Full-data proof that a target has never carried a net write since its copy: every table digest and every sequence state equals the frozen source's. */
export async function proveTargetUntouched(source:Pool,target:Pool,tables:string[]){
 const a=await tableDigests(source,tables),b=await tableDigests(target,tables,TARGET_ONLY_COLUMNS);
 const rowsDiffer=tables.filter(t=>a[t]!.rows!==b[t]!.rows||a[t]!.sha256!==b[t]!.sha256);
 const sa=await sequenceStates(source),sb=new Map((await sequenceStates(target)).map(r=>[r.s,r]));
 const seqDiffer=sa.filter(r=>r.v!==null&&sb.has(r.s)&&(sb.get(r.s)!.v!==r.v||sb.get(r.s)!.c!==r.c)).map(r=>r.s);
 return{untouched:rowsDiffer.length===0&&seqDiffer.length===0,rowsDiffer,seqDiffer,tables:tables.length};
}
export type CutoverStage='preflight'|'fence'|'copy'|'reconcile'|'enable-writes'|'switch'|'post-switch';
export type CutoverFault=CutoverStage|'fence-partial'|'fence-readback'|'copy-commit-lost'|'enable-writes-lost'|'unfence-fails';
export type CutoverOptions={source:Pool;target:Pool;sourceOwner:Pool;targetOwner:Pool;sourceDatabase:string;targetDatabase:string;runtimeRoles:string[];managerRole:string;fenceWaitMs?:number;
 /** Roles whose sessions must also be zero (e.g. the receiver role). */
 extraRoles?:string[];
 /** Persist the pre-fence snapshot; called BEFORE the first change. A crash after this leaves enough to restore from. */
 recordFence?:(f:Fence)=>Promise<void>|void;
 /** Persist "target writes are about to be allowed" BEFORE the database default is lifted, and "allowed" after. */
 beforeEnableWrites?:()=>Promise<void>|void;
 afterEnableWrites?:()=>Promise<void>|void;
 /** The only non-database step: point the runtime at the target (secret/env change by the Owner). Receives the audit chain. */
 switchRuntime:()=>Promise<void>;
 postSwitchProbe:(target:Pool)=>Promise<void>;
 now?:()=>Date;fault?:CutoverFault;
 sourceCount?:number;ignoreSourceOnly?:Record<string,string[]>};
export type CutoverFailure=Error&{stage:CutoverStage;rolledBack:boolean;recoveryRequired:boolean;writesEnabled:boolean;writesUnknown:boolean;activationStarted:boolean;audit:Audit[];chainValid:boolean;fence?:Fence};
/** Executes the cutover. Failure contract (the product never claims more than it read back):
 *  - nothing fenced yet (preflight): nothing to restore, `rolledBack` true, `recoveryRequired` false;
 *  - fenced, target never writable: the exact snapshot is restored and READ BACK; `rolledBack` is true only when that proof holds, otherwise `recoveryRequired`
 *    is true (RECOVERY_REQUIRED: the source may still be fenced; use `recover`, never assume);
 *  - from the moment the target's read-only default is lifted (intent recorded first, then read back after any failure) the outcome is forward-fix only:
 *    the source stays fenced, `rolledBack` is false (never two writers). */
export async function runCutover(o:CutoverOptions){
 const audit=auditChain(o.now);let fence:Fence|undefined,writesIntent=false,writesEnabled=false,writesUnknown=false,activationBoundary=false,stage:CutoverStage='preflight';
 const fault=(s:CutoverFault)=>{if(o.fault===s)throw new Error('CUTOVER_INJECTED_FAULT '+s);};
 const targetDefault=async()=>{
  const cfg=(await o.targetOwner.query('SELECT setconfig FROM pg_db_role_setting s JOIN pg_database d ON d.oid=s.setdatabase WHERE d.datname=$1 AND s.setrole=0',[o.targetDatabase])).rows[0]?.setconfig??[];
  return (cfg as string[]).includes('default_transaction_read_only=on');
 };
 try{
  const reg=await assertRegistries(o.source,o.target,o.sourceCount);
  const sets=await assertTableSets(o.source,o.target);
  if(!await targetDefault())throw new Error('CUTOVER_TARGET_NOT_READ_ONLY');
  const targetBefore=await schemaState(o.target);
  // Re-check immediately before stopping anything: nothing is fenced while the work or the target is not ready.
  const live=await inFlightWork(o.source);const {executorTransientRows:_t,...liveWork}=live;void _t;
  if(Object.values(liveWork).some(v=>v>0))throw new Error('CUTOVER_PREFLIGHT_IN_FLIGHT_WORK '+JSON.stringify(liveWork));
  audit.add('preflight',{registry:reg,tables:sets.tables,targetBaseline:targetBefore.sha256,inFlight:liveWork});
  fault('preflight');
  stage='fence';
  fence=await fenceSource(o.sourceOwner,o.sourceDatabase,o.runtimeRoles,{managerRole:o.managerRole,...(o.fenceWaitMs===undefined?{}:{waitMs:o.fenceWaitMs}),
   ...(o.extraRoles?{extraRoles:o.extraRoles}:{}),...(o.recordFence?{record:o.recordFence}:{}),faultPartial:o.fault==='fence-partial'});
  fault('fence-readback');
  const work=await inFlightWork(o.source);
  if(Object.values(work).some(v=>v>0))throw new Error('CUTOVER_IN_FLIGHT_WORK '+JSON.stringify(work));
  audit.add('fence',{roles:fence.roles,terminated:fence.terminated,verified:fence.verified,inFlight:work});
  fault('fence');
  stage='copy';
  const sourceDigests=await tableDigests(o.source,(await listTables(o.source)).filter(t=>!(NOT_COPIED as readonly string[]).includes(t)));
  const client=await o.targetOwner.connect();let report:CopyReport;
  try{
   // The target database defaults to read-only until verified: this one transaction is explicitly READ WRITE.
   await client.query('BEGIN READ WRITE');
   await client.query('SELECT pg_advisory_xact_lock(71820401)');
   report=await copyData(o.source,client,(o.ignoreSourceOnly?{ignoreSourceOnly:o.ignoreSourceOnly}:{}));
   fault('copy');
   if(o.fault==='unfence-fails')throw new Error('CUTOVER_INJECTED_FAULT copy');   // after a fence: its restoration is made to fail too (see the catch below)
   await client.query('COMMIT');
   // The commit reached the server; a lost reply after this point is indistinguishable from this fault. The target is still read-only: a re-run replaces the copy.
   fault('copy-commit-lost');
  }catch(e){await client.query('ROLLBACK').catch(()=>undefined);throw e;}finally{client.release();}
  audit.add('copy',{tables:report.tables,rows:report.rows,sequences:report.sequences,sequencesUnused:report.sequencesUnused});
  stage='reconcile';
  const tables=Object.keys(sourceDigests);
  const targetDigests=await tableDigests(o.target,tables,TARGET_ONLY_COLUMNS);
  const differing=tables.filter(t=>sourceDigests[t]!.rows!==targetDigests[t]!.rows||sourceDigests[t]!.sha256!==targetDigests[t]!.sha256);
  if(differing.length)throw new Error('CUTOVER_RECONCILE_MISMATCH '+differing.join(','));
  const seqS=await sequenceStates(o.source),seqT=new Map((await sequenceStates(o.target)).map(r=>[r.s,r]));
  const seqBad=seqS.filter(r=>r.v!==null&&seqT.has(r.s)&&(seqT.get(r.s)!.v!==r.v||seqT.get(r.s)!.c!==r.c)).map(r=>r.s);
  if(seqBad.length)throw new Error('CUTOVER_SEQUENCE_MISMATCH '+seqBad.join(','));
  const fk=await foreignKeyOrphans(o.target);if(fk.orphans.length)throw new Error('CUTOVER_FOREIGN_KEY_ORPHAN '+fk.orphans.join(','));
  const bad=(await triggerStates(o.target)).filter(t=>t.state!=='O');if(bad.length)throw new Error('CUTOVER_TRIGGER_NOT_ENABLED '+bad.map(b=>b.t+'.'+b.trig).join(','));
  const after=await schemaState(o.target);if(after.sha256!==targetBefore.sha256)throw new Error('CUTOVER_SCHEMA_STATE_CHANGED');
  audit.add('reconcile',{tables:tables.length,rows:Object.values(targetDigests).reduce((a,d)=>a+d.rows,0),digest:sha(JSON.stringify(targetDigests)),foreignKeys:fk.checked,sequences:seqS.length,schemaState:after.sha256});
  fault('reconcile');
  stage='enable-writes';
  // Intent is persisted BEFORE the default is lifted; a failure after this point is judged by reading the target back, never by assumption.
  // From this line on the cutover is forward-only: the boundary counts as crossed even if recording it fails part-way (fail closed).
  activationBoundary=true;
  await o.beforeEnableWrites?.();
  writesIntent=true;
  await readWrite(o.targetOwner,[`ALTER DATABASE ${qi(o.targetDatabase)} RESET default_transaction_read_only`]);
  fault('enable-writes-lost');
  writesEnabled=true;
  await o.afterEnableWrites?.();
  audit.add('enable-writes',{});
  fault('enable-writes');
  stage='switch';
  await o.switchRuntime();audit.add('switch',{});
  fault('switch');
  stage='post-switch';
  await o.postSwitchProbe(o.target);audit.add('post-switch',{});
  fault('post-switch');
  return{status:'CUTOVER_COMPLETE' as const,audit:audit.entries,chainValid:audit.verify(),report,sourceFenced:true};
 }catch(e){
  const message=(e as Error).message;
  fence=fence??(e as {fence?:Fence}).fence;
  if(writesIntent&&!writesEnabled){
   // The lift may or may not have reached the server: read it back.
   try{writesEnabled=!(await targetDefault());}catch{writesEnabled=true;writesUnknown=true;}
  }
  let rolledBack=false,recoveryRequired=false;
  if(!writesEnabled&&!activationBoundary){
   if(!fence)rolledBack=true;   // nothing was changed on the source
   else{
    try{
     if(o.fault==='unfence-fails')throw new Error('CUTOVER_INJECTED_FAULT unfence-fails');
     await unfenceSource(o.sourceOwner,o.sourceDatabase,fence,o.managerRole);rolledBack=true;
    }catch{recoveryRequired=true;}
   }
   audit.add(rolledBack?'rollback':'recovery-required',{stage,reason:message.slice(0,200),sourceUnfenced:rolledBack&&Boolean(fence)});
  }else audit.add('forward-fix-only',{stage,reason:message.slice(0,200),writesEnabled,writesUnknown,activationStarted:activationBoundary,sourceFenced:Boolean(fence)});
  const failure=Object.assign(new Error(message),{stage,rolledBack,recoveryRequired,writesEnabled,writesUnknown,activationStarted:activationBoundary,audit:audit.entries,chainValid:audit.verify(),...(fence?{fence}:{})}) as CutoverFailure;
  throw failure;
 }
}

/** Schema + trigger + owner + ACL state of one database, normalised by object name only (no data). */
export async function schemaState(pool:Q){
 const q=async(sql:string)=>(await pool.query(sql)).rows.map(r=>Object.values(r).join('|'));
 const material={
  triggers:await q(`SELECT n.nspname||'.'||c.relname,g.tgname,g.tgenabled,pg_get_triggerdef(g.oid) FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT g.tgisinternal AND n.nspname NOT LIKE 'pg\\_%' ORDER BY 1,2`),
  constraints:await q(`SELECT n.nspname||'.'||c.relname,k.conname,k.convalidated,pg_get_constraintdef(k.oid) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg\\_%' ORDER BY 1,2`),
  relations:await q(`SELECT n.nspname||'.'||c.relname,c.relkind,pg_get_userbyid(c.relowner),coalesce(c.relacl::text,'') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','S') ORDER BY 1`),
  functions:await q(`SELECT p.oid::regprocedure::text,pg_get_userbyid(p.proowner),p.prosecdef,coalesce(p.proacl::text,''),md5(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema' ORDER BY 1`),
  columns:await q(`SELECT table_schema||'.'||table_name,column_name,data_type,is_nullable,coalesce(column_default,''),is_identity,coalesce(identity_generation,'') FROM information_schema.columns WHERE table_schema NOT LIKE 'pg\\_%' AND table_schema<>'information_schema' ORDER BY 1,2`),
 };
 return{sha256:sha(JSON.stringify(material)),counts:Object.fromEntries(Object.entries(material).map(([k,v])=>[k,v.length]))};
}

/** Every privilege in a database, as one normalised line per (object, grantee, privilege, grantable): relations, columns, functions, schemas, the database
 * and default ACLs. Role names are normalised by the database-name prefix (`<db>_group` → `<db>_group` is `@db@_group`), so a source and a target built under
 * different database names compare directly. This, not any single structural condition, is the basis for "the privileges are identical". */
export async function aclLines(pool:Q,database:string,shared:string[]=[]):Promise<string[]>{
 const norm=(r:string)=>r==='PUBLIC'||shared.includes(r)?r:r.startsWith(database+'_')?'@db@_'+r.slice(database.length+1):r;
 const rows=async(sql:string)=>(await pool.query<{o:string;g:string;p:string;t:boolean}>(sql)).rows;
 const lines:string[]=[];
 const add=(kind:string,r:{o:string;g:string;p:string;t:boolean})=>lines.push(`${kind}|${r.o}|${norm(r.g)}|${r.p}|${r.t}`);
 const grantee=()=>`CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END`;
 for(const r of await rows(`SELECT n.nspname||'.'||c.relname o,${grantee()} g,a.privilege_type p,a.is_grantable t FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,aclexplode(c.relacl) a
  WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','S')`))add('relation',r);
 for(const r of await rows(`SELECT n.nspname||'.'||c.relname||'.'||at.attname o,${grantee()} g,a.privilege_type p,a.is_grantable t FROM pg_attribute at JOIN pg_class c ON c.oid=at.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace,aclexplode(at.attacl) a
  WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema' AND at.attacl IS NOT NULL AND NOT at.attisdropped`))add('column',r);
 for(const r of await rows(`SELECT p.oid::regprocedure::text o,${grantee()} g,a.privilege_type p,a.is_grantable t FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,aclexplode(p.proacl) a
  WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema'`))add('function',r);
 for(const r of await rows(`SELECT n.nspname o,${grantee()} g,a.privilege_type p,a.is_grantable t FROM pg_namespace n,aclexplode(n.nspacl) a WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema'`))add('schema',r);
 for(const r of await rows(`SELECT 'database' o,${grantee()} g,a.privilege_type p,a.is_grantable t FROM pg_database d,aclexplode(d.datacl) a WHERE d.datname=current_database()`))add('database',r);
 for(const r of await rows(`SELECT pg_get_userbyid(d.defaclrole)||':'||d.defaclobjtype::text||':'||coalesce(n.nspname,'') o,${grantee()} g,a.privilege_type p,a.is_grantable t FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace,aclexplode(d.defaclacl) a`))add('default',r);
 return lines.sort();
}
export type AclComparison={sourceLines:number;targetLines:number;onlySource:string[];onlyTarget:string[];unexpected:string[];identical:boolean};
/** Compares two databases' privilege sets. Differences must be explained by `allowed` (objects 0065 itself introduces or changes); anything else is `unexpected`. */
export async function compareAcl(source:Q,target:Q,sourceDatabase:string,targetDatabase:string,allowed:(line:string)=>boolean,shared:string[]=[]):Promise<AclComparison>{
 const a=await aclLines(source,sourceDatabase,shared),b=await aclLines(target,targetDatabase,shared);
 const sa=new Set(a),sb=new Set(b);
 const onlySource=a.filter(x=>!sb.has(x)),onlyTarget=b.filter(x=>!sa.has(x));
 const unexpected=[...onlySource,...onlyTarget].filter(x=>!allowed(x));
 return{sourceLines:a.length,targetLines:b.length,onlySource,onlyTarget,unexpected,identical:onlySource.length===0&&onlyTarget.length===0};
}
/** Objects that 0065 introduces or re-grants (and the executor/operations/custody/group grants that go with them): a difference there is expected, anywhere else it is not. */
export const MIGRATION_0065_OBJECTS=/^(?:(?:relation|column|schema|default)\|public\.(?:group_[a-z_]+|rental_loan_items|inventory_holds|ledger_assets)|function\|(?:rental_apply_receipt|rental_stage_guard|rental_validate_loan|rental_validate_group_loan|rental_inventory_blocks|group_[a-z_]+)\()/;

/** The runtime privileges that Production received from the 0059–0063 delta installers, for a database bootstrapped at 0001–0065.
 * The bootstrap's role plan predates them, and each installer refuses any registry but its own (0061/0062/0063). The statements are the installers' own pure
 * generators and each result is read back with the installer's own proof, in one transaction that does not touch the registry, roles or credentials. */
export async function installDeltaGrantsOnFoundation65(c:PoolClient,database:string,owner:string){
 const operations=database+'_operations',pricing=database+'_pricing';
 try{
  await c.query('BEGIN READ WRITE');
  await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='30000ms';SET LOCAL search_path=public,pg_catalog");
  const id=(await c.query('SELECT current_database() db,current_user u,session_user s,pg_get_userbyid(datdba) o FROM pg_database WHERE datname=current_database()')).rows[0];
  if(id.db!==database||id.u!==owner||id.s!==owner||id.o!==owner)throw new Error('CUTOVER_DELTA_GRANTS_IDENTITY');
  const expected=await Promise.all(migrationPlan.map(async m=>({id:m.id,checksum:await canonicalChecksum(m.file)})));
  if(JSON.stringify(await registry(c))!==JSON.stringify(expected))throw new Error('CUTOVER_DELTA_GRANTS_REGISTRY');
  const sql=[...productionStaffNotificationGrants(database,operations),...productionCustomerGrants(database,operations),
   ...productionSalesStopGrants(database,operations),...productionCouponAdminGrants(database,pricing,operations)];
  const roles=(await c.query("SELECT count(*)::int r,(SELECT count(*)::int FROM pg_auth_members) m FROM pg_roles")).rows[0];
  for(const statement of sql)await c.query(statement);
  await staffDeltaGrantProof(c,operations);await salesStopGrantProof(c,operations);await couponAdminGrantProof(c,pricing,operations);
  const after=(await c.query("SELECT count(*)::int r,(SELECT count(*)::int FROM pg_auth_members) m FROM pg_roles")).rows[0];
  if(after.r!==roles.r||after.m!==roles.m)throw new Error('CUTOVER_DELTA_GRANTS_ROLE_CHANGE');
  await c.query('COMMIT');
  return{status:'CUTOVER_DELTA_GRANTS_INSTALLED',grantStatements:sql.length,roleChanges:0,credentialChanges:0,businessWrites:0};
 }catch(e){await c.query('ROLLBACK').catch(()=>undefined);throw e;}
}
