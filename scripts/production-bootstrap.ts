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
 *      the fifty reviewed migrations (0001–0050), its SHA256 and — where one exists — the exact byte
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
 * Historical migration files 0001-0050 stay byte-identical on disk; nothing here writes them.
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
type ManifestEntry={id:string;file:string;sha256:string;runtimeGuards:number;guard:{subject:string;offset:number;fragment:string}|null;ownerCompatibility?:{roleBlockEnd:number;roleBlockSha256:string;firstOwnerTransferOffset:number}};
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
/** Non-superuser owner compatibility (PostgreSQL 16+/18, e.g. managed Neon `neondb_owner`).
 *
 * 0015 creates `<db>_custody_executor`/`<db>_custody` and then transfers ownership to the executor.
 * A CREATEROLE non-superuser that creates a role is automatically, and irrevocably by itself, made an
 * ADMIN member of it, and may only transfer ownership to a role it can SET to that holds CREATE on the
 * target schema/database. So in the Production bootstrap only (never `migrate()`, never the migration
 * files), a transaction-scoped ephemeral creator role creates the two custody roles, bridges the
 * executor to the session with SET/INHERIT, and is dropped before COMMIT together with every
 * membership that involves it. The persistent owner never creates the custody roles itself. */
export const OWNER_COMPATIBILITY_VERSION='production-owner-compat/2';
export const OWNER_COMPATIBILITY_STRATEGY='EPHEMERAL_ROLE_CREATOR';
export const ROLE_CREATION_MIGRATION='0015';
const qi=(v:string)=>{if(!IDENTIFIER.test(v))throw new Error('PRODUCTION_IDENTIFIER_INVALID '+v);return '"'+v+'"';};
/** Deterministic, short, never self-referential (the plan digest is not an input). */
export function bootstrapRoleName(target:string,manifestSha256:string){
 assertProductionTarget(target);
 if(!/^[a-f0-9]{64}$/.test(manifestSha256))throw new Error('PRODUCTION_MANIFEST_DIGEST_INVALID');
 const name='zao_boot_'+sha256(target+'\0'+OWNER_COMPATIBILITY_VERSION+'\0'+manifestSha256).slice(0,16);
 if(!IDENTIFIER.test(name)||Buffer.byteLength(name,'utf8')>63)throw new Error('PRODUCTION_BOOTSTRAP_ROLE_NAME_INVALID');
 return name;
}
/** Anchor A (the role-creation DO block) and anchor B (first ownership transfer), located from
 * structure alone; composeRoleCreationMigration then requires them to equal the committed pin. */
export function locateRoleCreationBlock(sql:string){
 const {statements}=scan(sql),first=statements[0];
 const body=first&&doBody(sql,first);
 if(!first||!body)throw new Error('PRODUCTION_OWNER_COMPAT_ANCHOR_NOT_DO_BLOCK');
 const creates:number[]=[];for(let at=sql.indexOf('CREATE ROLE');at>=0;at=sql.indexOf('CREATE ROLE',at+1))creates.push(at);
 if(creates.length!==2||creates.some(at=>at<body.start||at>=body.end))throw new Error('PRODUCTION_OWNER_COMPAT_ROLE_CREATION_UNEXPECTED');
 // Each CREATE ROLE must be the literal first argument of an EXECUTE format( call that is code.
 const inner=scan(sql.slice(body.start,body.end)).nonCode.map(x=>({start:x.start+body.start,end:x.end+body.start}));
 const call="EXECUTE format('";
 for(const at of creates){const code={start:at-call.length,end:at-1};
  if(sql.slice(at-call.length,at)!==call||inner.some(x=>overlaps(code,x)))throw new Error('PRODUCTION_OWNER_COMPAT_ROLE_CREATION_NOT_CODE');}
 const firstOwnerTransfer=sql.indexOf('OWNER TO');
 if(firstOwnerTransfer<first.end)throw new Error('PRODUCTION_OWNER_COMPAT_TRANSFER_BEFORE_ROLES');
 return{roleBlockEnd:first.end,roleBlockSha256:sha256(sql.slice(0,first.end)),firstOwnerTransferOffset:firstOwnerTransfer};
}
export type OwnerCompatibility={version:string;strategy:string;migration:string;bootstrapRole:string;executorRole:string;custodyRole:string;
 prologue:string[];bridge:string[];cleanup:string[];drop:string};
