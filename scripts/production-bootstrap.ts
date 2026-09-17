import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import type {Pool,PoolClient} from 'pg';
import {migrationPlan,migrationsDirectory} from '../packages/db/src/index';
/** Production schema bootstrap.
 *
 * Canonical migrations refuse to run anywhere but an owned local database: twelve of them
 * assert `current_database()` matches the disposable `zr_<12hex>` pattern. Renaming a
 * Production database to satisfy that is not an option, because the same pattern is the
 * ownership test the restore tooling and cluster hygiene use to decide what is safe to
 * destroy; Production must never answer to it.
 *
 * So the identity assertion is moved rather than removed, under two independent gates that
 * must agree before any DDL runs:
 *
 *   1. APPROVED SOURCE. `config/production/bootstrap-source-manifest.json` pins, for each of
 *      the thirty-nine reviewed migrations, its SHA256 and — where one exists — the exact byte
 *      offset, subject expression and fragment of the single guard that may be rewritten. A
 *      file whose bytes differ from the reviewed ones is refused. The manifest is committed
 *      data, never recomputed from whatever happens to be on disk, so re-pinning it is a
 *      visible change to reviewed source rather than something the transformer does silently.
 *
 *   2. STRUCTURE. Independently of the manifest, the guard is located with a SQL scanner that
 *      understands line comments, nestable block comments, quoted identifiers, single-quoted
 *      strings and dollar quoting. The guard must be the one occurrence at an identifier
 *      boundary, inside the body of a top-level `DO` statement, in code context. A guard in a
 *      comment, in a string, in dynamic SQL inside a function, or whose subject is the tail of
 *      a longer identifier, is refused rather than rewritten.
 *
 * Historical migration files 0001-0039 stay byte-identical on disk; nothing here writes them.
 */
export const TRANSFORMER_VERSION='production-bootstrap/3';
export const TRANSFORMATION_CLASS='MIGRATION_TIME_DATABASE_IDENTITY_PREDICATE';
export const GUARD_MIGRATIONS=12;
export const SOURCE_MANIFEST_PATH='config/production/bootstrap-source-manifest.json';
const ZR_PATTERN=/^zr_[a-f0-9]{12}$/;
const IDENTIFIER=/^[a-z][a-z0-9_]{2,62}$/;
/** The exact identity test, as it appears in the source files. Matched as literal bytes, not
 * as a regular expression, so an altered guard fails closed instead of matching something
 * looser. */
const IDENTITY_TEST="!~ '^zr_[a-f0-9]{12}$'";
/** The subject expression each guarded migration is allowed to test. 0015 tests a local
 * variable already bound to current_database(); every other guarded migration calls it. */
const GUARDED:Record<string,string>={
 '0015':'n','0016':'current_database()','0017':'current_database()','0018':'current_database()',
 '0019':'current_database()','0033':'current_database()','0034':'current_database()','0035':'current_database()',
 '0036':'current_database()','0037':'current_database()','0038':'current_database()','0039':'current_database()',
};
/** Development/Sandbox payment functions carry the same identity test inside their bodies as a
 * runtime guard. Those are never rewritten, and the counts are pinned so a new runtime guard,
 * or a removed one, aborts rather than passing through unnoticed. */
