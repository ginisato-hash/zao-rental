import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {migrate,migrationPlan,migrationsDirectory} from '../../packages/db/src/index';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {bootstrapProductionSchema,bootstrapPlan,schemaFingerprint,securityFingerprint,approvalRegistryRows,
 productionMigrationSql,locateMigrationGuard,canonicalMigrations,environmentIdentifiers,tokenNormaliser,
 sourceManifest,mustBeEmpty,GUARD_MIGRATIONS,TRANSFORMER_VERSION,TRANSFORMATION_CLASS} from '../../scripts/production-bootstrap';
const TARGET='zao_rental_production_test';
const CANONICAL='zr_'+randomBytes(6).toString('hex');
const GUARDED=['0015','0016','0017','0018','0019','0033','0034','0035','0036','0037','0038','0039'];
const file=(name:string)=>readFile(migrationsDirectory+'/'+name,'utf8');
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const notRun:Array<{case:string;reason:string}>=[];
let failed=false,stage='setup',count=0,planSha='',manifestSha='';
const db=await startIsolatedPostgres();
let production:Pool|undefined,canonical:Pool|undefined;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
/** Applies one privilege change inside a transaction, fingerprints, then rolls it back. */
async function mutate(pool:Pool,sql:string[]){
 const client=await pool.connect();
 try{await client.query('BEGIN');for(const statement of sql)await client.query(statement);
  return await securityFingerprint(client);}
 finally{await client.query('ROLLBACK').catch(()=>undefined);client.release();}
}
const changedKeys=(a:Awaited<ReturnType<typeof securityFingerprint>>,b:Awaited<ReturnType<typeof securityFingerprint>>)=>
 Object.keys(b.material).filter(k=>JSON.stringify(a.material[k])!==JSON.stringify(b.material[k]));