export function ownerCompatibility(target:string,manifestSha256:string):OwnerCompatibility{
 const role=bootstrapRoleName(target,manifestSha256),boot=qi(role),executor=qi(target+'_custody_executor');
 return{version:OWNER_COMPATIBILITY_VERSION,strategy:OWNER_COMPATIBILITY_STRATEGY,migration:ROLE_CREATION_MIGRATION,
  bootstrapRole:role,executorRole:target+'_custody_executor',custodyRole:target+'_custody',
  prologue:[`CREATE ROLE ${boot} NOLOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;`,`GRANT ${boot} TO SESSION_USER WITH SET TRUE, INHERIT FALSE;`,`SET LOCAL ROLE ${boot};`],
  // Still as the ephemeral role (its automatic ADMIN on the executor authorises the bridge), then back.
  // No database CREATE is granted: PostgreSQL 18 checks database CREATE for ALTER SCHEMA ... OWNER
  // against the invoking user (the database owner), not the new owner. ALTER FUNCTION ... OWNER does
  // require the new owner to hold CREATE on the function's schema, hence the temporary public grant.
  bridge:[`GRANT ${executor} TO SESSION_USER WITH SET TRUE, INHERIT TRUE;`,'RESET ROLE;',`GRANT CREATE ON SCHEMA public TO ${executor};`],
  cleanup:[`REVOKE CREATE ON SCHEMA public FROM ${executor};`,`SET LOCAL ROLE ${boot};`,`REVOKE ${executor} FROM SESSION_USER;`,'RESET ROLE;'],
  drop:`DROP ROLE ${boot};`};
}
/** 0015 as executed by the Production bootstrap: the pinned role block (already guard-rewritten)
 * inside the ephemeral creator context, then the bridge, then the byte-identical remainder. */
export function composeRoleCreationMigration(id:string,canonical:string,rewritten:string,compat:Pick<OwnerCompatibility,'prologue'|'bridge'>){
 const pin=approvedEntry(id).ownerCompatibility,located=locateRoleCreationBlock(canonical);
 if(!pin||located.roleBlockEnd!==pin.roleBlockEnd||located.roleBlockSha256!==pin.roleBlockSha256||located.firstOwnerTransferOffset!==pin.firstOwnerTransferOffset)
  throw new Error('PRODUCTION_OWNER_COMPAT_PIN_MISMATCH '+id);
 const cut=pin.roleBlockEnd+rewritten.length-canonical.length,rest=rewritten.slice(cut);
 if(rest!==canonical.slice(pin.roleBlockEnd)||!rewritten.slice(0,cut).endsWith('END$$;'))throw new Error('PRODUCTION_OWNER_COMPAT_COLLATERAL_CHANGE '+id);
 return compat.prologue.join('\n')+'\n'+rewritten.slice(0,cut)+'\n'+compat.bridge.join('\n')+'\n'+rest;
}
/** Pre-COMMIT proof contract; its digest is bound into the plan. */
const PROOF_CONTRACT={
 preDrop:['ephemeral role exists','pg_shdepend references 0','owns 0 in pg_class/pg_namespace/pg_proc/pg_type/pg_database/pg_tablespace/pg_default_acl','ACL grants 0 on pg_class/pg_proc/pg_namespace/pg_database/pg_default_acl'],
 postDrop:['ephemeral role absent','custody roles exist NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS','session_user direct membership in custody roles 0','no dangling pg_auth_members','executor CREATE on database false (never granted)','executor CREATE on public false (granted temporarily, revoked)'],
};
/** The canonical plan, rewritten for one approved target, with dual provenance.
 * `checksum` is deliberately the CANONICAL SOURCE MIGRATION CHECKSUM — the checksum of the
 * reviewed file, not of the bytes executed — because that is what makes a Production registry
 * comparable with a local one. The executed bytes are recorded separately. */
