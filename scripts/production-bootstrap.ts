import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {Pool} from 'pg';
import {migrationPlan,migrationsDirectory} from '../packages/db/src/index';
/** Production schema bootstrap.
 *
 * Canonical migrations refuse to run anywhere but an owned local database: twelve of them
 * assert `current_database()` matches the disposable `zr_<12hex>` pattern. Renaming a
 * Production database to satisfy that is not an option, because the same pattern is the
 * ownership test the restore tooling and cluster hygiene use to decide what is safe to
 * destroy; Production must never answer to it.
 *
 * So the identity assertion is moved rather than removed. Each guard is rewritten to demand
 * the exact approved target database instead of the disposable-name pattern, which is a
 * narrower test, not a weaker one. The rewrite is exact rather than pattern-driven: every
 * guarded migration is named below with the exact subject expression it is allowed to carry,
 * the transformer refuses any file whose shape differs, and it proves that every byte outside
 * the single replaced span survived. Runtime guards inside function bodies are out of scope by
 * construction and their count is pinned so a source change cannot smuggle one past.
 *
 * Historical migration files 0001-0039 stay byte-identical on disk; nothing here writes them.
 */
export const TRANSFORMER_VERSION='production-bootstrap/2';
export const TRANSFORMATION_CLASS='MIGRATION_TIME_DATABASE_IDENTITY_PREDICATE';
export const GUARD_MIGRATIONS=12;
const ZR_PATTERN=/^zr_[a-f0-9]{12}$/;
const IDENTIFIER=/^[a-z][a-z0-9_]{2,62}$/;
/** The exact identity test, as it appears in the source files. Not a regular expression: the
 * transformer matches these bytes literally so an altered guard fails closed instead of
 * silently matching something looser. */
const IDENTITY_TEST="!~ '^zr_[a-f0-9]{12}$'";
/** Exactly the migrations whose migration-time guard is rewritten, with the exact subject
 * expression each one uses. 0015 tests a local variable already bound to current_database();
 * every other guarded migration calls it directly. */
const GUARDED:Record<string,string>={
 '0015':'n','0016':'current_database()','0017':'current_database()','0018':'current_database()',
 '0019':'current_database()','0033':'current_database()','0034':'current_database()','0035':'current_database()',
 '0036':'current_database()','0037':'current_database()','0038':'current_database()','0039':'current_database()',
};
/** Development/Sandbox payment functions carry the same identity test inside their bodies as a
 * runtime guard. Those are never rewritten. The counts are pinned so a new runtime guard, or a
 * removed one, aborts the bootstrap rather than passing through unnoticed. */