try{
 await check('the canonical path still refuses a Production-shaped database',async()=>{
  await db.pool.query(`CREATE DATABASE ${TARGET}`);
  await db.pool.query(`CREATE DATABASE ${CANONICAL}`);
  const source=db.pool.options as {password?:string};
  const connect=(database:string)=>new Pool({host:'127.0.0.1',port:db.identity.dbPort,user:db.identity.user,password:source.password,database,max:4});
  production=connect(TARGET);canonical=connect(CANONICAL);
  // Unmodified migrations must still fail closed on a database that is not an owned local one.
  await assert.rejects(migrate(production),/Dedicated development|development DB required/);
  assert.equal(Number((await production.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE c.relkind='r' AND s.nspname='public'")).rows[0].n),0);
 });

 await check('the approved-source manifest pins every reviewed migration',async()=>{
  const manifest=sourceManifest();manifestSha=digest(JSON.stringify(manifest));
  assert.equal(manifest.transformer,TRANSFORMER_VERSION);
  assert.equal(manifest.migrations.length,migrationPlan.length);
  assert.deepEqual(manifest.migrations.map(m=>m.id),migrationPlan.map(m=>m.id));
  assert.deepEqual(manifest.migrations.filter(m=>m.guard).map(m=>m.id),GUARDED);
  // The pinned digest is the reviewed file's, and the pinned offset holds the pinned fragment.
  for(const entry of manifest.migrations){
   const sql=await file(entry.file);
   assert.equal(entry.sha256,digest(sql),entry.id);
   if(entry.guard)assert.equal(sql.slice(entry.guard.offset,entry.guard.offset+entry.guard.fragment.length),entry.guard.fragment,entry.id);
  }
  assert.deepEqual(manifest.migrations.filter(m=>m.runtimeGuards>0).map(m=>[m.id,m.runtimeGuards]),[['0028',1],['0029',2]]);
 });

 await check('the rewrite moves the identity test and touches nothing else',async()=>{
  const entries=await canonicalMigrations(TARGET);
  assert.equal(entries.length,migrationPlan.length);
  const changed=[];
  for(const entry of entries){
   const original=await file(entry.file);
   if(entry.sql!==original)changed.push(entry.id);
   // The registry keeps the CANONICAL SOURCE MIGRATION CHECKSUM, not the executed bytes.
   assert.equal(entry.checksum,digest(original));
  }
  assert.equal(changed.length,GUARD_MIGRATIONS);
  assert.deepEqual(changed,GUARDED);
  // Runtime guards inside development/Sandbox payment function bodies are never rewritten.
  for(const id of ['0028','0029']){
   const name=migrationPlan.find(m=>m.id===id)!.file,original=await file(name);
   assert.equal(productionMigrationSql(id,original,TARGET).sql,original,name);
   assert.equal(productionMigrationSql(id,original,TARGET).guards,0,name);
  }
  for(const bad of ['zr_0123456789ab','Zao','x','public schema'])
   assert.throws(()=>productionMigrationSql('0016','x',bad),/PRODUCTION_TARGET_INVALID/);
 });

 await check('both gates refuse every unapproved or misplaced guard',async()=>{
  const guard="current_database() !~ '^zr_[a-f0-9]{12}$'";
  const cases:Array<[string,string,string,RegExp]>=[
   // A guard that is not executable migration-time SQL must never be rewritten.
   ['guard in a block comment','0016',`/* note:\nDO $$BEGIN IF ${guard} THEN RAISE EXCEPTION 'x';END IF;END$$;\n*/\nSELECT 1;\n`,/NOT_MIGRATION_TIME/],
   ['guard in a dollar-quoted string','0016',`SELECT $doc$\nDO $$BEGIN IF ${guard} THEN RAISE EXCEPTION 'x';END IF;END$$;\n$doc$;\n`,/NOT_MIGRATION_TIME/],
   ['guard in dynamic SQL inside a function','0016',`CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $fn$BEGIN EXECUTE $q$\nDO $$BEGIN IF ${guard} THEN RAISE EXCEPTION 'x';END IF;END$$;\n$q$;END$fn$;\n`,/NOT_MIGRATION_TIME/],
   ['guard commented out inside a DO body','0016',`DO $$BEGIN\n -- IF ${guard} THEN RAISE EXCEPTION 'x';END IF;\n NULL;\nEND$$;\n`,/NOT_CODE/],
   // The subject is a whole identifier: `n` must not match the tail of `tenant_n`.
   ['0015 subject renamed to tenant_n','0015',`DO $$DECLARE tenant_n text:=current_database();BEGIN\n IF tenant_n !~ '^zr_[a-f0-9]{12}$' THEN RAISE EXCEPTION 'x';END IF;\nEND$$;\n`,/FRAGMENT_UNEXPECTED/],
   ['guard removed','0016',`DO $$BEGIN IF true THEN RAISE EXCEPTION 'x';END IF;END$$;\n`,/SHAPE_UNEXPECTED/],
   ['second guard added','0016',`DO $$BEGIN IF ${guard} THEN RAISE EXCEPTION 'x';END IF;END$$;\nDO $$BEGIN IF ${guard} THEN RAISE EXCEPTION 'x';END IF;END$$;\n`,/SHAPE_UNEXPECTED/],
   ['wrong subject expression','0016',`DO $$BEGIN IF n !~ '^zr_[a-f0-9]{12}$' THEN RAISE EXCEPTION 'x';END IF;END$$;\n`,/FRAGMENT_UNEXPECTED/],
   ['unguarded migration gains a guard','0001',`DO $$BEGIN IF ${guard} THEN RAISE EXCEPTION 'x';END IF;END$$;\n`,/SHAPE_UNEXPECTED/],
   ['runtime guard count drifts','0029',`DO $$BEGIN IF ${guard} THEN RAISE EXCEPTION 'x';END IF;END$$;\n`,/SHAPE_UNEXPECTED/],
  ];
  for(const [name,id,sql,structural] of cases){
   // Gate 2 refuses on structure alone, with no manifest involved.
   assert.throws(()=>locateMigrationGuard(id,sql),structural,name);
   // Gate 1 refuses the same input because the bytes are not the reviewed ones.
   assert.throws(()=>productionMigrationSql(id,sql,TARGET),/PRODUCTION_SOURCE_NOT_APPROVED/,name);
  }
  // An id that is not in the reviewed set is refused outright.
  assert.throws(()=>productionMigrationSql('9999','SELECT 1;',TARGET),/PRODUCTION_SOURCE_UNKNOWN_MIGRATION/);
  // A reviewed migration whose bytes changed by one character is refused.
  const original=await file(migrationPlan.find(m=>m.id==='0016')!.file);
  assert.throws(()=>productionMigrationSql('0016',original+'\n',TARGET),/PRODUCTION_SOURCE_NOT_APPROVED/);
 });

 await check('every transformed migration carries dual provenance',async()=>{
  const plan=await bootstrapPlan(TARGET);planSha=plan.planSha256;
  assert.equal(plan.transformerVersion,TRANSFORMER_VERSION);
  assert.equal(plan.manifestSha256,manifestSha);
  assert.equal(plan.provenance.length,migrationPlan.length);
  assert.deepEqual(plan.provenance.filter(p=>p.transformation!=='NONE').map(p=>p.id),GUARDED);
  for(const record of plan.provenance){
   const sql=await file(migrationPlan.find(m=>m.id===record.id)!.file);
   assert.equal(record.canonicalSha256,digest(sql),record.id);
   assert.equal(record.approvedSha256,record.canonicalSha256,record.id);
   assert.equal(record.target,TARGET);
   if(record.transformation==='NONE')assert.equal(record.transformedSha256,record.canonicalSha256,record.id);
   else{assert.equal(record.transformation,TRANSFORMATION_CLASS);assert.notEqual(record.transformedSha256,record.canonicalSha256,record.id);}
  }
  assert.equal((await bootstrapPlan(TARGET)).planSha256,planSha);
  assert.notEqual((await bootstrapPlan('zao_rental_other_target')).planSha256,planSha);
  assert.match(JSON.stringify(plan.provenance),/^[A-Za-z0-9_@/{}[\]":,.-]+$/);
 });

 await check('normalisation maps identifiers exactly and never folds a foreign role',async()=>{
  // The reviewer's collision: a Production database whose owner is a zr_ role. Whole-token
  // mapping keeps the two custody executors apart; substring folding did not.
  const map=new Map([[TARGET,'<DATABASE>'],['zr_0123456789ab','<MIGRATION_OWNER>'],[TARGET+'_custody_executor','<DATABASE>_custody_executor']]);
  const normalise=tokenNormaliser(map);
  assert.equal(normalise(`public.inventory_claims ${TARGET}_custody_executor SELECT`),'public.inventory_claims <DATABASE>_custody_executor SELECT');
  assert.equal(normalise('public.inventory_claims zr_0123456789ab_custody_executor SELECT'),'public.inventory_claims zr_0123456789ab_custody_executor SELECT');
  assert.equal(normalise('owner zr_0123456789ab'),'owner <MIGRATION_OWNER>');
  // A database whose name equals its owner cannot be compared unambiguously, and says so.
  await assert.rejects(environmentIdentifiers(db.pool),/PRODUCTION_FINGERPRINT_AMBIGUOUS_IDENTITY/);
  const identifiers=await environmentIdentifiers(canonical!);
  assert.equal(identifiers.get(CANONICAL),'<DATABASE>');
  assert.equal(identifiers.get(db.identity.user),'<MIGRATION_OWNER>');
  assert.equal(identifiers.get(CANONICAL+'_custody_executor'),undefined);
 });

 let canonicalSchema:Awaited<ReturnType<typeof schemaFingerprint>>|undefined;
 await check('STRUCTURAL_EQUIVALENCE: the two databases hold the same schema',async()=>{
  await migrate(canonical!);
  canonicalSchema=await schemaFingerprint(canonical!);
  const result=await bootstrapProductionSchema(production!,TARGET);
  assert.equal(result.applied,migrationPlan.length);
  assert.equal(result.guardsRewritten,GUARD_MIGRATIONS);
  assert.equal(result.planSha256,planSha);
  assert.equal(result.manifestSha256,manifestSha);
  assert.deepEqual(result.provenance.map(p=>p.id),GUARDED);
  const bootstrapped=await schemaFingerprint(production!);
  for(const key of Object.keys(canonicalSchema.material))assert.deepEqual(bootstrapped.material[key],canonicalSchema.material[key],key);
  assert.equal(bootstrapped.sha256,canonicalSchema.sha256);
  for(const kind of ['functions','triggers','constraints','tables','columns','indexes','views','types','schemas'])assert.ok((canonicalSchema.counts[kind]??0)>0,kind);
 });

 let baseline:Awaited<ReturnType<typeof securityFingerprint>>|undefined;
 await check('SECURITY_EQUIVALENCE: the same privileges, definer rights and ownership',async()=>{
  const canonicalSecurity=await securityFingerprint(canonical!);baseline=await securityFingerprint(production!);
  for(const key of Object.keys(canonicalSecurity.material))assert.deepEqual(baseline.material[key],canonicalSecurity.material[key],key);
  assert.equal(baseline.sha256,canonicalSecurity.sha256);
  for(const kind of ['definerRoutines','tableOwners','schemaOwners','routineOwners','roleAttributes','derivedRoles',
   'tableGrants','columnGrants','routineGrants','schemaGrants','approvalRegistries','permissionRegistry'])
   assert.ok((canonicalSecurity.counts[kind]??0)>0,kind);
  assert.ok(baseline.material.derivedRoles!.includes('<DATABASE>_custody_executor'),JSON.stringify(baseline.material.derivedRoles));
  for(const row of baseline.material.definerRoutines!)assert.ok(row.includes('search_path='),row.slice(0,90));
  assert.equal(baseline.material.definerRoutines!.some(r=>r.includes('NO_SEARCH_PATH')),false);
  // Only the migrating owner may hold escalation attributes or log in.
  for(const row of baseline.material.roleAttributes!){
   const role=row.split(' ')[0]!;
   if(role==='<MIGRATION_OWNER>')continue;
   for(const attribute of ['super=true','createdb=true','createrole=true','replication=true','bypassrls=true','login=true'])
    assert.ok(!row.includes(attribute),role+' has '+attribute);
  }
  // No role reaches an escalation attribute through a membership either.
  const escalating=new Set(baseline.material.roleAttributes!.filter(r=>/super=true|createrole=true|createdb=true|bypassrls=true/.test(r)).map(r=>r.split(' ')[0]!));
  for(const row of baseline.material.roleMemberships!)
   assert.equal(escalating.has(row.split(' IN ')[1]!.split(' admin=')[0]!),false,row);
 });

 await check('SECURITY_EQUIVALENCE detects an injected privilege change',async()=>{
  const executor=TARGET+'_custody_executor';
  const sequence=(await production!.query<{name:string}>(`SELECT n.nspname||'.'||c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg\\_%' ORDER BY 1 LIMIT 1`)).rows[0]?.name;
  const mutations:Array<{name:string;key:string;sql:string[]}>=[
   {name:'pg_read_all_data membership',key:'roleMemberships',sql:[`GRANT pg_read_all_data TO "${executor}"`]},
   {name:'pg_write_all_data membership',key:'roleMemberships',sql:[`GRANT pg_write_all_data TO "${executor}"`]},
   {name:'transitive membership through a new parent',key:'roleMemberships',sql:['CREATE ROLE probe_parent NOLOGIN',`GRANT pg_read_all_data TO probe_parent`,`GRANT probe_parent TO "${executor}"`]},
   {name:'PUBLIC column grant',key:'publicColumnGrants',sql:['GRANT SELECT(id) ON rental_bookings TO PUBLIC']},
   {name:'schema CREATE grant',key:'schemaGrants',sql:[`GRANT CREATE ON SCHEMA public TO "${executor}"`]},
   {name:'PUBLIC schema CREATE grant',key:'schemaGrants',sql:['GRANT CREATE ON SCHEMA public TO PUBLIC']},
   {name:'default privileges',key:'defaultPrivileges',sql:[`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO "${executor}"`]},
   {name:'table grant option',key:'tableGrants',sql:[`GRANT SELECT ON ledger_assets TO "${executor}" WITH GRANT OPTION`]},
   {name:'row security policy',key:'rowSecurityPolicies',sql:[`CREATE POLICY probe_policy ON rental_bookings FOR SELECT TO "${executor}" USING (true)`]},
  ];
  if(sequence){
   mutations.push({name:'sequence grant',key:'sequenceGrants',sql:[`GRANT USAGE ON SEQUENCE ${sequence} TO "${executor}"`]});
   mutations.push({name:'PUBLIC sequence USAGE grant',key:'sequenceGrants',sql:[`GRANT USAGE ON SEQUENCE ${sequence} TO PUBLIC`]});
  }else notRun.push({case:'sequence grant',reason:'NO_SEQUENCE_IN_SCHEMA'},{case:'PUBLIC sequence USAGE grant',reason:'NO_SEQUENCE_IN_SCHEMA'});
  for(const mutation of mutations){
   const after=await mutate(production!,mutation.sql);
   assert.notEqual(after.sha256,baseline!.sha256,mutation.name+' went undetected');
   const changed=changedKeys(baseline!,after);
   assert.ok(changed.includes(mutation.key),`${mutation.name}: expected ${mutation.key}, changed ${changed.join(',')||'nothing'}`);
  }
  // Routines are identified by signature. The schema ships no overload, so the pair is built
  // here: swapping the owner between two same-named routines leaves the (name, owner) multiset
  // unchanged, so a fingerprint that dropped argument types could not tell the two states apart.
  const overloads=[`CREATE FUNCTION probe_overload(integer) RETURNS integer LANGUAGE sql AS $$SELECT 1$$`,
   `CREATE FUNCTION probe_overload(text) RETURNS integer LANGUAGE sql AS $$SELECT 1$$`];
  const ownerLeft=await mutate(production!,[...overloads,`ALTER FUNCTION probe_overload(integer) OWNER TO "${executor}"`]);
  const ownerRight=await mutate(production!,[...overloads,`ALTER FUNCTION probe_overload(text) OWNER TO "${executor}"`]);
  assert.notEqual(ownerRight.sha256,ownerLeft.sha256,'routine owners are not identified by signature');
  assert.ok(changedKeys(ownerLeft,ownerRight).includes('routineOwners'),changedKeys(ownerLeft,ownerRight).join(','));
  const grantLeft=await mutate(production!,[...overloads,`GRANT EXECUTE ON FUNCTION probe_overload(integer) TO "${executor}"`]);
  const grantRight=await mutate(production!,[...overloads,`GRANT EXECUTE ON FUNCTION probe_overload(text) TO "${executor}"`]);
  assert.notEqual(grantRight.sha256,grantLeft.sha256,'routine grants are not identified by signature');
  assert.ok(changedKeys(grantLeft,grantRight).includes('routineGrants'),changedKeys(grantLeft,grantRight).join(','));

  // Membership options are compared, not just the edge. Each option is compared against its
  // own opposite rather than against a default, because the custody executor is NOINHERIT and
  // so already defaults to INHERIT FALSE.
  for(const option of ['ADMIN','INHERIT','SET']){
   const off=await mutate(production!,[`GRANT pg_read_all_data TO "${executor}" WITH ${option} FALSE`]);
   const on=await mutate(production!,[`GRANT pg_read_all_data TO "${executor}" WITH ${option} TRUE`]);
   assert.notEqual(on.sha256,off.sha256,'membership option ignored: '+option);
   assert.ok(changedKeys(off,on).includes('roleMemberships'),option);
  }
  // Every mutation was rolled back; the two databases still agree.
  assert.equal((await securityFingerprint(production!)).sha256,baseline!.sha256);
  assert.equal((await securityFingerprint(canonical!)).sha256,baseline!.sha256);
 });

 await check('Production carries no approvals, no development foundation rows and no R15 activation',async()=>{
  const rows=await approvalRegistryRows(production!);
  assert.deepEqual(rows,await approvalRegistryRows(canonical!));
  // A1 development foundation artifacts and A2 historical R15 Sandbox activation artifacts
  // exist but stay empty: 0030 belongs to the finite R15 Square Sandbox acceptance.
  for(const registry of ['public.real_inventory_sources','public.real_data_acceptance','public.field_acceptance_records','public.foundation_metadata','public.telemetry_events','r15_activation.manifest','r15_activation.operations']){
   const row=rows.find(r=>r.registry===registry);
   assert.ok(row,registry);assert.ok(mustBeEmpty(registry),registry);assert.equal(row!.rows,0,registry);
  }
  assert.equal(rows.find(r=>r.registry==='public.staff_role_permissions')!.rows,7);
 });

 await check('the migration registry matches the canonical one exactly',async()=>{
  const local=(await canonical!.query('SELECT id,checksum FROM foundation_migrations ORDER BY id')).rows;
  const remote=(await production!.query('SELECT id,checksum FROM foundation_migrations ORDER BY id')).rows;
  assert.deepEqual(remote,local);
  assert.equal(remote.length,migrationPlan.length);
  for(const row of remote as Array<{id:string;checksum:string}>)
   assert.equal(row.checksum,digest(await file(migrationPlan.find(m=>m.id===row.id)!.file)),row.id);
 });

 await check('running the canonical migrator afterwards is inert',async()=>{
  const before=await schemaFingerprint(production!);
  await migrate(production!);
  await migrate(production!);
  assert.equal((await schemaFingerprint(production!)).sha256,before.sha256);
  assert.equal(Number((await production!.query('SELECT count(*)::int n FROM foundation_migrations')).rows[0].n),migrationPlan.length);
 });

 await check('bootstrap refuses a non-empty database, a wrong target and a disposable name',async()=>{
  await assert.rejects(bootstrapProductionSchema(production!,TARGET),/PRODUCTION_DATABASE_NOT_EMPTY/);
  await assert.rejects(bootstrapProductionSchema(production!,'zao_rental_other_target'),/PRODUCTION_TARGET_MISMATCH/);
  await assert.rejects(bootstrapProductionSchema(db.pool,db.identity.database),/PRODUCTION_TARGET_INVALID/);
 });

 console.log(JSON.stringify({status:'PASS',cases:count,migrations:migrationPlan.length,guardsRewritten:GUARD_MIGRATIONS,
  transformerVersion:TRANSFORMER_VERSION,manifestSha256:manifestSha,planSha256:planSha,
  structuralEquivalence:'PASS',securityEquivalence:'PASS',schemaFingerprint:canonicalSchema!.sha256,
  notRun,hostedProductionDdl:0,realNeonProductionMutation:0,productionShapedLocalDdl:1}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:(e as Error).message.slice(0,900)}));}
finally{for(const pool of [production,canonical])if(pool)await pool.end().catch(()=>undefined);await db.stop();}
if(failed)process.exit(1);