export async function bootstrapPlan(target:string){
 assertProductionTarget(target);
 const manifest=sourceManifest();
 if(manifest.migrations.length!==migrationPlan.length)throw new Error('PRODUCTION_MANIFEST_LENGTH_MISMATCH '+manifest.migrations.length);
 const entries=[];let guards=0;
 const manifestSha256=sha256(JSON.stringify(manifest)),compat=ownerCompatibility(target,manifestSha256);
 for(const entry of migrationPlan){
  const approved=approvedEntry(entry.id);
  if(approved.file!==entry.file)throw new Error('PRODUCTION_MANIFEST_FILE_MISMATCH '+entry.id);
  const original=await readFile(migrationsDirectory+'/'+entry.file,'utf8');
  const converted=productionMigrationSql(entry.id,original,target);guards+=converted.guards;
  if(entry.id===ROLE_CREATION_MIGRATION)converted.sql=composeRoleCreationMigration(entry.id,original,converted.sql,compat);
  entries.push({...entry,sql:converted.sql,checksum:sha256(original),provenance:{
   id:entry.id,canonicalSha256:sha256(original),approvedSha256:approved.sha256,
   transformerVersion:TRANSFORMER_VERSION,transformation:converted.transformed?TRANSFORMATION_CLASS:'NONE',
   transformedSha256:sha256(converted.sql),target,
  }});
 }
 if(guards!==GUARD_MIGRATIONS)throw new Error('PRODUCTION_GUARD_COUNT_UNEXPECTED '+guards);
 const provenance=entries.map(e=>e.provenance);
 const ownerCompatibilityProvenance={version:compat.version,strategy:compat.strategy,migration:compat.migration,bootstrapRole:compat.bootstrapRole,
  bootstrapRoleDerivation:'zao_boot_ + sha256(target NUL version NUL manifestSha256)[0:16]',anchor:approvedEntry(ROLE_CREATION_MIGRATION).ownerCompatibility,
  prologueSqlSha256:sha256(compat.prologue.join('\n')),bridgeSqlSha256:sha256(compat.bridge.join('\n')),cleanupSqlSha256:sha256([...compat.cleanup,compat.drop].join('\n')),
  proofContractSha256:sha256(JSON.stringify(PROOF_CONTRACT))};
 return{target,entries,provenance,guardsRewritten:guards,transformerVersion:TRANSFORMER_VERSION,ownerCompatibility:compat,ownerCompatibilityProvenance,
  manifestSha256,planSha256:sha256(JSON.stringify({provenance,ownerCompatibility:ownerCompatibilityProvenance}))};
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
 // Literal prefix, never LIKE: a database name containing underscores would make them
 // single-character wildcards, so `zaoxrentalyproductionztest_custody_executor` would be taken
 // for this database's own role and mapped onto its placeholder.
 const derived=(await pool.query<{rolname:string}>(
  `SELECT rolname FROM pg_roles WHERE starts_with(rolname::text,current_database()::text||'_') ORDER BY 1`)).rows;
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
async function fingerprint(pool:Queryable,queries:Array<[string,string]|[string,string,string]>){
 const normalise=tokenNormaliser(await environmentIdentifiers(pool));
 // Sequential: this also runs against a single pooled client inside a transaction, which
 // cannot serve concurrent queries.
 const parts=[];
 for(const [label,sql,requires] of queries){
  // A category over an application table is empty, not an error, before that table exists
  // (the pre-bootstrap fingerprint). Where the table exists the query and rows are unchanged.
  if(requires&&!(await pool.query<{present:boolean}>('SELECT to_regclass($1) IS NOT NULL present',[requires])).rows[0]!.present){parts.push({label,rows:[] as string[]});continue;}
  parts.push({label,rows:(await pool.query<{value:string}>(sql)).rows.map(r=>normalise(r.value)).sort()});
 }
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
/** Viewer-independent table/column privileges. These are PostgreSQL 18's own
 * information_schema.table_privileges and column_privileges definitions (same relkinds, owner
 * default ACL via acldefault(), privilege lists, UNION of table-level and column ACLs, and the
 * owner-based is_grantable), with only the final "visible to the current user" predicate removed and
 * pg_authid read through pg_roles. The information_schema views, and role_table_grants in particular,
 * return different rows to different viewers, so a fingerprint built on them depends on who reads it. */
const TABLE_PRIVILEGE_ROWS=`SELECT nc.nspname AS table_schema,c.relname AS table_name,grantee.rolname AS grantee,c.prtype AS privilege_type,
  CASE WHEN pg_has_role(grantee.oid,c.relowner,'USAGE') OR c.grantable THEN 'YES' ELSE 'NO' END AS is_grantable
 FROM (SELECT oid,relname,relnamespace,relkind,relowner,(aclexplode(coalesce(relacl,acldefault('r',relowner)))).grantor,(aclexplode(coalesce(relacl,acldefault('r',relowner)))).grantee,
   (aclexplode(coalesce(relacl,acldefault('r',relowner)))).privilege_type,(aclexplode(coalesce(relacl,acldefault('r',relowner)))).is_grantable FROM pg_class) c(oid,relname,relnamespace,relkind,relowner,grantor,grantee,prtype,grantable),
  pg_namespace nc,pg_roles u_grantor,(SELECT oid,rolname FROM pg_roles UNION ALL SELECT 0::oid,'PUBLIC'::name) grantee(oid,rolname)
 WHERE c.relnamespace=nc.oid AND c.relkind IN ('r','v','f','p') AND c.grantee=grantee.oid AND c.grantor=u_grantor.oid
  AND c.prtype IN ('INSERT','SELECT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')`;
const COLUMN_PRIVILEGE_ROWS=`SELECT nc.nspname AS table_schema,x.relname AS table_name,x.attname AS column_name,grantee.rolname AS grantee,x.prtype AS privilege_type,
  CASE WHEN pg_has_role(x.grantee,x.relowner,'USAGE') OR x.grantable THEN 'YES' ELSE 'NO' END AS is_grantable
 FROM (SELECT pr_c.grantor,pr_c.grantee,a.attname,pr_c.relname,pr_c.relnamespace,pr_c.prtype,pr_c.grantable,pr_c.relowner
   FROM (SELECT oid,relname,relnamespace,relowner,(aclexplode(coalesce(relacl,acldefault('r',relowner)))).grantor,(aclexplode(coalesce(relacl,acldefault('r',relowner)))).grantee,
     (aclexplode(coalesce(relacl,acldefault('r',relowner)))).privilege_type,(aclexplode(coalesce(relacl,acldefault('r',relowner)))).is_grantable
     FROM pg_class WHERE relkind IN ('r','v','f','p')) pr_c(oid,relname,relnamespace,relowner,grantor,grantee,prtype,grantable),pg_attribute a
   WHERE a.attrelid=pr_c.oid AND a.attnum>0 AND NOT a.attisdropped
  UNION
  SELECT pr_a.grantor,pr_a.grantee,pr_a.attname,c.relname,c.relnamespace,pr_a.prtype,pr_a.grantable,c.relowner
   FROM (SELECT a.attrelid,a.attname,(aclexplode(coalesce(a.attacl,acldefault('c',cc.relowner)))).grantor,(aclexplode(coalesce(a.attacl,acldefault('c',cc.relowner)))).grantee,
     (aclexplode(coalesce(a.attacl,acldefault('c',cc.relowner)))).privilege_type,(aclexplode(coalesce(a.attacl,acldefault('c',cc.relowner)))).is_grantable
     FROM pg_attribute a JOIN pg_class cc ON a.attrelid=cc.oid WHERE a.attnum>0 AND NOT a.attisdropped) pr_a(attrelid,attname,grantor,grantee,prtype,grantable),pg_class c
   WHERE pr_a.attrelid=c.oid AND c.relkind IN ('r','v','f','p')) x,
  pg_namespace nc,pg_roles u_grantor,(SELECT oid,rolname FROM pg_roles UNION ALL SELECT 0::oid,'PUBLIC'::name) grantee(oid,rolname)
 WHERE x.relnamespace=nc.oid AND x.grantee=grantee.oid AND x.grantor=u_grantor.oid AND x.prtype IN ('INSERT','SELECT','UPDATE','REFERENCES')`;
const ACL_CATEGORY_SQL={
 publicTableGrants:`SELECT table_schema||'.'||table_name||' '||privilege_type||' grantable='||is_grantable AS value FROM (${TABLE_PRIVILEGE_ROWS}) t WHERE grantee='PUBLIC'`,
 publicColumnGrants:`SELECT table_schema||'.'||table_name||'.'||column_name||' '||privilege_type||' grantable='||is_grantable AS value FROM (${COLUMN_PRIVILEGE_ROWS}) t WHERE grantee='PUBLIC'`,
 tableGrants:`SELECT table_schema||'.'||table_name||' '||grantee||' '||privilege_type||' grantable='||is_grantable AS value FROM (${TABLE_PRIVILEGE_ROWS}) t WHERE grantee<>'PUBLIC'`,
 columnGrants:`SELECT table_schema||'.'||table_name||'.'||column_name||' '||grantee||' '||privilege_type||' grantable='||is_grantable AS value FROM (${COLUMN_PRIVILEGE_ROWS}) t WHERE grantee<>'PUBLIC'`,
} as const;
/** Raw (un-normalised) material of the four ACL categories, for viewer-invariance proofs. */
export async function aclGrantRows(pool:Queryable){
 const out:Record<keyof typeof ACL_CATEGORY_SQL,string[]>={publicTableGrants:[],publicColumnGrants:[],tableGrants:[],columnGrants:[]};
 for(const k of Object.keys(ACL_CATEGORY_SQL) as (keyof typeof ACL_CATEGORY_SQL)[])out[k]=(await pool.query<{value:string}>(ACL_CATEGORY_SQL[k])).rows.map(r=>r.value).sort();
 return out;
}
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
  ['publicTableGrants',ACL_CATEGORY_SQL.publicTableGrants],
  ['publicColumnGrants',ACL_CATEGORY_SQL.publicColumnGrants],
  ['publicRoutineExecute',`SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS value
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname<>'information_schema' AND has_function_privilege('public',p.oid,'EXECUTE')`],
  ['derivedRoles',`SELECT rolname AS value FROM pg_roles WHERE starts_with(rolname::text,current_database()::text||'_')`],
  ['tableGrants',ACL_CATEGORY_SQL.tableGrants],
  ['columnGrants',ACL_CATEGORY_SQL.columnGrants],
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
  ['permissionRegistry',`SELECT 'staff_role_permissions '||role||' '||permission AS value FROM staff_role_permissions`,'public.staff_role_permissions'],
 ]);
}
export type Fingerprint=Awaited<ReturnType<typeof schemaFingerprint>>;
export type FingerprintDelta={sha256:string;categories:Record<string,{added:string[];removed:string[]}>};
/** Pure before→after change of one environment's fingerprint, per category, as multisets: a row
 * present twice before and once after is one removal, never zero. Output order is deterministic
 * and the digest is over that canonical form. Provider/cluster baseline rows that the bootstrap
 * does not touch cancel out; anything the bootstrap (or anyone else) changed remains visible. */