const RUNTIME_GUARDS:Record<string,number>={'0028':1,'0029':2};
const quote=(v:string)=>"'"+v.replace(/'/g,"''")+"'";
const sha256=(v:string)=>createHash('sha256').update(v).digest('hex');
const occurrences=(text:string,needle:string)=>text.split(needle).length-1;
type Span={start:number;end:number};
const overlaps=(a:Span,b:Span)=>a.start<b.end&&b.start<a.end;
const DOLLAR_TAG=/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;
/** One pass over SQL. Returns the spans that are not executable code — comments, string
 * literals, quoted identifiers and dollar-quoted bodies — and the top-level statement
 * boundaries, which are the semicolons that fall outside all of those. */
function scan(sql:string){
 const nonCode:Span[]=[],statements:Span[]=[];
 let i=0,from=0;
 const close=(end:number)=>{if(sql.slice(from,end).trim())statements.push({start:from,end});};
 while(i<sql.length){
  const c=sql[i]!;
  if(c==='-'&&sql[i+1]==='-'){const at=i;while(i<sql.length&&sql[i]!=='\n')i++;nonCode.push({start:at,end:i});continue;}
  if(c==='/'&&sql[i+1]==='*'){const at=i;let depth=0;
   while(i<sql.length){
    if(sql[i]==='/'&&sql[i+1]==='*'){depth++;i+=2;}
    else if(sql[i]==='*'&&sql[i+1]==='/'){depth--;i+=2;if(!depth)break;}
    else i++;
   }
   nonCode.push({start:at,end:i});continue;}
  if(c==="'"||c==='"'){const q=c,at=i;i++;
   while(i<sql.length){
    if(sql[i]===q&&sql[i+1]===q)i+=2;
    else if(sql[i]===q){i++;break;}
    else i++;
   }
   nonCode.push({start:at,end:i});continue;}
  if(c==='$'){const tag=DOLLAR_TAG.exec(sql.slice(i));
   if(tag){const open=tag[0],at=i,end=sql.indexOf(open,i+open.length);
    i=end<0?sql.length:end+open.length;nonCode.push({start:at,end:i});continue;}}
  if(c===';'){close(i+1);i++;from=i;continue;}
  i++;
 }
 close(sql.length);
 return{nonCode,statements};
}
/** The dollar-quoted body of a statement, when that statement is a top-level `DO`. Leading
 * whitespace and comments are skipped so the first keyword is the real one. */
function doBody(sql:string,statement:Span):Span|null{
 const text=sql.slice(statement.start,statement.end);
 let i=0;
 for(;;){
  while(i<text.length&&/\s/.test(text[i]!))i++;
  if(text[i]==='-'&&text[i+1]==='-'){while(i<text.length&&text[i]!=='\n')i++;continue;}
  if(text[i]==='/'&&text[i+1]==='*'){let depth=0;
   while(i<text.length){
    if(text[i]==='/'&&text[i+1]==='*'){depth++;i+=2;}
    else if(text[i]==='*'&&text[i+1]==='/'){depth--;i+=2;if(!depth)break;}
    else i++;
   }
   continue;}
  break;
 }
 if(!/^DO\b/i.test(text.slice(i)))return null;
 const rest=text.slice(i+2),tag=/\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
 if(!tag)return null;
 const open=tag[0],opensAt=i+2+tag.index,closesAt=text.indexOf(open,opensAt+open.length);
 if(closesAt<0)return null;
 return{start:statement.start+opensAt+open.length,end:statement.start+closesAt};
}
/** Locates the single migration-time guard of one migration, or proves it has none, using only
 * the structure of the SQL. Independent of the approved-source manifest on purpose: each gate
 * must be able to refuse on its own. */
export function locateMigrationGuard(id:string,sql:string){
 const runtime=RUNTIME_GUARDS[id]??0,subject=GUARDED[id];
 const found=occurrences(sql,IDENTITY_TEST),expected=runtime+(subject?1:0);
 if(found!==expected)throw new Error(`PRODUCTION_GUARD_SHAPE_UNEXPECTED ${id} found=${found} expected=${expected}`);
 if(!subject)return null;
 const fragment=`${subject} ${IDENTITY_TEST}`;
 // Identifier boundary: the subject must be a whole token, so `n` never matches `tenant_n`.
 const sites:number[]=[];
 for(let at=sql.indexOf(fragment);at>=0;at=sql.indexOf(fragment,at+1))
  if(!/[A-Za-z0-9_$]/.test(at>0?sql[at-1]!:' '))sites.push(at);
 if(sites.length!==1)throw new Error(`PRODUCTION_GUARD_FRAGMENT_UNEXPECTED ${id} sites=${sites.length}`);
 const start=sites[0]!,end=start+fragment.length;
 const {statements}=scan(sql);
 const body=statements.map(s=>doBody(sql,s)).find((b):b is Span=>!!b&&b.start<=start&&end<=b.end);
 if(!body)throw new Error('PRODUCTION_GUARD_NOT_MIGRATION_TIME '+id);
 // Inside that body the subject and operator must be code, not a comment or a nested literal.
 // The pattern itself is a string literal by construction, so only the part before it is checked.
 const code={start,end:start+fragment.indexOf("'")};
 const inner=scan(sql.slice(body.start,body.end)).nonCode.map(s=>({start:s.start+body.start,end:s.end+body.start}));
 if(inner.some(s=>overlaps(code,s)))throw new Error('PRODUCTION_GUARD_NOT_CODE '+id);
 return{subject,fragment,start,end};
}
type ManifestEntry={id:string;file:string;sha256:string;runtimeGuards:number;guard:{subject:string;offset:number;fragment:string}|null};
type SourceManifest={transformer:string;migrations:ManifestEntry[]};
let manifestCache:SourceManifest|undefined;
/** The committed approved-source manifest. Loaded, never derived. */
export function sourceManifest():SourceManifest{
 return manifestCache??=JSON.parse(readFileSync(new URL('../'+SOURCE_MANIFEST_PATH,import.meta.url),'utf8')) as SourceManifest;
}
export function approvedEntry(id:string):ManifestEntry{
 const entry=sourceManifest().migrations.find(m=>m.id===id);
 if(!entry)throw new Error('PRODUCTION_SOURCE_UNKNOWN_MIGRATION '+id);
 return entry;
}
export function assertProductionTarget(target:string){
 if(!IDENTIFIER.test(target)||ZR_PATTERN.test(target))throw new Error('PRODUCTION_TARGET_INVALID '+target);
}
/** Rewrites the single migration-time identity predicate of one approved migration, or proves
 * that the migration has none to rewrite. Both gates must agree; either one refuses alone. */
export function productionMigrationSql(id:string,sql:string,target:string){
 assertProductionTarget(target);
 const entry=approvedEntry(id);
 const digest=sha256(sql);
 if(digest!==entry.sha256)throw new Error(`PRODUCTION_SOURCE_NOT_APPROVED ${id} ${digest}`);
 if((RUNTIME_GUARDS[id]??0)!==entry.runtimeGuards)throw new Error('PRODUCTION_MANIFEST_RUNTIME_GUARD_MISMATCH '+id);
 const located=locateMigrationGuard(id,sql);
 if(!entry.guard){
  if(located)throw new Error('PRODUCTION_GUARD_PIN_MISMATCH '+id);
  return{id,sql,guards:0,transformed:false};
 }
 if(!located)throw new Error('PRODUCTION_GUARD_PIN_MISMATCH '+id);
 // The pinned site and the independently located site must be the same bytes at the same place.
 if(located.start!==entry.guard.offset||located.subject!==entry.guard.subject||located.fragment!==entry.guard.fragment)
  throw new Error(`PRODUCTION_GUARD_PIN_MISMATCH ${id} offset=${located.start} pinned=${entry.guard.offset}`);
 if(sql.slice(entry.guard.offset,entry.guard.offset+entry.guard.fragment.length)!==entry.guard.fragment)
  throw new Error('PRODUCTION_GUARD_PIN_MISMATCH '+id);
 const replacement=`${entry.guard.subject} <> ${quote(target)}`;
 const end=entry.guard.offset+entry.guard.fragment.length;
 const rewritten=sql.slice(0,entry.guard.offset)+replacement+sql.slice(end);
 // Everything outside the one replaced span is byte-identical, and no disposable-name
 // predicate is left behind beyond the pinned runtime guards.
 if(rewritten.slice(0,entry.guard.offset)!==sql.slice(0,entry.guard.offset))throw new Error('PRODUCTION_GUARD_COLLATERAL_CHANGE '+id);
 if(rewritten.slice(entry.guard.offset+replacement.length)!==sql.slice(end))throw new Error('PRODUCTION_GUARD_COLLATERAL_CHANGE '+id);
 if(occurrences(rewritten,IDENTITY_TEST)!==entry.runtimeGuards)throw new Error('PRODUCTION_GUARD_RESIDUAL '+id);
 return{id,sql:rewritten,guards:1,transformed:true};
}
/** The canonical plan, rewritten for one approved target, with dual provenance.
 * `checksum` is deliberately the CANONICAL SOURCE MIGRATION CHECKSUM — the checksum of the
 * reviewed file, not of the bytes executed — because that is what makes a Production registry
 * comparable with a local one. The executed bytes are recorded separately. */
export async function bootstrapPlan(target:string){
 assertProductionTarget(target);
 const manifest=sourceManifest();
 if(manifest.migrations.length!==migrationPlan.length)throw new Error('PRODUCTION_MANIFEST_LENGTH_MISMATCH '+manifest.migrations.length);
 const entries=[];let guards=0;
 for(const entry of migrationPlan){
  const approved=approvedEntry(entry.id);
  if(approved.file!==entry.file)throw new Error('PRODUCTION_MANIFEST_FILE_MISMATCH '+entry.id);
  const original=await readFile(migrationsDirectory+'/'+entry.file,'utf8');
  const converted=productionMigrationSql(entry.id,original,target);guards+=converted.guards;
  entries.push({...entry,sql:converted.sql,checksum:sha256(original),provenance:{
   id:entry.id,canonicalSha256:sha256(original),approvedSha256:approved.sha256,
   transformerVersion:TRANSFORMER_VERSION,transformation:converted.transformed?TRANSFORMATION_CLASS:'NONE',
   transformedSha256:sha256(converted.sql),target,
  }});
 }
 if(guards!==GUARD_MIGRATIONS)throw new Error('PRODUCTION_GUARD_COUNT_UNEXPECTED '+guards);
 const provenance=entries.map(e=>e.provenance);
 return{target,entries,provenance,guardsRewritten:guards,transformerVersion:TRANSFORMER_VERSION,
  manifestSha256:sha256(JSON.stringify(manifest)),planSha256:sha256(JSON.stringify(provenance))};
}
export async function canonicalMigrations(target:string){return (await bootstrapPlan(target)).entries;}
type Queryable=Pool|PoolClient;
/** Explicit identifier correspondence between two environments.
 *
 * Not a substring replacement. Each identifier this database owns is mapped as a whole token to
 * a placeholder that says what it *is*: the database, the role that owns and migrates it, or a
 * role derived from the database name. A token that is not one of them is left alone, so a role
 * belonging to another environment shows up literally and fails the comparison instead of being
 * folded into the local one. Two distinct identifiers mapping to one placeholder, or a database
 * whose name equals its owner's, are refused rather than silently collapsed. */
export async function environmentIdentifiers(pool:Queryable){
 const row=(await pool.query<{database:string;owner:string}>('SELECT current_database() database,current_user owner')).rows[0]!;
 if(row.database===row.owner)throw new Error('PRODUCTION_FINGERPRINT_AMBIGUOUS_IDENTITY '+row.database);
 const map=new Map<string,string>([[row.database,'<DATABASE>'],[row.owner,'<MIGRATION_OWNER>']]);
 const derived=(await pool.query<{rolname:string}>(
  `SELECT rolname FROM pg_roles WHERE rolname LIKE current_database()||'\\_%' ORDER BY 1`)).rows;
 for(const {rolname} of derived){
  const placeholder='<DATABASE>'+rolname.slice(row.database.length);
  if(map.has(rolname))throw new Error('PRODUCTION_FINGERPRINT_IDENTIFIER_COLLISION '+rolname);
  map.set(rolname,placeholder);
 }
 const seen=new Set<string>();
 for(const value of map.values()){
  if(seen.has(value))throw new Error('PRODUCTION_FINGERPRINT_IDENTIFIER_COLLISION '+value);
  seen.add(value);
 }
 return map;
}
/** Whole-token substitution. Identifier characters only, so no placeholder can be produced by
 * matching the prefix of a longer name. */
export function tokenNormaliser(map:Map<string,string>){
 return (value:string)=>value.replace(/[A-Za-z0-9_$]+/g,token=>map.get(token)??token);
}
async function fingerprint(pool:Queryable,queries:Array<[string,string]>){
 const normalise=tokenNormaliser(await environmentIdentifiers(pool));
 // Sequential: this also runs against a single pooled client inside a transaction, which
 // cannot serve concurrent queries.
 const parts=[];
 for(const [label,sql] of queries)parts.push({label,rows:(await pool.query<{value:string}>(sql)).rows.map(r=>normalise(r.value)).sort()});
 const material=Object.fromEntries(parts.map(p=>[p.label,p.rows]));
 return{sha256:sha256(JSON.stringify(material)),counts:Object.fromEntries(parts.map(p=>[p.label,p.rows.length])),material};
}
/** Normalised schema fingerprint. */
export async function schemaFingerprint(pool:Queryable){
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
/** Roles this database can be affected by: its owners and grantees, plus every role reachable
 * from them through membership. The closure deliberately includes `pg_` roles, because
 * membership in `pg_read_all_data` or `pg_write_all_data` is exactly the kind of escalation
 * this comparison exists to catch. */
const REFERENCED_ROLES=`WITH RECURSIVE seed AS (
  SELECT relowner AS oid FROM pg_class
  UNION SELECT nspowner FROM pg_namespace
  UNION SELECT proowner FROM pg_proc
  UNION SELECT (aclexplode(relacl)).grantee FROM pg_class WHERE relacl IS NOT NULL
  UNION SELECT (aclexplode(proacl)).grantee FROM pg_proc WHERE proacl IS NOT NULL
  UNION SELECT (aclexplode(nspacl)).grantee FROM pg_namespace WHERE nspacl IS NOT NULL
  UNION SELECT (aclexplode(defaclacl)).grantee FROM pg_default_acl WHERE defaclacl IS NOT NULL
  UNION SELECT defaclrole FROM pg_default_acl
  UNION SELECT oid FROM pg_roles WHERE rolname=current_user
 ), closure AS (
  SELECT oid FROM seed
  UNION SELECT m.roleid FROM pg_auth_members m JOIN closure c ON c.oid=m.member
 ) SELECT oid FROM closure WHERE oid<>0`;
/** In an ACL, grantee 0 is PUBLIC. Dropping those rows would hide the widest grant there is,
 * so they are named instead of filtered out. */
const GRANTEE=`CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END`;
const PERMISSION_REGISTRY_TABLES=['public.staff_role_permissions','public.staff_permission_overrides'];
const EMPTY_REGISTRY_TABLES=[
 'public.real_inventory_sources','public.real_data_acceptance','public.field_acceptance_records',
 'public.foundation_metadata','public.telemetry_events','r15_activation.manifest','r15_activation.operations',
];
const APPROVAL_REGISTRY_TABLES=[...PERMISSION_REGISTRY_TABLES,...EMPTY_REGISTRY_TABLES];
/** Security fingerprint. Structure alone is not enough: who may do what is the part that
 * actually protects Production. Routines are identified by signature, grants carry their grant
 * option, memberships carry all three options and reach `pg_` parents, and row security is
 * compared as policy text rather than as a flag. */
export async function securityFingerprint(pool:Queryable){
 return fingerprint(pool,[
  ['publicTableGrants',`SELECT table_schema||'.'||table_name||' '||privilege_type||' grantable='||is_grantable AS value FROM information_schema.role_table_grants WHERE grantee='PUBLIC'`],
  ['publicColumnGrants',`SELECT table_schema||'.'||table_name||'.'||column_name||' '||privilege_type||' grantable='||is_grantable AS value FROM information_schema.column_privileges WHERE grantee='PUBLIC'`],
  ['publicRoutineExecute',`SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS value
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema' AND has_function_privilege('public',p.oid,'EXECUTE')`],
  ['derivedRoles',`SELECT rolname AS value FROM pg_roles WHERE rolname LIKE current_database()||'\\_%'`],
  ['tableGrants',`SELECT table_schema||'.'||table_name||' '||grantee||' '||privilege_type||' grantable='||is_grantable AS value FROM information_schema.role_table_grants WHERE grantee<>'PUBLIC'`],
  ['columnGrants',`SELECT table_schema||'.'||table_name||'.'||column_name||' '||grantee||' '||privilege_type||' grantable='||is_grantable AS value FROM information_schema.column_privileges WHERE grantee<>'PUBLIC'`],
  ['routineGrants',`SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||${GRANTEE}||' '||a.privilege_type||' grantable='||a.is_grantable::text AS value
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace, aclexplode(p.proacl) a
    WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema'`],
  ['schemaGrants',`SELECT n.nspname||' '||${GRANTEE}||' '||a.privilege_type||' grantable='||a.is_grantable::text AS value
    FROM pg_namespace n, aclexplode(n.nspacl) a WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema'`],
  ['sequenceGrants',`SELECT n.nspname||'.'||c.relname||' '||${GRANTEE}||' '||a.privilege_type||' grantable='||a.is_grantable::text AS value
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace, aclexplode(c.relacl) a
    WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg\\_%'`],
  ['defaultPrivileges',`SELECT coalesce(n.nspname,'-')||' '||pg_get_userbyid(d.defaclrole)||' '||d.defaclobjtype::text||' '||${GRANTEE}||' '||a.privilege_type||' grantable='||a.is_grantable::text AS value
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace, aclexplode(d.defaclacl) a`],
  ['definerRoutines',`SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||p.prosecdef::text||' '||coalesce(array_to_string(p.proconfig,','),'NO_SEARCH_PATH') AS value
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema' AND p.prosecdef`],
  ['tableOwners',`SELECT n.nspname||'.'||c.relname||' '||pg_get_userbyid(c.relowner) AS value FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','v','m','S') AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema'`],
  ['schemaOwners',`SELECT nspname||' '||pg_get_userbyid(nspowner) AS value FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname<>'information_schema'`],
  ['routineOwners',`SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||pg_get_userbyid(p.proowner) AS value FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema'`],
  ['rowSecurity',`SELECT n.nspname||'.'||c.relname||' '||c.relrowsecurity::text||' '||c.relforcerowsecurity::text AS value FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema'`],
  ['rowSecurityPolicies',`SELECT schemaname||'.'||tablename||'.'||policyname||' permissive='||permissive||' cmd='||cmd||' roles='||array_to_string(roles,'+')||' using='||coalesce(qual,'-')||' check='||coalesce(with_check,'-') AS value
    FROM pg_policies WHERE schemaname NOT LIKE 'pg\\_%'`],
  ['roleAttributes',`WITH referenced AS (${REFERENCED_ROLES})
    SELECT r.rolname||' super='||r.rolsuper::text||' createdb='||r.rolcreatedb::text||' createrole='||r.rolcreaterole::text||' replication='||r.rolreplication::text||' bypassrls='||r.rolbypassrls::text||' inherit='||r.rolinherit::text||' login='||r.rolcanlogin::text AS value
    FROM pg_roles r JOIN referenced u ON u.oid=r.oid`],
  ['roleMemberships',`WITH referenced AS (${REFERENCED_ROLES})
    SELECT pg_get_userbyid(m.member)||' IN '||pg_get_userbyid(m.roleid)||' admin='||m.admin_option::text||' inherit='||m.inherit_option::text||' set='||m.set_option::text AS value
    FROM pg_auth_members m JOIN referenced u ON u.oid=m.member`],
  ['approvalRegistries',`SELECT n.nspname||'.'||c.relname||'.'||q.conname||' '||pg_get_constraintdef(q.oid) AS value
    FROM pg_constraint q JOIN pg_class c ON c.oid=q.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE q.contype='c' AND n.nspname||'.'||c.relname IN (${APPROVAL_REGISTRY_TABLES.map(t=>quote(t)).join(',')})`],
  ['permissionRegistry',`SELECT 'staff_role_permissions '||role||' '||permission AS value FROM staff_role_permissions`],
 ]);
}
export const mustBeEmpty=(registry:string)=>EMPTY_REGISTRY_TABLES.includes(registry);
/** Row counts of every approval, A1 development-foundation and A2 historical R15 Sandbox
 * activation registry. The two databases must agree, and the A1/A2 ones must be 0. */
export async function approvalRegistryRows(pool:Queryable){
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
  transformerVersion:plan.transformerVersion,planSha256:plan.planSha256,manifestSha256:plan.manifestSha256,
  provenance:plan.provenance.filter(p=>p.transformation!=='NONE')};
}
