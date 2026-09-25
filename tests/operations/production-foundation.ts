// PROD-R0.7-C: the integrated Production foundation bootstrap (schema + operational roles) on owned
// disposable PostgreSQL only. The database and owner are named exactly as on Neon (neondb /
// neondb_owner): LOGIN NOSUPERUSER CREATEDB CREATEROLE INHERIT, a member of a provider parent that
// holds pg_read_all_data WITH ADMIN OPTION (as neon_superuser does), createrole_self_grant=''.
// No Production connection, credential or provider call.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {trackPoolLifecycle} from '../../scripts/pool-lifecycle';
import {migrate} from '../../packages/db/src/index';
import {bootstrapProductionFoundation,runFoundationPlan,productionFoundationPlan,schemaFingerprint,securityFingerprint,fingerprintDelta,deltaMismatch,
 FOUNDATION_FAULT_STAGES,type FoundationPlan} from '../../scripts/production-bootstrap';

const DB='neondb',OWNER='neondb_owner';
const CUSTODY_FUNCTIONS=['rental_apply_receipt(uuid)','rental_apply_inspection(uuid)','rental_complete_no_pickup(uuid)','ops_checkout_amendment(uuid)','ops_reconcile_poles(uuid,uuid,integer)'];
let failed=false,stage='setup',count=0;const evidence:Record<string,unknown>={};
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
/** Owned clusters in start order; each closes its pools (actual disconnect) before its server stops. */
const clusters:Array<{closers:Array<()=>Promise<void>>;db:Awaited<ReturnType<typeof startIsolatedPostgres>>;stopped:boolean}>=[];
async function stopCluster(x:typeof clusters[number]){if(x.stopped)return;x.stopped=true;let failure:unknown;for(const close of x.closers){try{await close();}catch(e){failure??=e;}}try{await x.db.stop();}catch(e){failure??=e;}if(failure)throw failure;}
const scalar=async(pool:Pool,sql:string,params:unknown[]=[])=>Object.values((await pool.query(sql,params)).rows[0] as Record<string,unknown>)[0];
const occupied=(pool:Pool)=>scalar(pool,`SELECT count(*)::int FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE c.relkind IN ('r','v','m') AND s.nspname NOT LIKE 'pg\\_%' AND s.nspname<>'information_schema'`);