export function fingerprintDelta(before:Pick<Fingerprint,'material'>,after:Pick<Fingerprint,'material'>):FingerprintDelta{
 const labels=[...new Set([...Object.keys(before.material),...Object.keys(after.material)])].sort();
 const categories:FingerprintDelta['categories']={};
 for(const label of labels){
  const count=new Map<string,number>();
  for(const row of before.material[label]??[])count.set(row,(count.get(row)??0)-1);
  for(const row of after.material[label]??[])count.set(row,(count.get(row)??0)+1);
  const added:string[]=[],removed:string[]=[];
  for(const [row,n] of count){for(let i=0;i<n;i++)added.push(row);for(let i=0;i>n;i--)removed.push(row);}
  categories[label]={added:added.sort(),removed:removed.sort()};
 }
 return{sha256:sha256(JSON.stringify(categories)),categories};
}
/** Categories whose deltas differ between two environments (empty means delta-equivalent). */
export function deltaMismatch(expected:FingerprintDelta,actual:FingerprintDelta){
 return [...new Set([...Object.keys(expected.categories),...Object.keys(actual.categories)])].sort()
  .filter(k=>JSON.stringify(expected.categories[k]??{added:[],removed:[]})!==JSON.stringify(actual.categories[k]??{added:[],removed:[]}));
}
/** Read-only evidence of who will run the bootstrap and what the provider gave that role. Recorded
 * separately; never compared with a local cluster owner, whose posture is a different baseline. */
