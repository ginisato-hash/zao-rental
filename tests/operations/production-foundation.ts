// PROD-R0.7-C: the integrated Production foundation bootstrap (schema + operational roles) on owned
// disposable PostgreSQL only. The database and owner are named exactly as on Neon (neondb /
// neondb_owner): LOGIN NOSUPERUSER CREATEDB CREATEROLE INHERIT, a member of a provider parent that
// holds pg_read_all_data WITH ADMIN OPTION (as neon_superuser does), createrole_self_grant=''.
// No Production connection, credential or provider call.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Client,Pool} from 'pg';
import {fingerprintHost} from '../../scripts/production-backup';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {trackPoolLifecycle} from '../../scripts/pool-lifecycle';
import {migrate} from '../../packages/db/src/index';
import {productionCredentialTemporaryPasswordSql,productionCredentialRollbackSql,productionCredentialTemporaryPassword,productionCredentialBaseline,productionCredentialContainmentComplete} from '../../scripts/production-credential-activation';
import * as backupCredential from '../../scripts/production-backup-credential';
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

 await check('bootstrapProductionFoundation commits 53 migrations and the 17 operational roles under the manager',async()=>{
  assert.equal(result.applied,55);assert.equal(result.guardsRewritten,12);assert.equal(result.planSha256,plan.bootstrap.planSha256);
  assert.equal(result.foundationPlanSha256,plan.foundationPlanSha256);assert.equal(result.roleProvisioning.planSha256,plan.roles.planSha256);
  assert.deepEqual([result.roleProvisioning.operationalRoles,result.roleProvisioning.ownerGrantStatements,result.roleProvisioning.custodyExecutorGrantStatements],[17,150,1]);
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
  assert.deepEqual(facts,{migrations:55,manager:1,operational:17,loginRoles:0,ownerDirectOperational:0,managerOperationalAdmin:17,managerCustody:0,custodyRoles:2,ownerCustody:0,
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
 await check('credential contract v5: STALE_LEASE is repaired only by containment to READY_NORMALIZED before the NOLOGIN temporary bootstrap; containment stays READY_NORMALIZED when repeated',async()=>{
  // Exact contract SQL (manager SET included) against this disposable Neon-shaped neondb; pg_authid is read through the superuser pool.
  const role='neondb_content_read';
  const tx=async(sql:string[])=>{const c=await a.neon.connect();try{await c.query('BEGIN');for(const s of sql)await c.query(s);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
  const state=async()=>(await a.canonical.query(`SELECT r.rolcanlogin,a.rolpassword IS NULL AS "passwordIsNull",CASE WHEN isfinite(r.rolvaliduntil) THEN (r.rolvaliduntil AT TIME ZONE 'UTC')::text||'+00' ELSE r.rolvaliduntil::text END AS rolvaliduntil FROM pg_roles r JOIN pg_authid a ON a.oid=r.oid WHERE r.rolname=$1`,[role])).rows[0];
  const normalized={rolcanlogin:false,passwordIsNull:true,rolvaliduntil:'infinity'};
  assert.deepEqual(await state(),{rolcanlogin:false,passwordIsNull:true,rolvaliduntil:null});assert.equal(productionCredentialBaseline(await state()),'READY_PRISTINE');
  await a.canonical.query(`ALTER ROLE ${role} NOLOGIN PASSWORD NULL VALID UNTIL '2026-09-28 13:32:16.818847+00'`);
  assert.deepEqual(await state(),{rolcanlogin:false,passwordIsNull:true,rolvaliduntil:'2026-09-28 13:32:16.818847+00'});assert.equal(productionCredentialBaseline(await state()),'STALE_LEASE');
  assert.equal(productionCredentialContainmentComplete(await state()),false,'LOGIN false with a finite lease is not contained');
  await tx(productionCredentialRollbackSql(DB,'content_read'));
  assert.deepEqual(await state(),normalized);assert.equal(productionCredentialBaseline(await state()),'READY_NORMALIZED');assert.equal(productionCredentialContainmentComplete(await state()),true);
  await tx(productionCredentialTemporaryPasswordSql(DB,'content_read',productionCredentialTemporaryPassword()));
  assert.deepEqual(await state(),{rolcanlogin:false,passwordIsNull:false,rolvaliduntil:'infinity'});assert.equal(productionCredentialContainmentComplete(await state()),false,'a present password is not contained');
  for(let n=0;n<2;n++){
   await tx(productionCredentialRollbackSql(DB,'content_read'));
   assert.deepEqual(await state(),normalized);assert.equal(productionCredentialBaseline(await state()),'READY_NORMALIZED');assert.equal(productionCredentialContainmentComplete(await state()),true);
  }
 });
 await check('backup role lifecycle (production-backup-credential) on the real foundation role: provision, finalize, contain and the unknown-reset path',async()=>{
  const T=backupCredential.BACKUP_CREDENTIAL_TARGET,HOST='ep-synthetic-0000.us-east-2.aws.neon.tech',AGE='age1'+'q'.repeat(58),OP='3f2b8c1e-9d4a-4e1b-8c7d-0a1b2c3d4e5f';
  const port=(a.neon.options as {port:number}).port;
  const sunk:Record<string,string>={},vars:Record<string,string>={PRODUCTION_BACKUP_BUCKET:backupCredential.BACKUP_BUCKET,AGE_BACKUP_RECIPIENT:AGE};
  const secrets=new Set<string>(backupCredential.BACKUP_OWNER_SECRETS);
  let claimed=false,posts=0,resetFails=false;
  const ports:backupCredential.BackupCredentialPorts={
   neon:{
    async get(path){
     if(path===`/projects/${T.project}`)return {project:{id:T.project,history_retention_seconds:21600}};
     if(path===`/projects/${T.project}/branches/${T.branch}`)return {branch:{id:T.branch}};
     if(path.endsWith('/databases/'+T.database))return {database:{name:T.database,owner_name:T.owner}};
     if(path.endsWith('/roles'))return {roles:[{name:T.role},{name:T.manager},{name:T.owner}]};
     if(path.endsWith('/endpoints'))return {endpoints:[{id:'ep-synthetic-0000',type:'read_write',branch_id:T.branch,host:HOST}]};
     if(path.endsWith('/connection_uri'))return {uri:(()=>{const u=new URL('postgresql://placeholder/');u.hostname=HOST;u.username=T.owner;u.password='synthetic';u.pathname='/'+T.database;return u.toString();})()};
     if(path.includes('/operations/'))return {operation:{id:OP,status:'finished'}};
     throw new Error('unexpected GET '+path);
    },
    async post(path){
     assert.equal(path,backupCredential.backupResetPath());posts++;
     if(resetFails)throw new Error('socket hang up');
     const password=randomBytes(24).toString('base64url');
     await a.canonical.query(`ALTER ROLE ${T.role} PASSWORD '${password}'`); // what Neon's reset_password does to the role
     return {role:{name:T.role,password},operations:[{id:OP,status:'running'}]};
    },
   },
   github:{
    async secretNames(){return [...secrets];},async variables(){return {...vars};},
    async setSecret(n,v){secrets.add(n);sunk[n]=v;},async setVariable(n,v){vars[n]=v;},
    async deleteSecret(n){secrets.delete(n);delete sunk[n];},async deleteVariable(n){delete vars[n];},
   },
   async connectOwner(){const c=await a.neon.connect();return {query:((sql:string,p?:unknown[])=>c.query(sql,p)) as never,end:async()=>c.release()};},
   async connectBackup(cfg){const c=new Client({host:'127.0.0.1',port,user:cfg.user,password:cfg.password,database:cfg.database});await c.connect();return {query:((sql:string,p?:unknown[])=>c.query(sql,p)) as never,end:()=>c.end()};},
   guard:{exists:()=>claimed,claim:()=>{if(claimed)throw new Error('BACKUP_CREDENTIAL_RESET_ALREADY_ATTEMPTED');claimed=true;}},
   async sleep(){},now:()=>new Date(),expectTls:false,containmentSchedule:[0,0],expectedHostFingerprint:fingerprintHost(HOST),
  };
  const state=async()=>(await a.canonical.query(`SELECT r.rolcanlogin,a.rolpassword IS NULL AS "passwordIsNull",CASE WHEN isfinite(r.rolvaliduntil) THEN 'finite' ELSE r.rolvaliduntil::text END AS "validUntil",
   extract(epoch FROM (r.rolvaliduntil-clock_timestamp()))/60 AS minutes FROM pg_roles r JOIN pg_authid a ON a.oid=r.oid WHERE r.rolname=$1`,[T.role])).rows[0] as {rolcanlogin:boolean;passwordIsNull:boolean;validUntil:string;minutes:number};
  const login=async(password:string)=>{const c=new Client({host:'127.0.0.1',port,user:T.role,password,database:T.database});await c.connect();try{return (await c.query('SELECT current_user AS u')).rows[0].u as string;}finally{await c.end();}};
  const pristine=await state();assert.deepEqual([pristine.rolcanlogin,pristine.passwordIsNull,pristine.validUntil],[false,true,null]);
  // provision: exactly one provider reset, LOGIN with a database-clock lease that covers the 30-minute workflow, password only in the stdin sink
  const ev=await backupCredential.provisionBackupCredential(ports);
  assert.equal(ev.state,'PROVISIONED');assert.equal(posts,1);assert.equal(ev.passwordReadback,'READABLE','the Neon-shaped owner reads pg_authid through the provider parent\'s pg_read_all_data');
  const leased=await state();assert.equal(leased.rolcanlogin,true);assert.equal(leased.validUntil,'finite');assert.ok(leased.minutes>85&&leased.minutes<=90.1,String(leased.minutes));
  assert.equal(await login(sunk[backupCredential.BACKUP_SINKS.password]!),T.role);
  assert.deepEqual(Object.keys(sunk).sort(),Object.values(backupCredential.BACKUP_SINKS).sort());assert.equal(vars.PRODUCTION_BACKUP_ACTIVATION,'R4_APPROVED');
  await assert.rejects(backupCredential.provisionBackupCredential(ports),/BACKUP_CREDENTIAL_RESET_ALREADY_ATTEMPTED/);assert.equal(posts,1);
  // finalize only with the restore PASS record, then steady state: LOGIN, VALID UNTIL infinity, the same password still works
  await assert.rejects(backupCredential.finalizeBackupCredential(ports,{result:'PASS'}),/BACKUP_CREDENTIAL_RESTORE_PASS_REQUIRED/);
  await backupCredential.finalizeBackupCredential(ports,{result:'PASS',objectKey:'hourly/2026/10/04/2026-10-04T16:10:00.000Z.dump.age',objectSha256:'a'.repeat(64)});
  const steady=await state();assert.deepEqual([steady.rolcanlogin,steady.validUntil],[true,'infinity']);assert.equal(await login(sunk[backupCredential.BACKUP_SINKS.password]!),T.role);
  // containment: NOLOGIN, no password, VALID UNTIL infinity, sink and activation removed, the old password is refused
  const oldPassword=sunk[backupCredential.BACKUP_SINKS.password]!;
  const contained=await backupCredential.containBackupCredential(ports);
  assert.deepEqual([contained.state,contained.sinkDeleted,contained.activationDeleted],['CONTAINED',true,true]);
  const after=await state();assert.deepEqual([after.rolcanlogin,after.passwordIsNull,after.validUntil],[false,true,'infinity']);
  await assert.rejects(login(oldPassword));assert.ok(!(backupCredential.BACKUP_SINKS.password in sunk));assert.ok(!('PRODUCTION_BACKUP_ACTIVATION' in vars));
  // a fresh authorization with an unknown provider outcome: contained, one POST, never resent
  claimed=false;posts=0;resetFails=true;
  await assert.rejects(backupCredential.provisionBackupCredential(ports),(e:Error&{contained?:{state:string}})=>{assert.equal(e.message,'BACKUP_CREDENTIAL_RESET_OUTCOME_UNKNOWN');assert.equal(e.contained?.state,'CONTAINED');return true;});
  assert.equal(posts,1);const unknown=await state();assert.deepEqual([unknown.rolcanlogin,unknown.passwordIsNull,unknown.validUntil],[false,true,'infinity']);
  evidence.backupCredentialLifecycle={provisionPosts:1,leaseMinutesMax:90,finalized:true,contained:true,unknownOutcomeResent:false};
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
