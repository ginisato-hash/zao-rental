import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {migrate,migrationPlan,migrationsDirectory} from '../../packages/db/src/index';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {bootstrapProductionSchema,bootstrapPlan,schemaFingerprint,securityFingerprint,approvalRegistryRows,mustBeEmpty,
 productionMigrationSql,canonicalMigrations,GUARD_MIGRATIONS,TRANSFORMER_VERSION,TRANSFORMATION_CLASS} from '../../scripts/production-bootstrap';
const TARGET='zao_rental_production_test';let canonicalOwner='';
const GUARDED=['0015','0016','0017','0018','0019','0033','0034','0035','0036','0037','0038','0039'];
const file=(name:string)=>readFile(migrationsDirectory+'/'+name,'utf8');
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
let failed=false,stage='setup',count=0;
const db=await startIsolatedPostgres();let production:Pool|undefined;let planSha='';
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 await check('the canonical path still refuses a Production-shaped database',async()=>{
  await db.pool.query(`CREATE DATABASE ${TARGET}`);
  const source=db.pool.options as {password?:string};
  production=new Pool({host:'127.0.0.1',port:db.identity.dbPort,user:db.identity.user,password:source.password,database:TARGET,max:4});
  // Unmodified migrations must still fail closed on a database that is not an owned local one.
  await assert.rejects(migrate(production),/Dedicated development|development DB required/);
  assert.equal(Number((await production.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE c.relkind='r' AND s.nspname='public'")).rows[0].n),0);
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
  // A disposable-looking or malformed target is refused outright.
  for(const bad of ['zr_0123456789ab','Zao','x','public schema'])assert.throws(()=>productionMigrationSql('0001','DO $$BEGIN END$$;',bad),/PRODUCTION_TARGET_INVALID/);
 });

 await check('the transformer fails closed when a source migration changes shape',async()=>{
  const guard="current_database() !~ '^zr_[a-f0-9]{12}$'";
  const block=(body:string)=>`DO $$BEGIN IF ${body} THEN RAISE EXCEPTION 'x';END IF;END$$;\n`;
  // A guarded migration that lost its guard, or grew a second one, is not silently accepted.
  assert.throws(()=>productionMigrationSql('0016',block('true'),TARGET),/PRODUCTION_GUARD_SHAPE_UNEXPECTED 0016 found=0 expected=1/);
  assert.throws(()=>productionMigrationSql('0016',block(guard)+block(guard),TARGET),/PRODUCTION_GUARD_SHAPE_UNEXPECTED 0016 found=2 expected=1/);
  // The subject expression is pinned per migration: 0015 guards a variable, 0016 a call.
  assert.throws(()=>productionMigrationSql('0016',block("n !~ '^zr_[a-f0-9]{12}$'"),TARGET),/PRODUCTION_GUARD_FRAGMENT_UNEXPECTED 0016/);
  // A guard that is not migration-time is refused rather than rewritten.
  assert.throws(()=>productionMigrationSql('0016',`CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ${guard} THEN RAISE EXCEPTION 'x';END IF;END$$;\n`,TARGET),/PRODUCTION_GUARD_NOT_MIGRATION_TIME 0016/);
  // An unguarded migration may not acquire one, and a runtime-guard count may not drift.
  assert.throws(()=>productionMigrationSql('0001',block(guard),TARGET),/PRODUCTION_GUARD_SHAPE_UNEXPECTED 0001 found=1 expected=0/);
  assert.throws(()=>productionMigrationSql('0029',block(guard),TARGET),/PRODUCTION_GUARD_SHAPE_UNEXPECTED 0029 found=1 expected=2/);
  // A well-formed guard is rewritten to the exact target and leaves no disposable-name predicate.
  const moved=productionMigrationSql('0016',block(guard),TARGET);
  assert.equal(moved.sql,block(`current_database() <> '${TARGET}'`));
  assert.equal(moved.guards,1);
  assert.equal(moved.transformed,true);
 });

 await check('every transformed migration carries dual provenance',async()=>{
  const plan=await bootstrapPlan(TARGET);planSha=plan.planSha256;
  assert.equal(plan.transformerVersion,TRANSFORMER_VERSION);
  assert.equal(plan.provenance.length,migrationPlan.length);
  const transformed=plan.provenance.filter(p=>p.transformation!=='NONE');
  assert.deepEqual(transformed.map(p=>p.id),GUARDED);
  for(const record of plan.provenance){
   assert.equal(record.canonicalSha256,digest(await file(migrationPlan.find(m=>m.id===record.id)!.file)));
   assert.equal(record.target,TARGET);
   if(record.transformation==='NONE')assert.equal(record.transformedSha256,record.canonicalSha256,record.id);
   else{assert.equal(record.transformation,TRANSFORMATION_CLASS);assert.notEqual(record.transformedSha256,record.canonicalSha256,record.id);}
  }
  // The plan hash is deterministic, target-bound, and carries nothing but identifiers and digests.
  assert.equal((await bootstrapPlan(TARGET)).planSha256,planSha);
  assert.notEqual((await bootstrapPlan('zao_rental_other_target')).planSha256,planSha);
  assert.match(JSON.stringify(plan.provenance),/^[A-Za-z0-9_@/{}[\]":,.-]+$/);
 });

 let canonical:Awaited<ReturnType<typeof schemaFingerprint>>|undefined;
 await check('STRUCTURAL_EQUIVALENCE: the two databases hold the same schema',async()=>{
  await migrate(db.pool);
  canonicalOwner=(await db.pool.query<{u:string}>('SELECT current_user u')).rows[0]!.u;
  canonical=await schemaFingerprint(db.pool);
  const result=await bootstrapProductionSchema(production!,TARGET);
  assert.equal(result.applied,migrationPlan.length);
  assert.equal(result.guardsRewritten,GUARD_MIGRATIONS);
  assert.equal(result.planSha256,planSha);
  assert.deepEqual(result.provenance.map(p=>p.id),GUARDED);
  const bootstrapped=await schemaFingerprint(production!);
  // Normalised: role names derived from the database name differ by construction.
  const expected=canonical!;
  for(const key of Object.keys(expected.material))assert.deepEqual(bootstrapped.material[key],expected.material[key],key);
  for(const key of Object.keys(expected.counts))assert.deepEqual(bootstrapped.counts[key],expected.counts[key],key);
  assert.equal(bootstrapped.sha256,expected.sha256);
  for(const kind of ['functions','triggers','constraints','tables','columns','indexes','views','types','schemas'])assert.ok((expected.counts[kind]??0)>0,kind);
 });

 await check('SECURITY_EQUIVALENCE: the same privileges, definer rights and ownership',async()=>{
  const canonicalSecurity=await securityFingerprint(db.pool),bootstrapped=await securityFingerprint(production!);
  for(const key of Object.keys(canonicalSecurity.material))assert.deepEqual(bootstrapped.material[key],canonicalSecurity.material[key],key);
  assert.equal(bootstrapped.sha256,canonicalSecurity.sha256);
  // The comparison is only meaningful if it actually observed the interesting objects.
  for(const kind of ['definerRoutines','tableOwners','schemaOwners','routineOwners','roleAttributes','derivedRoles','tableGrants','columnGrants','routineGrants','approvalRegistries','permissionRegistry'])
   assert.ok((canonicalSecurity.counts[kind]??0)>0,kind);
  // The custody executor is derived from the database name and must exist under the Production one.
  assert.ok(bootstrapped.material.derivedRoles!.includes('<ENVIRONMENT>_custody_executor'),JSON.stringify(bootstrapped.material.derivedRoles));
  // Every SECURITY DEFINER routine pins a search_path in both databases.
  for(const row of bootstrapped.material.definerRoutines!)assert.ok(row.includes('search_path='),row.slice(0,90));
  assert.equal(bootstrapped.material.definerRoutines!.some(r=>r.includes('NO_SEARCH_PATH')),false);
  // Only the cluster owner may hold escalation attributes or log in; no application role may.
  for(const row of bootstrapped.material.roleAttributes!){
   const role=row.split(' ')[0]!;
   if(role==='<ENVIRONMENT>'||role===canonicalOwner)continue;
   for(const attribute of ['super=true','createdb=true','createrole=true','replication=true','bypassrls=true','login=true'])
    assert.ok(!row.includes(attribute),role+' has '+attribute);
  }
  // No role this database uses may reach an escalation attribute through a membership either.
  const escalating=new Set(bootstrapped.material.roleAttributes!.filter(r=>/super=true|createrole=true|createdb=true|bypassrls=true/.test(r)).map(r=>r.split(' ')[0]!));
  for(const row of bootstrapped.material.roleMemberships!){
   const holder=row.split(' IN ')[1]!.split(' admin=')[0]!;
   assert.equal(escalating.has(holder),false,row);
  }
 });

 await check('Production carries no approvals, no development foundation rows and no R15 activation',async()=>{
  const rows=await approvalRegistryRows(production!);
  assert.deepEqual(rows,await approvalRegistryRows(db.pool));
  // A1 development foundation artifacts (foundation_metadata, telemetry_events) and A2 historical
  // R15 Sandbox activation artifacts exist but stay empty: 0030 belongs to the finite R15 Square
  // Sandbox acceptance and is never a Production activation mechanism.
  for(const row of rows)assert.equal(row.rows,mustBeEmpty(row.registry)?0:row.rows,row.registry);
  for(const registry of ['public.real_inventory_sources','public.real_data_acceptance','public.field_acceptance_records','public.foundation_metadata','public.telemetry_events','r15_activation.manifest','r15_activation.operations']){
   const row=rows.find(r=>r.registry===registry);
   assert.ok(row,registry);assert.equal(row!.rows,0,registry);
  }
  // The seeded permission defaults are present and identical, not silently dropped.
  assert.equal(rows.find(r=>r.registry==='public.staff_role_permissions')!.rows,7);
 });

 await check('the migration registry matches the canonical one exactly',async()=>{
  const local=(await db.pool.query('SELECT id,checksum FROM foundation_migrations ORDER BY id')).rows;
  const remote=(await production!.query('SELECT id,checksum FROM foundation_migrations ORDER BY id')).rows;
  assert.deepEqual(remote,local);
  assert.equal(remote.length,migrationPlan.length);
  assert.equal(remote.at(-1)!.id,migrationPlan.at(-1)!.id);
  // The recorded checksum is the canonical source file's, for every migration including rewritten ones.
  for(const row of remote as Array<{id:string;checksum:string}>)
   assert.equal(row.checksum,digest(await file(migrationPlan.find(m=>m.id===row.id)!.file)),row.id);
 });

 await check('running the canonical migrator afterwards is inert',async()=>{
  const before=await schemaFingerprint(production!);
  // Every migration is already recorded, so nothing is applied and no guard is reached.
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
  transformerVersion:TRANSFORMER_VERSION,planSha256:planSha,structuralEquivalence:'PASS',securityEquivalence:'PASS',
  schemaFingerprint:canonical!.sha256,productionDdl:0,hostedDb:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:(e as Error).message.slice(0,700)}));}
finally{if(production)await production.end().catch(()=>undefined);await db.stop();}
if(failed)process.exit(1);