export async function migrationOwnerPosture(pool:Queryable){
 const row=(await pool.query<{database:string;role:string;databaseOwner:string}>('SELECT current_database() database,current_user role,pg_get_userbyid(d.datdba) "databaseOwner" FROM pg_database d WHERE d.datname=current_database()')).rows[0]!;
 const attributes=(await pool.query<{value:string}>(`SELECT 'super='||rolsuper::text||' createdb='||rolcreatedb::text||' createrole='||rolcreaterole::text||' replication='||rolreplication::text||' bypassrls='||rolbypassrls::text||' inherit='||rolinherit::text||' login='||rolcanlogin::text AS value FROM pg_roles WHERE rolname=current_user`)).rows[0]!.value;
 const memberships=(await pool.query<{value:string}>(`WITH RECURSIVE up AS (
   SELECT m.roleid,m.member,m.admin_option,m.inherit_option,m.set_option,1 AS depth FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=current_user
   UNION SELECT m.roleid,m.member,m.admin_option,m.inherit_option,m.set_option,up.depth+1 FROM pg_auth_members m JOIN up ON m.member=up.roleid WHERE up.depth<16)
  SELECT pg_get_userbyid(member)||' IN '||pg_get_userbyid(roleid)||' admin='||admin_option::text||' inherit='||inherit_option::text||' set='||set_option::text AS value FROM up`)).rows.map(r=>r.value).sort();
 const createroleSelfGrant=(await pool.query<{v:string}>(`SELECT current_setting('createrole_self_grant',true) v`)).rows[0]!.v??'';
 return{...row,attributes,memberships,createroleSelfGrant};
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
 return runBootstrapPlan(pool,await bootstrapPlan(target));
}
export type BootstrapPlan=Awaited<ReturnType<typeof bootstrapPlan>>;
/** One transaction: migrations, owner-compatibility cleanup, ephemeral-role proofs, COMMIT.
 * Product use always goes through bootstrapProductionSchema(); tests pass deliberately mutated plans. */