/** One Neon-shaped cluster: provider parent, owner, neondb and a superuser-owned canonical zr_ database. */
async function neonShapedCluster(parent:string,providerBaseline:(owner:Pool)=>Promise<void>){
 const db=await startIsolatedPostgres(),owned={closers:[] as Array<()=>Promise<void>>,db,stopped:false};clusters.push(owned);
 const superPassword=(db.pool.options as {password:string}).password,ownerPassword=randomBytes(18).toString('hex');
 const connect=(database:string,user:string,password:string)=>{const p=new Pool({host:'127.0.0.1',port:db.identity.dbPort,user,password,database,max:3});owned.closers.push(trackPoolLifecycle(p));return p;};
 await db.pool.query(`CREATE ROLE ${parent} NOLOGIN CREATEDB CREATEROLE BYPASSRLS`);
 await db.pool.query(`GRANT pg_read_all_data,pg_write_all_data TO ${parent} WITH ADMIN OPTION`);
 await db.pool.query(`CREATE ROLE ${OWNER} LOGIN NOSUPERUSER CREATEDB CREATEROLE INHERIT PASSWORD '${ownerPassword}'`);
 await db.pool.query(`GRANT ${parent} TO ${OWNER}`);
 await db.pool.query(`CREATE DATABASE ${DB} OWNER ${OWNER}`);
 const canonicalName='zr_'+randomBytes(6).toString('hex');await db.pool.query(`CREATE DATABASE ${canonicalName}`);
 const neon=connect(DB,OWNER,ownerPassword),canonical=connect(canonicalName,db.identity.user,superPassword);
 await providerBaseline(neon);
 assert.equal(await scalar(neon,"SELECT current_setting('createrole_self_grant')"),'');
 return {neon,canonical,stop:()=>stopCluster(owned)};
}
async function assertEmpty(pool:Pool,plan:FoundationPlan){
 assert.equal(await occupied(pool),0);
 assert.equal(await scalar(pool,"SELECT to_regclass('foundation_migrations') IS NULL"),true);
 assert.equal(await scalar(pool,'SELECT count(*)::int FROM pg_roles WHERE rolname=ANY($1)',[[plan.roles.managerRole,...plan.roles.operationalRoleNames]]),0);
 assert.equal(await scalar(pool,"SELECT count(*)::int FROM pg_roles WHERE rolname LIKE 'zao\\_boot\\_%' OR rolname IN ('neondb_custody','neondb_custody_executor')"),0);
}
const withRoles=(plan:FoundationPlan,roles:Partial<FoundationPlan['roles']>):FoundationPlan=>({...plan,roles:{...plan.roles,...roles}});
try{
 const plan=await productionFoundationPlan(DB);
 const a=await neonShapedCluster('synthetic_neon_superuser',async()=>{});

 await check('fault injection at every stage rolls back to an empty database with no new role',async()=>{
  for(const at of FOUNDATION_FAULT_STAGES){
   await assert.rejects(runFoundationPlan(a.neon,plan,{failAt:at}),new RegExp('PRODUCTION_FOUNDATION_INJECTED_FAULT '+at));
   await assertEmpty(a.neon,plan);
  }
  evidence.faultStages=[...FOUNDATION_FAULT_STAGES];
 });
 await check('M1 operational roles created directly by the owner fail the owner-membership proof and roll back',async()=>{
  await assert.rejects(runFoundationPlan(a.neon,withRoles(plan,{enterManagerSql:[]})),/PRODUCTION_ROLE_TOPOLOGY_PROOF_FAILED .*owner_direct_operational/);
  await assertEmpty(a.neon,plan);
 });
 await check('M2 the custody-owned grant issued under OWNER authority fails and rolls back',async()=>{
  const m2=withRoles(plan,{ownerGrantStatements:[...plan.roles.ownerGrantStatements,...plan.roles.custodyExecutorGrantStatements],custodyExecutorGrantStatements:[]});
  const error=await runFoundationPlan(a.neon,m2).then(()=>null,(e:Error&{code?:string})=>e);
  assert.ok(error,'M2 committed');assert.match(error!.message,/PRODUCTION_ROLE_GRANT_AUTHORITY_VIOLATION|permission denied/);
  evidence.m2Failure=error!.message.split(' ')[0]+(error!.code?' '+error!.code:'');
  await assertEmpty(a.neon,plan);
 });
 await check('M3 without SET on the manager the manager-administration proof fails and rolls back',async()=>{
  await assert.rejects(runFoundationPlan(a.neon,withRoles(plan,{ownerManagerMembershipSql:[]})),/PRODUCTION_ROLE_MANAGER_ADMINISTRATION_PROOF_FAILED/);
  await assertEmpty(a.neon,plan);
 });

 const aS0=await schemaFingerprint(a.neon),aX0=await securityFingerprint(a.neon),cS0=await schemaFingerprint(a.canonical);
 const result=await bootstrapProductionFoundation(a.neon,DB);
 await migrate(a.canonical);
 const aS1=await schemaFingerprint(a.neon),aX1=await securityFingerprint(a.neon),cS1=await schemaFingerprint(a.canonical);
 const foundationSecurityDelta=fingerprintDelta(aX0,aX1);

 await check('bootstrapProductionFoundation commits 50 migrations and the 17 operational roles under the manager',async()=>{
  assert.equal(result.applied,50);assert.equal(result.guardsRewritten,12);assert.equal(result.planSha256,plan.bootstrap.planSha256);
  assert.equal(result.foundationPlanSha256,plan.foundationPlanSha256);assert.equal(result.roleProvisioning.planSha256,plan.roles.planSha256);
  assert.deepEqual([result.roleProvisioning.operationalRoles,result.roleProvisioning.ownerGrantStatements,result.roleProvisioning.custodyExecutorGrantStatements],[17,145,1]);
  const q=async(sql:string,params:unknown[]=[])=>scalar(a.neon,sql,params);
  const all=[plan.roles.managerRole,...plan.roles.operationalRoleNames];
  const facts={
   migrations:await q('SELECT count(*)::int FROM foundation_migrations'),
   manager:await q(`SELECT count(*)::int FROM pg_roles WHERE rolname=$1`,[plan.roles.managerRole]),
   operational:await q('SELECT count(*)::int FROM pg_roles WHERE rolname=ANY($1)',[plan.roles.operationalRoleNames]),
   loginRoles:await q('SELECT count(*)::int FROM pg_roles WHERE rolname=ANY($1) AND rolcanlogin',[all]),
   ownerDirectOperational:await q('SELECT count(*)::int FROM pg_auth_members WHERE member=$1::regrole AND roleid IN (SELECT oid FROM pg_roles WHERE rolname=ANY($2))',[OWNER,plan.roles.operationalRoleNames]),
   managerOperationalAdmin:await q('SELECT count(*)::int FROM pg_auth_members WHERE member=$1::regrole AND admin_option AND NOT inherit_option AND NOT set_option AND roleid IN (SELECT oid FROM pg_roles WHERE rolname=ANY($2))',[plan.roles.managerRole,plan.roles.operationalRoleNames]),
   managerCustody:await q(`SELECT count(*)::int FROM pg_auth_members WHERE member=$1::regrole AND roleid IN ('neondb_custody'::regrole,'neondb_custody_executor'::regrole)`,[plan.roles.managerRole]),
   custodyRoles:await q(`SELECT count(*)::int FROM pg_roles WHERE rolname IN ('neondb_custody','neondb_custody_executor')`),
   ownerCustody:await q(`SELECT count(*)::int FROM pg_auth_members WHERE member=$1::regrole AND roleid IN ('neondb_custody'::regrole,'neondb_custody_executor'::regrole)`,[OWNER]),
   operationsCustodyExecute:await q(`SELECT count(*)::int FROM unnest($1::text[]) f WHERE has_function_privilege('neondb_operations',to_regprocedure(f),'EXECUTE')`,[CUSTODY_FUNCTIONS]),
   zaoBoot:await q("SELECT count(*)::int FROM pg_roles WHERE rolname LIKE 'zao\\_boot\\_%'"),
   executorDatabaseCreate:await q(`SELECT has_database_privilege('neondb_custody_executor','neondb','CREATE')`),
   executorPublicCreate:await q(`SELECT has_schema_privilege('neondb_custody_executor','public','CREATE')`),
  };
  assert.deepEqual(facts,{migrations:50,manager:1,operational:17,loginRoles:0,ownerDirectOperational:0,managerOperationalAdmin:17,managerCustody:0,custodyRoles:2,ownerCustody:0,
   operationsCustodyExecute:5,zaoBoot:0,executorDatabaseCreate:false,executorPublicCreate:false});
  const ownerManager=(await a.neon.query(`SELECT bool_or(admin_option) admin,bool_or(set_option) "set",bool_or(inherit_option) inherit FROM pg_auth_members WHERE member=$1::regrole AND roleid=$2::regrole`,[OWNER,plan.roles.managerRole])).rows[0];
  assert.deepEqual(ownerManager,{admin:true,set:true,inherit:false});
  evidence.local=facts;
 });
 await check('schema delta equals the canonical migrate() delta: role provisioning adds no schema object',async()=>{
  const canonicalDelta=fingerprintDelta(cS0,cS1),foundationDelta=fingerprintDelta(aS0,aS1);
  assert.deepEqual(deltaMismatch(canonicalDelta,foundationDelta),[]);assert.equal(foundationDelta.sha256,canonicalDelta.sha256);
  evidence.schemaDeltaSha256=foundationDelta.sha256;
 });
 await check('the committed manager can switch LOGIN on and off for operational roles; nothing persists',async()=>{
  const c=await a.neon.connect();
  try{
   await c.query('BEGIN');await c.query(`SET LOCAL ROLE ${plan.roles.managerRole}`);
   for(const role of ['neondb_operations','neondb_pay_receipt']){await c.query(`ALTER ROLE ${role} LOGIN`);await c.query(`ALTER ROLE ${role} NOLOGIN`);}
   await c.query(`ALTER ROLE neondb_operations PASSWORD '${randomBytes(12).toString('hex')}'`);
  }finally{await c.query('ROLLBACK');c.release();}
  assert.equal(await scalar(a.neon,`SELECT count(*)::int FROM pg_roles WHERE rolname IN ('neondb_operations','neondb_pay_receipt') AND rolcanlogin`),0);
 });
 await check('a second foundation bootstrap is refused on the non-empty database',async()=>{
  await assert.rejects(bootstrapProductionFoundation(a.neon,DB),/PRODUCTION_DATABASE_NOT_EMPTY/);
 });
 await check('FOUNDATION_SECURITY_DELTA is identical on a different provider-shaped baseline',async()=>{
  // One owned cluster per worktree port: A's deltas are already computed, so A stops first.
  await a.stop();
  const b=await neonShapedCluster('synthetic_provider_admin',async owner=>{
   await owner.query('CREATE SCHEMA synthetic_provider');await owner.query('GRANT USAGE ON SCHEMA synthetic_provider TO PUBLIC');
   await owner.query("CREATE FUNCTION synthetic_provider.version() RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT 'synthetic'$$");
  });
  const bX0=await securityFingerprint(b.neon),bS0=await schemaFingerprint(b.neon);
  assert.notEqual(bX0.sha256,aX0.sha256,'the two baselines are meant to differ');
  assert.notEqual(bS0.sha256,aS0.sha256,'the two baselines are meant to differ');
  await bootstrapProductionFoundation(b.neon,DB);
  const bDelta=fingerprintDelta(bX0,await securityFingerprint(b.neon));
  assert.deepEqual(deltaMismatch(foundationSecurityDelta,bDelta),[]);assert.equal(bDelta.sha256,foundationSecurityDelta.sha256);
  assert.equal(fingerprintDelta(bS0,await schemaFingerprint(b.neon)).sha256,fingerprintDelta(aS0,aS1).sha256);
  await b.stop();
  for(const k of ['derivedRoles','roleMemberships','roleAttributes','tableGrants','routineGrants','schemaGrants'])assert.ok(foundationSecurityDelta.categories[k]!.added.length>0,k);
  evidence.foundationSecurityDeltaSha256=foundationSecurityDelta.sha256;
 });
 console.log(JSON.stringify({status:'PASS',cases:count,productionConnections:0,foundationPlanSha256:plan.foundationPlanSha256,roleProvisioningPlanSha256:plan.roles.planSha256,...evidence}));
}catch(e){
 failed=true;
 console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:e instanceof assert.AssertionError?e.message.slice(0,2000):(e as Error).message.slice(0,400)}));
 console.error((e as Error).stack?.split('\n').filter(l=>l.includes('/tests/operations/production-foundation')||l.includes('/scripts/production-')).join('\n'));
}finally{
 let cleanupFailure:unknown;
 for(const x of clusters){try{await stopCluster(x);}catch(e){cleanupFailure??=e;}}
 if(cleanupFailure&&!failed)throw cleanupFailure;
}
if(failed)process.exit(1);
