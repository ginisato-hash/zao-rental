// Phase B verification model: pre/post DELTA equivalence instead of absolute equality.
// A real Production owner (managed Neon) and a local cluster owner have different role postures,
// which the existing absolute securityFingerprint() correctly includes. This proves, on owned
// disposable PostgreSQL only, that a provider-shaped baseline cancels out of the before→after
// delta, that the bootstrap does not touch it, and that any application OR baseline change after
// bootstrap is still detected. No Production connection, credential or provider call.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {migrate} from '../../packages/db/src/index';
import {bootstrapProductionSchema,schemaFingerprint,securityFingerprint,fingerprintDelta,deltaMismatch,migrationOwnerPosture,environmentIdentifiers,tokenNormaliser,type Fingerprint} from '../../scripts/production-bootstrap';

const TARGET='zao_rental_provider_shaped',CANONICAL='zr_'+randomBytes(6).toString('hex');
const PARENT='synthetic_provider_parent',OWNER='synthetic_provider_owner',NEON_OWNER='synthetic_neon_shaped_owner',NEON_TARGET='zao_rental_neon_shaped';
let failed=false,stage='setup',count=0;const evidence:Record<string,unknown>={};
const db=await startIsolatedPostgres();const pools:Pool[]=[];
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const secret=()=>randomBytes(18).toString('hex');
const connect=(database:string,user:string,password:string)=>{const p=new Pool({host:'127.0.0.1',port:db.identity.dbPort,user,password,database,max:3});p.on('error',()=>{});pools.push(p);return p;};
const occupied=async(pool:Pool)=>Number((await pool.query(`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE c.relkind IN ('r','v','m') AND s.nspname NOT LIKE 'pg\\_%' AND s.nspname<>'information_schema'`)).rows[0].n);
/** Applies statements in one transaction, fingerprints inside it, then rolls back. */
async function mutated(pool:Pool,sql:string[],take:(c:PoolClient)=>Promise<Fingerprint>){
 const c=await pool.connect();try{await c.query('BEGIN');for(const s of sql)await c.query(s);return await take(c);}finally{await c.query('ROLLBACK').catch(()=>undefined);c.release();}
}
const mentions=(d:ReturnType<typeof fingerprintDelta>,token:string)=>Object.values(d.categories).some(c=>[...c.added,...c.removed].some(r=>r.includes(token)));
try{
 const superPassword=(db.pool.options as {password:string}).password,ownerPassword=secret();
 // Synthetic provider baseline, deliberately unlike the local cluster owner: a separate LOGIN
 // owner (superuser here so the canonical migrations can run) that is a member of a provider
 // parent role with its own attributes and a pg_ grant, plus a provider-only schema, routine and
 // PUBLIC grant inside the target. None of it is a table/view/materialized view.
 await db.pool.query(`CREATE ROLE ${PARENT} NOLOGIN CREATEDB CREATEROLE BYPASSRLS`);
 await db.pool.query(`GRANT pg_read_all_data TO ${PARENT}`);
 await db.pool.query(`CREATE ROLE ${OWNER} LOGIN SUPERUSER NOREPLICATION PASSWORD '${ownerPassword}'`);
 await db.pool.query(`GRANT ${PARENT} TO ${OWNER}`);
 await db.pool.query(`CREATE DATABASE ${TARGET} OWNER ${OWNER}`);
 await db.pool.query(`CREATE DATABASE ${CANONICAL}`);
 const production=connect(TARGET,OWNER,ownerPassword),canonical=connect(CANONICAL,db.identity.user,superPassword);
 await production.query('CREATE SCHEMA synthetic_provider');
 await production.query('GRANT USAGE ON SCHEMA synthetic_provider TO PUBLIC');
 await production.query("CREATE FUNCTION synthetic_provider.version() RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT 'synthetic'$$");
 assert.equal(await occupied(production),0);

 const posture=await migrationOwnerPosture(production);evidence.ownerPosture=posture;
 const cS0=await schemaFingerprint(canonical),cX0=await securityFingerprint(canonical),pS0=await schemaFingerprint(production),pX0=await securityFingerprint(production);
 await migrate(canonical);
 const result=await bootstrapProductionSchema(production,TARGET);
 const cS1=await schemaFingerprint(canonical),cX1=await securityFingerprint(canonical),pS1=await schemaFingerprint(production),pX1=await securityFingerprint(production);
 const canonicalSchemaDelta=fingerprintDelta(cS0,cS1),canonicalSecurityDelta=fingerprintDelta(cX0,cX1),productionSchemaDelta=fingerprintDelta(pS0,pS1),productionSecurityDelta=fingerprintDelta(pX0,pX1);

 await check('owner posture is recorded as separate evidence, not compared with the local owner',async()=>{
  assert.equal(posture.database,TARGET);assert.equal(posture.role,OWNER);assert.equal(posture.databaseOwner,OWNER);
  assert.ok(posture.memberships.includes(`${OWNER} IN ${PARENT} admin=false inherit=true set=true`),JSON.stringify(posture.memberships));
  assert.ok(posture.memberships.some(m=>m.startsWith(`${PARENT} IN pg_read_all_data`)),JSON.stringify(posture.memberships));
 });
 await check('D1 provider baseline: absolute fingerprints differ before AND after, as expected',async()=>{
  assert.notEqual(cX0.sha256,pX0.sha256);assert.notEqual(cS0.sha256,pS0.sha256);
  assert.notEqual(cX1.sha256,pX1.sha256);assert.notEqual(cS1.sha256,pS1.sha256);
  assert.ok(pX0.material.roleMemberships!.some(r=>r.includes(PARENT)));assert.ok(!cX0.material.roleMemberships!.some(r=>r.includes(PARENT)));
  // The pre-bootstrap security fingerprint is computable on an empty database (registry absent).
  assert.deepEqual(pX0.material.permissionRegistry,[]);assert.ok(pX1.material.permissionRegistry!.length>0);
  assert.equal(result.applied,50);
 });
 await check('D2 delta equivalence: schema and security deltas are identical despite the baseline',async()=>{
  assert.deepEqual(deltaMismatch(canonicalSchemaDelta,productionSchemaDelta),[]);assert.equal(productionSchemaDelta.sha256,canonicalSchemaDelta.sha256);
  assert.deepEqual(deltaMismatch(canonicalSecurityDelta,productionSecurityDelta),[]);assert.equal(productionSecurityDelta.sha256,canonicalSecurityDelta.sha256);
  assert.deepEqual(Object.keys(productionSchemaDelta.categories).sort(),Object.keys(pS1.material).sort());
  assert.deepEqual(Object.keys(productionSecurityDelta.categories).sort(),Object.keys(pX1.material).sort());
  for(const k of ['functions','triggers','constraints','tables','columns','indexes','views','types','schemas'])assert.ok(productionSchemaDelta.categories[k]!.added.length>0,k);
  for(const k of ['definerRoutines','tableOwners','routineOwners','roleAttributes','derivedRoles','tableGrants','routineGrants','schemaGrants','approvalRegistries','permissionRegistry'])assert.ok(productionSecurityDelta.categories[k]!.added.length>0,k);
  evidence.schemaDeltaSha256=productionSchemaDelta.sha256;evidence.securityDeltaSha256=productionSecurityDelta.sha256;
 });
 await check('D3 provider baseline preserved: bootstrap changed nothing that belongs to it',async()=>{
  for(const d of [productionSchemaDelta,productionSecurityDelta]){assert.equal(mentions(d,'synthetic_provider'),false);assert.equal(mentions(d,PARENT),false);}
  for(const [before,after] of [[pS0,pS1],[pX0,pX1]] as const)for(const k of Object.keys(before.material))
   assert.deepEqual(after.material[k]!.filter(r=>r.includes('synthetic_provider')),before.material[k]!.filter(r=>r.includes('synthetic_provider')),k);
  assert.equal((await production.query("SELECT synthetic_provider.version() v")).rows[0].v,'synthetic');
 });
 await check('D4 an injected application privilege change after bootstrap fails delta equivalence',async()=>{
  for(const [sql,category] of [
   [['GRANT SELECT ON rental_bookings TO PUBLIC'],'publicTableGrants'],
   [[`GRANT ${TARGET}_custody_executor TO ${PARENT}`],'roleMemberships'],
   [[`GRANT UPDATE ON staff_role_permissions TO ${TARGET}_custody_executor`],'tableGrants'],
  ] as const){
   const delta=fingerprintDelta(pX0,await mutated(production,[...sql],c=>securityFingerprint(c)));
   assert.ok(deltaMismatch(canonicalSecurityDelta,delta).includes(category),sql[0]);
  }
  assert.equal(fingerprintDelta(pX0,await securityFingerprint(production)).sha256,canonicalSecurityDelta.sha256);
 });
 await check('D5 a provider baseline change after bootstrap is still visible and fails',async()=>{
  for(const [sql,category] of [
   [[`ALTER ROLE ${PARENT} NOCREATEDB`],'roleAttributes'],
   [[`REVOKE ${PARENT} FROM ${OWNER}`],'roleMemberships'],
   [['REVOKE USAGE ON SCHEMA synthetic_provider FROM PUBLIC'],'schemaGrants'],
  ] as const){
   const delta=fingerprintDelta(pX0,await mutated(production,[...sql],c=>securityFingerprint(c)));
   assert.ok(deltaMismatch(canonicalSecurityDelta,delta).includes(category),sql[0]);assert.ok(mentions(delta,PARENT)||mentions(delta,'synthetic_provider'),sql[0]);
  }
  const schemaChange=fingerprintDelta(pS0,await mutated(production,['DROP FUNCTION synthetic_provider.version()'],c=>schemaFingerprint(c)));
  assert.ok(deltaMismatch(canonicalSchemaDelta,schemaChange).includes('functions'));
  assert.equal(fingerprintDelta(pX0,await securityFingerprint(production)).sha256,canonicalSecurityDelta.sha256);
 });
 await check('D6 the existing empty gate is unchanged: a table, view or materialized view refuses bootstrap',async()=>{
  for(const [n,ddl] of [['table','CREATE TABLE occupied(id int)'],['view','CREATE VIEW occupied AS SELECT 1 AS id'],['matview','CREATE MATERIALIZED VIEW occupied AS SELECT 1 AS id']] as const){
   const name='zao_rental_nonempty_'+n;await db.pool.query(`CREATE DATABASE ${name}`);
   const p=connect(name,db.identity.user,superPassword);await p.query(ddl);
   await assert.rejects(bootstrapProductionSchema(p,name),/PRODUCTION_DATABASE_NOT_EMPTY/);
   assert.equal((await p.query("SELECT to_regclass('foundation_migrations') IS NULL absent")).rows[0].absent,true);
  }
 });
 await check('Neon-shaped non-superuser owner (createrole_self_grant empty): bootstrap commits with exact delta equivalence',async()=>{
  const password=secret();
  await db.pool.query(`CREATE ROLE ${NEON_OWNER} LOGIN NOSUPERUSER CREATEDB CREATEROLE INHERIT PASSWORD '${password}'`);
  await db.pool.query(`GRANT ${PARENT} TO ${NEON_OWNER}`);
  await db.pool.query(`CREATE DATABASE ${NEON_TARGET} OWNER ${NEON_OWNER}`);
  const neon=connect(NEON_TARGET,NEON_OWNER,password),before=await securityFingerprint(neon),schemaBefore=await schemaFingerprint(neon);
  assert.equal((await neon.query("SELECT current_setting('createrole_self_grant') v")).rows[0].v,'');
  const r=await bootstrapProductionSchema(neon,NEON_TARGET);
  assert.equal(r.applied,50);assert.equal(r.guardsRewritten,12);
  assert.deepEqual(deltaMismatch(canonicalSchemaDelta,fingerprintDelta(schemaBefore,await schemaFingerprint(neon))),[]);
  assert.deepEqual(deltaMismatch(canonicalSecurityDelta,fingerprintDelta(before,await securityFingerprint(neon))),[]);
  evidence.neonShapedOwner={bootstrap:'COMMITTED',deltaMismatch:[]};
 });
 await check('Neon-named owner (neondb / neondb_owner): identifiers do not collide and bootstrap commits with exact delta equivalence',async()=>{
  // R0.6 on real Neon stopped here: the owner name carries the database prefix.
  const password=secret(),foreign=['neondb2_custody','otherdb_custody'];
  await db.pool.query(`CREATE ROLE neondb_owner LOGIN NOSUPERUSER CREATEDB CREATEROLE INHERIT PASSWORD '${password}'`);
  await db.pool.query(`GRANT ${PARENT} TO neondb_owner`);
  for(const r of foreign)await db.pool.query(`CREATE ROLE ${r} NOLOGIN`);
  await db.pool.query('CREATE DATABASE neondb OWNER neondb_owner');
  const neon=connect('neondb','neondb_owner',password);
  assert.deepEqual([...await environmentIdentifiers(neon)].sort(),[['neondb','<DATABASE>'],['neondb_owner','<MIGRATION_OWNER>']]);
  const schemaBefore=await schemaFingerprint(neon),before=await securityFingerprint(neon);
  const r=await bootstrapProductionSchema(neon,'neondb');
  assert.equal(r.applied,50);assert.equal(r.guardsRewritten,12);
  const map=await environmentIdentifiers(neon);
  assert.deepEqual([...map].sort(),[['neondb','<DATABASE>'],['neondb_custody','<DATABASE>_custody'],
   ['neondb_custody_executor','<DATABASE>_custody_executor'],['neondb_owner','<MIGRATION_OWNER>']]);
  for(const f of foreign){assert.equal(map.has(f),false,f);assert.equal(tokenNormaliser(map)(f),f);}
  const schemaAfter=await schemaFingerprint(neon),after=await securityFingerprint(neon);
  assert.deepEqual(deltaMismatch(canonicalSchemaDelta,fingerprintDelta(schemaBefore,schemaAfter)),[]);
  assert.deepEqual(deltaMismatch(canonicalSecurityDelta,fingerprintDelta(before,after)),[]);
  evidence.neonNamedOwner={bootstrap:'COMMITTED',identifiers:map.size,deltaMismatch:[]};
 });
 console.log(JSON.stringify({status:'PASS',cases:count,productionConnections:0,...evidence}));
}catch(e){
 failed=true;
 console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:e instanceof assert.AssertionError?e.message.slice(0,2000):'SAFE_DETAILS_ONLY'}));
 console.error((e as Error).stack?.split('\n').filter(l=>l.includes('/tests/operations/production-bootstrap-delta')).join('\n'));
}finally{for(const p of pools)await p.end().catch(()=>{});await db.stop();}
if(failed)process.exit(1);