export async function runBootstrapPlan(pool:Pool,plan:BootstrapPlan){
 const compat=plan.ownerCompatibility;
 if((await pool.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[compat.bootstrapRole])).rowCount)throw new Error('PRODUCTION_BOOTSTRAP_ROLE_ALREADY_EXISTS');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(71820401)');
  await client.query('CREATE TABLE foundation_migrations (id text PRIMARY KEY, checksum text NOT NULL)');
  for(const entry of plan.entries){
   await client.query(entry.sql);
   await client.query('INSERT INTO foundation_migrations VALUES($1,$2)',[entry.id,entry.checksum]);
  }
  for(const statement of compat.cleanup)await client.query(statement);
  await assertEphemeralRoleDroppable(client,compat.bootstrapRole);
  if(compat.drop)try{await client.query(compat.drop);}catch{throw new Error('PRODUCTION_BOOTSTRAP_EPHEMERAL_ROLE_DEPENDENCY');}
  await assertOwnerCompatibilityCleared(client,compat);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 return{applied:plan.entries.length,guardsRewritten:plan.guardsRewritten,target:plan.target,
  transformerVersion:plan.transformerVersion,planSha256:plan.planSha256,manifestSha256:plan.manifestSha256,
  provenance:plan.provenance.filter(p=>p.transformation!=='NONE'),ownerCompatibility:plan.ownerCompatibilityProvenance};
}
const row=async(c:PoolClient,sql:string,params:unknown[])=>(await c.query(sql,params)).rows[0] as Record<string,unknown>;
/** The ephemeral creator may be dropped only when nothing but its own memberships refers to it;
 * a dependency is a design violation, never something to REASSIGN/DROP OWNED away. */
