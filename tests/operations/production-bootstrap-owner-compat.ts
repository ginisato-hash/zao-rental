// Option D (EPHEMERAL_ROLE_CREATOR) and the viewer-independent ACL fingerprint, on owned
// disposable PostgreSQL only. The persistent owner is Neon-shaped: LOGIN NOSUPERUSER CREATEDB
// CREATEROLE INHERIT, a member of a provider parent role, createrole_self_grant=''. No Production
// connection, credential or provider call.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {migrate} from '../../packages/db/src/index';
import {bootstrapPlan,bootstrapProductionSchema,runBootstrapPlan,schemaFingerprint,securityFingerprint,fingerprintDelta,deltaMismatch,aclGrantRows,type BootstrapPlan} from '../../scripts/production-bootstrap';

let failed=false,stage='setup',count=0;const evidence:Record<string,unknown>={};
const db=await startIsolatedPostgres();const pools:Pool[]=[];
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const PARENT='synthetic_neon_superuser',OWNER='synthetic_neon_owner',superPassword=(db.pool.options as {password:string}).password,ownerPassword=randomBytes(18).toString('hex');
const connect=(database:string,user:string,password:string)=>{const p=new Pool({host:'127.0.0.1',port:db.identity.dbPort,user,password,database,max:3});p.on('error',()=>{});pools.push(p);return p;};
const asOwner=(database:string)=>connect(database,OWNER,ownerPassword),asSuper=(database:string)=>connect(database,db.identity.user,superPassword);
async function neonShaped(name:string){await db.pool.query(`CREATE DATABASE ${name} OWNER ${OWNER}`);return asOwner(name);}
const scalar=async(pool:Pool,sql:string,params:unknown[]=[])=>Object.values((await pool.query(sql,params)).rows[0] as Record<string,unknown>)[0];
const occupied=(pool:Pool)=>scalar(pool,`SELECT count(*)::int FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE c.relkind IN ('r','v','m') AND s.nspname NOT LIKE 'pg\\_%' AND s.nspname<>'information_schema'`);
const ownerMemberships=(pool:Pool,target:string)=>scalar(pool,`SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member=$1::regrole AND r.rolname IN ($2,$3)`,[OWNER,target+'_custody_executor',target+'_custody']);
/** Plan variant for mutation tests: same plan, with the named owner-compatibility statements dropped. */
function variant(plan:BootstrapPlan,drop:{prologue?:number[];bridge?:number[];cleanup?:number[];dropRole?:boolean;extraBridge?:string[]}):BootstrapPlan{
 const c=plan.ownerCompatibility,keep=(xs:string[],idx:number[]=[])=>xs.filter((_,i)=>!idx.includes(i));
 const prologue=keep(c.prologue,drop.prologue),bridge=[...keep(c.bridge,drop.bridge),...(drop.extraBridge??[])];
 const entries=plan.entries.map(e=>{
  if(e.id!=='0015')return e;
  const oldP=c.prologue.join('\n')+'\n',oldB='\n'+c.bridge.join('\n')+'\n';
  assert.ok(e.sql.startsWith(oldP)&&e.sql.includes(oldB));
  return {...e,sql:(prologue.length?prologue.join('\n')+'\n':'')+e.sql.slice(oldP.length).replace(oldB,()=>'\n'+bridge.join('\n')+'\n')};
 });
 return {...plan,entries,ownerCompatibility:{...c,prologue,bridge,cleanup:keep(c.cleanup,drop.cleanup),drop:drop.dropRole?'':c.drop}};
}
async function assertUntouched(pool:Pool,target:string,plan:BootstrapPlan){
 assert.equal(await occupied(pool),0);
 assert.equal(await scalar(pool,"SELECT to_regclass('foundation_migrations') IS NULL"),true);
 assert.equal(await scalar(pool,'SELECT count(*)::int FROM pg_roles WHERE starts_with(rolname,$1) OR rolname=$2',[target+'_',plan.ownerCompatibility.bootstrapRole]),0);
}
try{
 await db.pool.query(`CREATE ROLE ${PARENT} NOLOGIN CREATEDB CREATEROLE BYPASSRLS`);
 await db.pool.query(`GRANT pg_read_all_data,pg_write_all_data TO ${PARENT}`);
 await db.pool.query(`CREATE ROLE ${OWNER} LOGIN NOSUPERUSER CREATEDB CREATEROLE INHERIT PASSWORD '${ownerPassword}'`);
 await db.pool.query(`GRANT ${PARENT} TO ${OWNER}`);
 const CANONICAL='zr_'+randomBytes(6).toString('hex');await db.pool.query(`CREATE DATABASE ${CANONICAL}`);const canonical=asSuper(CANONICAL);

 await check('A1 catalog ACL material equals PostgreSQL information_schema for a superuser viewer',async()=>{
  await migrate(canonical);
  const rows=async(sql:string)=>(await canonical.query<{value:string}>(sql)).rows.map(r=>r.value).sort();
  const acl=await aclGrantRows(canonical);
  assert.deepEqual(acl.tableGrants,await rows(`SELECT table_schema||'.'||table_name||' '||grantee||' '||privilege_type||' grantable='||is_grantable AS value FROM information_schema.role_table_grants WHERE grantee<>'PUBLIC'`));
  assert.deepEqual(acl.columnGrants,await rows(`SELECT table_schema||'.'||table_name||'.'||column_name||' '||grantee||' '||privilege_type||' grantable='||is_grantable AS value FROM information_schema.column_privileges WHERE grantee<>'PUBLIC'`));
  assert.deepEqual(acl.publicColumnGrants,await rows(`SELECT table_schema||'.'||table_name||'.'||column_name||' '||privilege_type||' grantable='||is_grantable AS value FROM information_schema.column_privileges WHERE grantee='PUBLIC'`));
  // role_table_grants is not a valid oracle for PUBLIC rows; table_privileges is.
  assert.deepEqual(acl.publicTableGrants,await rows(`SELECT table_schema||'.'||table_name||' '||privilege_type||' grantable='||is_grantable AS value FROM information_schema.table_privileges WHERE grantee='PUBLIC'`));
  assert.ok(acl.publicTableGrants.length>0&&acl.tableGrants.length>0&&acl.columnGrants.length>0);
  evidence.aclCounts=Object.fromEntries(Object.entries(acl).map(([k,v])=>[k,v.length]));
 });

 const TARGET='zao_rental_neon_shaped',neon=await neonShaped(TARGET),neonSuper=asSuper(TARGET);
 assert.equal(await scalar(neon,"SELECT current_setting('createrole_self_grant')"),'');
 // Canonical deltas: a second, still-empty canonical database fingerprinted before and after migrate().
 const CANON2='zr_'+randomBytes(6).toString('hex');await db.pool.query(`CREATE DATABASE ${CANON2}`);const canon2=asSuper(CANON2);
 const kS0=await schemaFingerprint(canon2),kX0=await securityFingerprint(canon2);await migrate(canon2);
 const canonicalSchemaDelta=fingerprintDelta(kS0,await schemaFingerprint(canon2)),canonicalSecurityDelta=fingerprintDelta(kX0,await securityFingerprint(canon2));
 const pS0=await schemaFingerprint(neon),pX0=await securityFingerprint(neon);
 const result=await bootstrapProductionSchema(neon,TARGET);
 const pS1=await schemaFingerprint(neon),pX1=await securityFingerprint(neon);
 evidence.securityFingerprintAfter=pX1.sha256;evidence.bootstrapRole=result.ownerCompatibility.bootstrapRole;evidence.planSha256=result.planSha256;

 await check('E3 Neon-shaped non-superuser owner completes all 50 migrations in one committed transaction',async()=>{
  assert.equal(result.applied,50);assert.equal(result.guardsRewritten,12);
  assert.equal(await scalar(neon,'SELECT count(*)::int FROM foundation_migrations'),50);
  assert.ok(Number(await occupied(neon))>0);
  assert.equal(result.ownerCompatibility.strategy,'EPHEMERAL_ROLE_CREATOR');assert.equal(result.ownerCompatibility.migration,'0015');
 });
 await check('E1/E4 the persistent owner never created the custody roles and keeps no membership in them',async()=>{
  assert.equal(await ownerMemberships(neon,TARGET),0);
  assert.equal(await scalar(neon,'SELECT count(*)::int FROM pg_roles WHERE rolname=$1',[result.ownerCompatibility.bootstrapRole]),0);
  assert.equal(await scalar(neon,`SELECT count(*)::int FROM pg_auth_members m WHERE NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.oid=m.roleid) OR NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.oid=m.member) OR NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.oid=m.grantor)`),0);
  for(const role of [TARGET+'_custody_executor',TARGET+'_custody'])
   assert.equal(await scalar(neon,'SELECT (NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) FROM pg_roles WHERE rolname=$1',[role]),true,role);
 });
 await check('E5 no temporary CREATE privilege survives on the executor',async()=>{
  assert.equal(await scalar(neon,"SELECT has_database_privilege($1,current_database(),'CREATE')",[TARGET+'_custody_executor']),false);
  assert.equal(await scalar(neon,"SELECT has_schema_privilege($1,'public','CREATE')",[TARGET+'_custody_executor']),false);
 });
 await check('E6 exact schema and security delta equivalence with the superuser canonical migrate(), no exception',async()=>{
  assert.deepEqual(deltaMismatch(canonicalSchemaDelta,fingerprintDelta(pS0,pS1)),[]);
  assert.deepEqual(deltaMismatch(canonicalSecurityDelta,fingerprintDelta(pX0,pX1)),[]);
  assert.equal(fingerprintDelta(pX0,pX1).sha256,canonicalSecurityDelta.sha256);
 });
 await check('A2/A5 ACL material is identical for superuser and non-superuser viewers, owner-derived rows included',async()=>{
  const viaOwner=await aclGrantRows(neon),viaSuper=await aclGrantRows(neonSuper);
  assert.deepEqual(viaOwner,viaSuper);
  for(const t of ['effects','amendment_effects','stocktake_effects'])for(const p of ['SELECT','INSERT','UPDATE','DELETE'])
   assert.ok(viaOwner.tableGrants.includes(`rental_internal.${t} ${TARGET}_custody_executor ${p} grantable=YES`),t+' '+p);
  const legacy=async(pool:Pool)=>Number(await scalar(pool,`SELECT count(*)::int FROM information_schema.role_table_grants WHERE grantee<>'PUBLIC'`));
  evidence.viewerDependence={legacyOwnerViewer:await legacy(neon),legacySuperViewer:await legacy(neonSuper),catalog:viaOwner.tableGrants.length};
  assert.ok((await legacy(neon))<(await legacy(neonSuper)));// the defect the catalog form removes
 });
 await check('A3/A4 explicit PUBLIC table and column grants are detected and fail delta equivalence',async()=>{
  for(const [sql,category] of [['GRANT SELECT ON rental_bookings TO PUBLIC','publicTableGrants'],[`GRANT SELECT(id) ON rental_bookings TO ${TARGET}_custody`,'columnGrants'],['GRANT UPDATE(state) ON rental_bookings TO PUBLIC','publicColumnGrants']] as const){
   const c=await neon.connect();
   try{await c.query('BEGIN');const before=await aclGrantRows(c as never);await c.query(sql);const after=await aclGrantRows(c as never);
    assert.notDeepEqual(after[category],before[category],sql);
    assert.ok(deltaMismatch(canonicalSecurityDelta,fingerprintDelta(pX0,await securityFingerprint(c))).includes(category),sql);
   }finally{await c.query('ROLLBACK');c.release();}
  }
  assert.deepEqual(deltaMismatch(canonicalSecurityDelta,fingerprintDelta(pX0,await securityFingerprint(neon))),[]);
 });
 await check('E2 automatic ADMIN rows land on the ephemeral creator only and vanish with it',async()=>{
  const target='zao_rental_neon_e2',pool=await neonShaped(target),plan=await bootstrapPlan(target),notices:string[]=[];
  pool.on('connect',c=>{c.on('notice',n=>{if(String(n.message).startsWith('E2 '))notices.push(String(n.message));});});
  const probe=`DO $$BEGIN RAISE NOTICE 'E2 %',(SELECT coalesce(json_agg(pg_get_userbyid(m.member)||' IN '||pg_get_userbyid(m.roleid)||' admin='||m.admin_option ORDER BY 1),'[]') FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname IN ('${target}_custody_executor','${target}_custody'));END$$;`;
  await runBootstrapPlan(pool,variant(plan,{extraBridge:[probe]}));
  const seen=JSON.parse(notices[0]!.slice(3)) as string[],boot=plan.ownerCompatibility.bootstrapRole;
  assert.ok(seen.includes(`${boot} IN ${target}_custody_executor admin=true`),JSON.stringify(seen));
  assert.ok(seen.includes(`${boot} IN ${target}_custody admin=true`),JSON.stringify(seen));
  assert.ok(!seen.some(r=>r.startsWith(OWNER+' IN ')&&r.endsWith('admin=true')),JSON.stringify(seen));
  assert.equal(await ownerMemberships(pool,target),0);assert.equal(await scalar(pool,'SELECT count(*)::int FROM pg_roles WHERE rolname=$1',[boot]),0);
  assert.equal(await scalar(pool,'SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname IN ($1,$2)',[target+'_custody_executor',target+'_custody']),0);
 });
 const mutations:Array<[string,Parameters<typeof variant>[1],RegExp]>=[
  ['M1 no SET access to the ephemeral role',{prologue:[1]},/permission denied to set role|42501/],
  // The ephemeral role holds no authority over roles it did not create, so its cleanup revoke is
  // refused; either that refusal or the final residue proof must reject the plan.
  ['M2 persistent owner creates the custody roles itself',{prologue:[2]},/PRODUCTION_BOOTSTRAP_TEMPORARY_CAPABILITY_CLEANUP_FAILED|permission denied to revoke role/],
  ['M3 no executor SET/INHERIT bridge',{bridge:[0]},/must be able to SET ROLE/],
  ['M5 no temporary public schema CREATE',{bridge:[2]},/permission denied for schema public/],
  ['M6 executor membership cleanup skipped',{cleanup:[2]},/PRODUCTION_BOOTSTRAP_(TEMPORARY_CAPABILITY_CLEANUP_FAILED|EPHEMERAL_ROLE_DEPENDENCY)/],
  ['M7 public schema CREATE revocation skipped',{cleanup:[0]},/PRODUCTION_BOOTSTRAP_TEMPORARY_CAPABILITY_CLEANUP_FAILED/],
  ['M8 ephemeral role DROP skipped',{dropRole:true},/PRODUCTION_BOOTSTRAP_TEMPORARY_CAPABILITY_CLEANUP_FAILED/],
 ];
 const mutationResults:Record<string,string>={};
 for(const [name,drop,expected] of mutations)await check(name+' fails and rolls back completely',async()=>{
  const target='zao_rental_m_'+name.split(' ')[0]!.toLowerCase(),pool=await neonShaped(target),plan=await bootstrapPlan(target);
  await assert.rejects(runBootstrapPlan(pool,variant(plan,drop)),(e:Error)=>{mutationResults[name.split(' ')[0]!]=e.message.slice(0,80);return expected.test(e.message)||expected.test(String((e as {code?:string}).code));});
  await assertUntouched(pool,target,plan);
 });
 // M4 (redefined, PG18 compatibility proof): no database CREATE is required or granted. Immediately
 // before the rest of 0015 (first transfer: ALTER SCHEMA rental_internal OWNER TO <db>_custody_executor)
 // the fixture measures from catalogs that the executor lacks database CREATE and has no direct CREATE
 // ACL on the database; all 50 migrations must still commit and the predicate must stay false. PG18
 // checks database CREATE for ALTER SCHEMA ... OWNER against the invoking user, not the new owner.
 await check('M4 PG18 compatibility: executor never holds database CREATE and all 50 migrations commit',async()=>{
  const target='zao_rental_m_m4',pool=await neonShaped(target),plan=await bootstrapPlan(target),notices:string[]=[],executor=target+'_custody_executor';
  pool.on('connect',c=>{c.on('notice',n=>{if(String(n.message).startsWith('M4 '))notices.push(String(n.message).slice(3));});});
  const probe=`DO $$BEGIN RAISE NOTICE 'M4 %',json_build_object(
   'server_version',current_setting('server_version'),'server_version_num',current_setting('server_version_num'),
   'executor_database_create',has_database_privilege('${executor}',current_database(),'CREATE'),
   'database_acl',(SELECT json_agg(json_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY 1)
     FROM pg_database d,LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database()),
   'executor_memberships',(SELECT coalesce(json_agg(pg_get_userbyid(m.member)||' IN '||pg_get_userbyid(m.roleid)||' admin='||m.admin_option||' inherit='||m.inherit_option||' set='||m.set_option ORDER BY 1),'[]')
     FROM pg_auth_members m WHERE m.member='${executor}'::regrole OR m.roleid='${executor}'::regrole))::text;END$$;`;
  assert.ok(!plan.ownerCompatibility.bridge.some(s=>/ON DATABASE/.test(s))&&!plan.ownerCompatibility.cleanup.some(s=>/ON DATABASE/.test(s)));
  const r=await runBootstrapPlan(pool,variant(plan,{extraBridge:[probe]}));
  const measured=JSON.parse(notices[0]!) as {server_version:string;server_version_num:string;executor_database_create:boolean;database_acl:{grantee:string;privilege:string}[];executor_memberships:string[]};
  evidence.m4={outcome:'COMMITTED',transferStatement:`ALTER SCHEMA rental_internal OWNER TO ${executor}`,...measured};mutationResults.M4='PASS_PG18_COMPATIBILITY';
  assert.equal(measured.executor_database_create,false);
  assert.ok(!measured.database_acl.some(a=>a.grantee===executor),JSON.stringify(measured.database_acl));
  assert.equal(r.applied,50);assert.equal(await scalar(pool,'SELECT count(*)::int FROM foundation_migrations'),50);
  assert.equal(await scalar(pool,"SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='rental_internal'"),executor);
  assert.equal(await scalar(pool,"SELECT has_database_privilege($1,current_database(),'CREATE')",[executor]),false);
  assert.equal(await ownerMemberships(pool,target),0);
 });
 evidence.mutations=mutationResults;
 console.log(JSON.stringify({status:'PASS',cases:count,productionConnections:0,...evidence}));
}catch(e){
 failed=true;
 console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:e instanceof assert.AssertionError?e.message.slice(0,2000):(e as Error).message.slice(0,300)}));
 console.error((e as Error).stack?.split('\n').filter(l=>l.includes('/tests/operations/production-bootstrap-owner-compat')).join('\n'));
}finally{for(const p of pools)await p.end().catch(()=>{});await db.stop();}
if(failed)process.exit(1);