const RUNTIME_GUARDS:Record<string,number>={'0028':1,'0029':2};
const quote=(v:string)=>"'"+v.replace(/'/g,"''")+"'";
const sha256=(v:string)=>createHash('sha256').update(v).digest('hex');
const occurrences=(text:string,needle:string)=>text.split(needle).length-1;
/** Byte spans of top-level `DO $$…END$$;` blocks. A function body never begins a line with
 * `DO $$`, so a guard found inside one of these spans is migration-time by construction. */
function migrationTimeSpans(sql:string){
 const spans:Array<[number,number]>=[];
 for(const match of sql.matchAll(/^DO \$\$[\s\S]*?END\$\$;/gm))spans.push([match.index!,match.index!+match[0].length]);
 return spans;
}
export function assertProductionTarget(target:string){
 if(!IDENTIFIER.test(target)||ZR_PATTERN.test(target))throw new Error('PRODUCTION_TARGET_INVALID '+target);
}
/** Rewrites the single migration-time identity predicate of one migration, or proves that the
 * migration has none to rewrite. Fails closed on any unexpected shape. */
export function productionMigrationSql(id:string,sql:string,target:string){
 assertProductionTarget(target);
 const runtime=RUNTIME_GUARDS[id]??0;
 const subject=GUARDED[id];
 const found=occurrences(sql,IDENTITY_TEST);
 const expected=runtime+(subject?1:0);
 if(found!==expected)throw new Error(`PRODUCTION_GUARD_SHAPE_UNEXPECTED ${id} found=${found} expected=${expected}`);
 if(!subject)return{id,sql,guards:0,transformed:false};
 const fragment=`${subject} ${IDENTITY_TEST}`;
 const segments=sql.split(fragment);
 if(segments.length!==2)throw new Error(`PRODUCTION_GUARD_FRAGMENT_UNEXPECTED ${id} occurrences=${segments.length-1}`);
 const start=segments[0]!.length,end=start+fragment.length;
 if(!migrationTimeSpans(sql).some(([from,to])=>from<=start&&end<=to))throw new Error('PRODUCTION_GUARD_NOT_MIGRATION_TIME '+id);
 const replacement=`${subject} <> ${quote(target)}`;
 const rewritten=segments[0]+replacement+segments[1];
 // Everything outside the one replaced span must be byte-identical, and the moved test must
 // leave no disposable-name predicate behind.
 if(rewritten.slice(0,start)!==sql.slice(0,start))throw new Error('PRODUCTION_GUARD_COLLATERAL_CHANGE '+id);
 if(rewritten.slice(start+replacement.length)!==sql.slice(end))throw new Error('PRODUCTION_GUARD_COLLATERAL_CHANGE '+id);
 if(occurrences(rewritten,IDENTITY_TEST)!==runtime)throw new Error('PRODUCTION_GUARD_RESIDUAL '+id);
 return{id,sql:rewritten,guards:1,transformed:true};
}
/** The canonical plan, rewritten for one approved target, with the provenance record §2 of the
 * bootstrap directive requires. `checksum` is deliberately the CANONICAL SOURCE MIGRATION
 * CHECKSUM — the checksum of the file on disk, not of the bytes executed — because that is what
 * makes a Production registry comparable with a local one. The executed bytes are recorded
 * separately as `transformedSha256`. */
export async function bootstrapPlan(target:string){
 assertProductionTarget(target);
 const entries=[];let guards=0;
 for(const entry of migrationPlan){
  const original=await readFile(migrationsDirectory+'/'+entry.file,'utf8');
  const converted=productionMigrationSql(entry.id,original,target);guards+=converted.guards;
  entries.push({...entry,sql:converted.sql,checksum:sha256(original),provenance:{
   id:entry.id,canonicalSha256:sha256(original),transformerVersion:TRANSFORMER_VERSION,
   transformation:converted.transformed?TRANSFORMATION_CLASS:'NONE',
   transformedSha256:sha256(converted.sql),target,
  }});
 }
 if(guards!==GUARD_MIGRATIONS)throw new Error('PRODUCTION_GUARD_COUNT_UNEXPECTED '+guards);
 const provenance=entries.map(e=>e.provenance);
 return{target,entries,provenance,guardsRewritten:guards,transformerVersion:TRANSFORMER_VERSION,planSha256:sha256(JSON.stringify(provenance))};
}
/** Retained name for the plan's migration entries. */
export async function canonicalMigrations(target:string){return (await bootstrapPlan(target)).entries;}
/** Both environments name things after themselves: roles are derived from the database name,
 * and in a disposable local cluster the owner happens to share it. Folding the database name
 * and the connected owner to one placeholder lets two environments compare equal while any
 * real structural or privilege difference still shows. Rows are sorted AFTER folding, because
 * the raw names sort differently and the comparison is about content, not collation. */
async function environmentNormaliser(pool:Pool){
 const row=(await pool.query<{database:string;owner:string}>('SELECT current_database() database,current_user owner')).rows[0]!;
 const tokens=[...new Set([row.database,row.owner])].sort((a,b)=>b.length-a.length);
 return (value:string)=>tokens.reduce((text,token)=>text.split(token).join('<ENVIRONMENT>'),value);
}
async function fingerprint(pool:Pool,queries:Array<[string,string]>){
 const normalise=await environmentNormaliser(pool);
 const parts=await Promise.all(queries.map(async([label,sql])=>({label,rows:(await pool.query<{value:string}>(sql)).rows.map(r=>normalise(r.value)).sort()})));
 const material=Object.fromEntries(parts.map(p=>[p.label,p.rows]));
 return{sha256:sha256(JSON.stringify(material)),counts:Object.fromEntries(parts.map(p=>[p.label,p.rows.length])),material};
}
/** Normalised schema fingerprint. Role and object names derived from the database name are
 * replaced by a placeholder, so two databases holding the same schema under different names
 * compare equal while any real structural difference still shows. */
export async function schemaFingerprint(pool:Pool){
 return fingerprint(pool,[
  ['schemas',`SELECT nspname AS value FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname<>'information_schema'`],
  ['tables',`SELECT n.nspname||'.'||c.relname||' '||c.relkind::text AS value FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','v','m','S') AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema'`],
  ['columns',`SELECT n.nspname||'.'||c.relname||'.'||a.attname||' '||format_type(a.atttypid,a.atttypmod)||' '||a.attnotnull::text||' '||coalesce(pg_get_expr(d.adbin,d.adrelid),'-')||' '||a.attidentity::text||' '||a.attgenerated::text AS value
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','v','m') AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema'`],
  ['constraints',`SELECT n.nspname||'.'||c.relname||'.'||q.conname||' '||pg_get_constraintdef(q.oid) AS value FROM pg_constraint q JOIN pg_class c ON c.oid=q.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg\\_%'`],
  ['indexes',`SELECT schemaname||'.'||indexname||' '||indexdef AS value FROM pg_indexes WHERE schemaname NOT LIKE 'pg\\_%' AND schemaname<>'information_schema'`],
  ['functions',`SELECT pg_get_functiondef(p.oid) AS value FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema' AND p.prokind IN ('f','p')`],
  ['triggers',`SELECT pg_get_triggerdef(t.oid) AS value FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname NOT LIKE 'pg\\_%'`],
  ['views',`SELECT n.nspname||'.'||c.relname||' '||pg_get_viewdef(c.oid,true) AS value FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('v','m') AND n.nspname NOT LIKE 'pg\\_%'`],
  ['types',`SELECT n.nspname||'.'||t.typname||' '||t.typtype::text||' '||coalesce(string_agg(e.enumlabel,',' ORDER BY e.enumsortorder),'-') AS value
    FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace LEFT JOIN pg_enum e ON e.enumtypid=t.oid
    WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema' AND t.typtype IN ('e','d','c')
    GROUP BY n.nspname,t.typname,t.typtype`],
 ]);
}
/** Roles this database actually uses: its owners and its grantees. `pg_roles` is cluster-global,
 * so in a shared test cluster it also holds the other database's derived roles; comparing the
 * whole catalogue would compare the cluster, not the database. */
const REFERENCED_ROLES=`SELECT relowner AS oid FROM pg_class
 UNION SELECT nspowner FROM pg_namespace
 UNION SELECT proowner FROM pg_proc
 UNION SELECT (aclexplode(relacl)).grantee FROM pg_class WHERE relacl IS NOT NULL
 UNION SELECT (aclexplode(proacl)).grantee FROM pg_proc WHERE proacl IS NOT NULL
 UNION SELECT (aclexplode(nspacl)).grantee FROM pg_namespace WHERE nspacl IS NOT NULL
 UNION SELECT oid FROM pg_roles WHERE rolname=current_user`;
/** Registries that decide what is approved. Two kinds, and the difference matters.
 *
 * The permission registry is seeded by migration 0003 and carries the same defaults everywhere,
 * so its rows are compared for equality. Everything else must be EMPTY in a freshly bootstrapped
 * Production database: no approvals, no A1 development foundation rows (foundation_metadata,
 * telemetry_events — written only by seed()/recordTelemetry(), which no production path calls),
 * and no A2 historical R15 Sandbox activation rows. 0030 belongs to the finite R15 Square Sandbox
 * acceptance; it exists in Production but stays inactive and is never an activation mechanism. */
const PERMISSION_REGISTRY_TABLES=['public.staff_role_permissions','public.staff_permission_overrides'];
const EMPTY_REGISTRY_TABLES=[
 'public.real_inventory_sources','public.real_data_acceptance','public.field_acceptance_records',
 'public.foundation_metadata','public.telemetry_events','r15_activation.manifest','r15_activation.operations',
];
const APPROVAL_REGISTRY_TABLES=[...PERMISSION_REGISTRY_TABLES,...EMPTY_REGISTRY_TABLES];
/** Security fingerprint. Structure alone is not enough: who may do what is the part that
 * actually protects Production, so derived roles, grants, PUBLIC privileges, definer rights,
 * pinned search paths, ownership, role memberships and the approval registries are compared
 * separately and must match exactly. */
export async function securityFingerprint(pool:Pool){
 return fingerprint(pool,[
  // Privileges granted to PUBLIC are the widest possible grant and must be identical.
  ['publicTableGrants',`SELECT table_schema||'.'||table_name||' '||privilege_type AS value FROM information_schema.role_table_grants WHERE grantee='PUBLIC'`],
  ['publicRoutineExecute',`SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS value
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema' AND has_function_privilege('public',p.oid,'EXECUTE')`],
  // Roles derived from the database name, including the custody executor: the bootstrap must
  // create the same set under the Production name.
  ['derivedRoles',`SELECT rolname AS value FROM pg_roles WHERE rolname LIKE current_database()||'\\_%'`],
  ['tableGrants',`SELECT table_schema||'.'||table_name||' '||grantee||' '||privilege_type AS value FROM information_schema.role_table_grants WHERE grantee<>'PUBLIC'`],
  ['columnGrants',`SELECT table_schema||'.'||table_name||'.'||column_name||' '||grantee||' '||privilege_type AS value FROM information_schema.column_privileges WHERE grantee<>'PUBLIC'`],
  ['routineGrants',`SELECT routine_schema||'.'||routine_name||' '||grantee||' '||privilege_type AS value FROM information_schema.routine_privileges WHERE grantee<>'PUBLIC'`],
  // SECURITY DEFINER without a pinned search_path is a privilege-escalation route.
  ['definerRoutines',`SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||p.prosecdef::text||' '||coalesce(array_to_string(p.proconfig,','),'NO_SEARCH_PATH') AS value
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema' AND p.prosecdef`],
  ['tableOwners',`SELECT n.nspname||'.'||c.relname||' '||pg_get_userbyid(c.relowner) AS value FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','v','m','S') AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema'`],
  ['schemaOwners',`SELECT nspname||' '||pg_get_userbyid(nspowner) AS value FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname<>'information_schema'`],
  ['routineOwners',`SELECT n.nspname||'.'||p.proname||' '||pg_get_userbyid(p.proowner) AS value FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema'`],
  ['rowSecurity',`SELECT n.nspname||'.'||c.relname||' '||c.relrowsecurity::text||' '||c.relforcerowsecurity::text AS value FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema'`],
  // No role this database uses may hold an escalation attribute or inherit one through a grant.
  ['roleAttributes',`WITH referenced AS (${REFERENCED_ROLES})
    SELECT r.rolname||' super='||r.rolsuper::text||' createdb='||r.rolcreatedb::text||' createrole='||r.rolcreaterole::text||' replication='||r.rolreplication::text||' bypassrls='||r.rolbypassrls::text||' inherit='||r.rolinherit::text||' login='||r.rolcanlogin::text AS value
    FROM pg_roles r JOIN referenced u ON u.oid=r.oid WHERE r.rolname NOT LIKE 'pg\\_%'`],
  ['roleMemberships',`WITH referenced AS (${REFERENCED_ROLES})
    SELECT pg_get_userbyid(m.member)||' IN '||pg_get_userbyid(m.roleid)||' admin='||m.admin_option::text AS value
    FROM pg_auth_members m JOIN referenced u ON u.oid=m.member WHERE pg_get_userbyid(m.roleid) NOT LIKE 'pg\\_%'`],
  ['approvalRegistries',`SELECT n.nspname||'.'||c.relname||'.'||q.conname||' '||pg_get_constraintdef(q.oid) AS value
    FROM pg_constraint q JOIN pg_class c ON c.oid=q.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE q.contype='c' AND n.nspname||'.'||c.relname IN (${APPROVAL_REGISTRY_TABLES.map(t=>quote(t)).join(',')})`],
  // The seeded permission defaults are part of the security surface, so their rows are compared too.
  ['permissionRegistry',`SELECT 'staff_role_permissions '||role||' '||permission AS value FROM staff_role_permissions`],
 ]);
}
/** Row counts of every approval, development-foundation (A1) and historical R15 Sandbox
 * activation (A2) registry, with the ones a bootstrapped Production database must report as 0
 * marked. The two databases must agree on all of them. */
export const mustBeEmpty=(registry:string)=>EMPTY_REGISTRY_TABLES.includes(registry);
export async function approvalRegistryRows(pool:Pool){
 const sql=APPROVAL_REGISTRY_TABLES.map(t=>`SELECT ${quote(t)} AS registry,count(*)::int AS rows FROM ${t}`).join(' UNION ALL ');
 return (await pool.query<{registry:string;rows:number}>(sql+' ORDER BY 1')).rows;
}
/** Applies the canonical schema to an empty, explicitly named Production database. */
export async function bootstrapProductionSchema(pool:Pool,target:string){
 assertProductionTarget(target);
 const actual=(await pool.query<{name:string}>('SELECT current_database() name')).rows[0]!.name;
 if(actual!==target)throw new Error('PRODUCTION_TARGET_MISMATCH');
 const occupied=Number((await pool.query(`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE c.relkind IN ('r','v','m') AND s.nspname NOT LIKE 'pg\\_%' AND s.nspname<>'information_schema'`)).rows[0].n);
 if(occupied)throw new Error('PRODUCTION_DATABASE_NOT_EMPTY');
 const plan=await bootstrapPlan(target);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(71820401)');
  await client.query('CREATE TABLE foundation_migrations (id text PRIMARY KEY, checksum text NOT NULL)');
  for(const entry of plan.entries){
   await client.query(entry.sql);
   await client.query('INSERT INTO foundation_migrations VALUES($1,$2)',[entry.id,entry.checksum]);
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 return{applied:plan.entries.length,guardsRewritten:plan.guardsRewritten,target,
  transformerVersion:plan.transformerVersion,planSha256:plan.planSha256,
  provenance:plan.provenance.filter(p=>p.transformation!=='NONE')};
}