async function assertEphemeralRoleDroppable(c:PoolClient,role:string){
 const r=await row(c,`WITH b AS (SELECT oid FROM pg_roles WHERE rolname=$1) SELECT
  (SELECT count(*) FROM b)::int AS present,
  (SELECT count(*) FROM pg_shdepend d,b WHERE d.refclassid='pg_authid'::regclass AND d.refobjid=b.oid)::int AS shdepend,
  ((SELECT count(*) FROM pg_class,b WHERE relowner=b.oid)+(SELECT count(*) FROM pg_namespace,b WHERE nspowner=b.oid)+(SELECT count(*) FROM pg_proc,b WHERE proowner=b.oid)
   +(SELECT count(*) FROM pg_type,b WHERE typowner=b.oid)+(SELECT count(*) FROM pg_database,b WHERE datdba=b.oid)+(SELECT count(*) FROM pg_tablespace,b WHERE spcowner=b.oid)
   +(SELECT count(*) FROM pg_default_acl,b WHERE defaclrole=b.oid))::int AS owned,
  ((SELECT count(*) FROM pg_class c,aclexplode(c.relacl) a,b WHERE a.grantee=b.oid)+(SELECT count(*) FROM pg_proc p,aclexplode(p.proacl) a,b WHERE a.grantee=b.oid)
   +(SELECT count(*) FROM pg_namespace n,aclexplode(n.nspacl) a,b WHERE a.grantee=b.oid)+(SELECT count(*) FROM pg_database d,aclexplode(d.datacl) a,b WHERE a.grantee=b.oid)
   +(SELECT count(*) FROM pg_default_acl d,aclexplode(d.defaclacl) a,b WHERE a.grantee=b.oid))::int AS grants`,[role]);
 if(r.present!==1||r.shdepend!==0||r.owned!==0||r.grants!==0)throw new Error('PRODUCTION_BOOTSTRAP_EPHEMERAL_ROLE_DEPENDENCY');
}
/** Pre-COMMIT proof that no bootstrap-only capability or membership survives. */
async function assertOwnerCompatibilityCleared(c:PoolClient,compat:OwnerCompatibility){
 const r=await row(c,`SELECT
  (SELECT count(*) FROM pg_roles WHERE rolname=$1)::int AS ephemeral,
  (SELECT count(*) FROM pg_roles WHERE rolname IN ($2,$3) AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)::int AS custody,
  (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member=session_user::regrole AND r.rolname IN ($2,$3))::int AS memberships,
  (SELECT count(*) FROM pg_auth_members m WHERE NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.oid=m.roleid) OR NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.oid=m.member) OR NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.oid=m.grantor))::int AS dangling,
  has_database_privilege($2,current_database(),'CREATE') AS database_create,
  has_schema_privilege($2,'public','CREATE') AS public_create`,[compat.bootstrapRole,compat.executorRole,compat.custodyRole]);
 if(r.ephemeral!==0||r.custody!==2||r.memberships!==0||r.dangling!==0||r.database_create!==false||r.public_create!==false)throw new Error('PRODUCTION_BOOTSTRAP_TEMPORARY_CAPABILITY_CLEANUP_FAILED');
}
