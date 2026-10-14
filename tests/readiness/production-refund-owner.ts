// Issue #47: incremental 0055 -> 0056 after the Neon-shaped bootstrap has removed its custody bridge.
// The cluster superuser only creates the provider parent, login owner and empty database. All schema,
// migration and grant work uses the real NOSUPERUSER neondb_owner connection; no hosted credentials.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {productionFoundationPlan,runFoundationPlan,schemaFingerprint,securityFingerprint,aclGrantRows} from '../../scripts/production-bootstrap';
import {productionAppRoleNames} from '../../scripts/production-app-roles';
import {applyProductionRefundAutomationMigration,applyProductionRefundAutomationGrants} from '../../scripts/production-refund-automation';

const DATABASE='neondb',OWNER='neondb_owner',OPERATIONS='neondb_operations';
const functions=['ops_refund_row(uuid)','ops_refund_claim(uuid)','ops_refund_observe(uuid,jsonb)'];
async function fixture(lostCommit:boolean){
 const db=await startIsolatedPostgres();let owner:Pool|undefined,operations:Pool|undefined;
 try{
  const password=randomBytes(24).toString('hex');
  await db.pool.query('CREATE ROLE synthetic_neon_superuser NOLOGIN CREATEDB CREATEROLE BYPASSRLS');
  await db.pool.query('GRANT pg_read_all_data,pg_write_all_data TO synthetic_neon_superuser WITH ADMIN OPTION');
  await db.pool.query(`CREATE ROLE ${OWNER} LOGIN NOSUPERUSER CREATEDB CREATEROLE INHERIT PASSWORD '${password}'`);
  await db.pool.query(`GRANT synthetic_neon_superuser TO ${OWNER} WITH ADMIN OPTION`);
  await db.pool.query(`CREATE DATABASE ${DATABASE} OWNER ${OWNER}`);
  const connection={host:'127.0.0.1',port:db.identity.dbPort,database:DATABASE,password,max:1};
  owner=new Pool({...connection,user:OWNER});owner.on('error',()=>{});
  const plan=await productionFoundationPlan(DATABASE);
  // Test-only prefix: canonical 0001..0055, existing role provisioning, then the complete bridge cleanup.
  await runFoundationPlan(owner,{...plan,bootstrap:{...plan.bootstrap,entries:plan.bootstrap.entries.slice(0,55)}});
  const c=await owner.connect();
  try{
   await c.query(`BEGIN;SET LOCAL ROLE neondb_role_admin;ALTER ROLE ${OPERATIONS} LOGIN PASSWORD '${password}';RESET ROLE;COMMIT`);
   operations=new Pool({...connection,user:OPERATIONS});operations.on('error',()=>{});
   const posture=async()=>(await c.query(`SELECT current_database() db,current_user role,session_user login,
    (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) superuser,
    (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='rental_internal') internal_owner,
    has_schema_privilege(current_user,'rental_internal','CREATE') owner_internal_create,
    has_schema_privilege(current_user,'public','CREATE') owner_public_create,
    has_schema_privilege($1,'rental_internal','CREATE') operations_internal_create,
    has_schema_privilege($1,'public','CREATE') operations_public_create`,[OPERATIONS])).rows[0];
   assert.deepEqual(await posture(),{db:DATABASE,role:OWNER,login:OWNER,superuser:false,internal_owner:'neondb_custody_executor',
    owner_internal_create:false,owner_public_create:true,operations_internal_create:false,operations_public_create:false});
   const registry=async()=>(await c.query('SELECT id,checksum FROM foundation_migrations ORDER BY id')).rows;
   assert.deepEqual(await registry(),plan.bootstrap.entries.slice(0,55).map(({id,checksum})=>({id,checksum})));
   await c.query(`INSERT INTO auth_user(id,name,email,"createdAt","updatedAt") SELECT id,'SYNTHETIC '||id,id||'@example.invalid',now(),now() FROM unnest(ARRAY['r61-active','r61-inactive','r61-viewer']) id`);
   await c.query("INSERT INTO staff_members(id,active,role,scope) VALUES('r61-active',true,'STAFF','ASSIGNED'),('r61-inactive',false,'STAFF','ASSIGNED'),('r61-viewer',true,'VIEWER','ASSIGNED')");
   await c.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES('r61-active','REFUND_OVERRIDE',false),('r61-inactive','REFUND_OVERRIDE',false),('r61-viewer','REFUND_OVERRIDE',false),('r61-active','HOLD_EDIT',false)");
   const unrelated=async()=>(await c.query(`SELECT staff_id,permission,allowed FROM staff_permission_overrides WHERE NOT(staff_id='r61-active' AND permission='REFUND_OVERRIDE') ORDER BY 1,2`)).rows;
   const staffState=async()=>(await c.query("SELECT id,CASE WHEN active THEN to_jsonb(s)-'revision'-'updated_at' ELSE to_jsonb(s) END state FROM staff_members s ORDER BY id")).rows;
   const staffBefore=await staffState(),unrelatedBefore=await unrelated();
   const securityBefore=await securityFingerprint(c),schemaBefore=await schemaFingerprint(c),aclBefore=await aclGrantRows(c as never);
   const topology=async()=>(await c.query(`SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members ORDER BY 1,2,3`)).rows;
   const membershipsBefore=await topology();
   const loseAck=(client:PoolClient)=>{let commits=0;const wrapped=Object.create(client) as PoolClient;
    wrapped.query=(async(...args:unknown[])=>{const result=await Reflect.apply(client.query,client,args);if(args[0]==='COMMIT'){commits++;throw Error('SYNTHETIC_COMMIT_ACK_LOSS');}return result;}) as PoolClient['query'];
    return{wrapped,commits:()=>commits};};
   try{
    if(lostCommit){const lost=loseAck(c);await assert.rejects(applyProductionRefundAutomationMigration(lost.wrapped,DATABASE,OWNER),/COMMIT_UNKNOWN_READBACK_REQUIRED/);assert.equal(lost.commits(),1);}
    else assert.equal((await applyProductionRefundAutomationMigration(c,DATABASE,OWNER)).status,'PRODUCTION_REFUND_AUTOMATION_INSTALLED');
   }catch(error){
    // Before the SQL fix this proves the real 42501 and atomic rollback, without treating it as success.
    if((error as {code?:string}).code==='42501'){
     assert.deepEqual(await registry(),plan.bootstrap.entries.slice(0,55).map(({id,checksum})=>({id,checksum})));
     assert.equal((await schemaFingerprint(c)).sha256,schemaBefore.sha256);
     assert.equal((await securityFingerprint(c)).sha256,securityBefore.sha256);
     console.log(JSON.stringify({state:'OLD_0056_FAIL_PROVEN',sqlstate:'42501',message:(error as Error).message,registry:55,rollback:'UNCHANGED',checksum:plan.bootstrap.entries[55]!.checksum}));
    }
    throw error;
   }
   // Reconciliation after a lost COMMIT is read-only. The migration is never sent again to recover.
   await c.query('BEGIN READ ONLY');
   try{
    assert.deepEqual(await registry(),plan.bootstrap.entries.slice(0,56).map(({id,checksum})=>({id,checksum})));
    assert.deepEqual(await topology(),membershipsBefore);assert.deepEqual(await unrelated(),unrelatedBefore);
    assert.deepEqual(await staffState(),staffBefore,'inactive accounts exact; active identity/scope unchanged (denial removal revises active permissions)');
    const after=await securityFingerprint(c);
    for(const key of ['schemaOwners','schemaGrants','roleMemberships','roleAttributes','sequenceGrants','defaultPrivileges','publicRoutineExecute'])assert.deepEqual(after.material[key],securityBefore.material[key],key);
    const withoutNewFunctions=(rows:string[])=>rows.filter(v=>!functions.some(fn=>v.startsWith('public.'+fn.split('(')[0]+'(')));
    assert.deepEqual(withoutNewFunctions(after.material.routineGrants!),withoutNewFunctions(securityBefore.material.routineGrants!),'unrelated function ACL');
    const marker=(await c.query(`SELECT pg_get_userbyid(x.relowner) owner,
     NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(x.relacl,acldefault('r',x.relowner))) a WHERE a.grantee<>x.relowner) owner_only
     FROM pg_class x WHERE x.oid='public.ops_refund_effects'::regclass`)).rows[0];
    assert.deepEqual(marker,{owner:OWNER,owner_only:true});
    const appRoles=Object.values(productionAppRoleNames(DATABASE));
    for(const role of appRoles)for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])
     assert.equal((await c.query('SELECT has_table_privilege($1,$2,$3) allowed',[role,'public.ops_refund_effects',privilege])).rows[0].allowed,false,role+' '+privilege);
    assert.equal((await c.query("SELECT to_regclass('rental_internal.ops_refund_effects') IS NULL absent")).rows[0].absent,true);
    for(const fn of functions){
     const row=(await c.query(`SELECT p.prosecdef,pg_get_userbyid(p.proowner) owner,
      p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'] path,
      NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner) owner_only
      FROM pg_proc p WHERE p.oid=$1::regprocedure`,[fn])).rows[0];
     assert.deepEqual(row,{prosecdef:true,owner:OWNER,path:true,owner_only:true});
    }
    const aclAfter=await aclGrantRows(c as never);
    for(const category of Object.keys(aclBefore) as Array<keyof typeof aclBefore>)
     assert.deepEqual(aclAfter[category].filter(v=>!v.includes('ops_refund_effects')&&!v.includes('staff_permission_override_removals')&&!functions.some(fn=>v.includes(fn.split('(')[0]!))),
      aclBefore[category].filter(v=>!functions.some(fn=>v.includes(fn.split('(')[0]!))),category+' unrelated ACL');
    assert.deepEqual((await c.query("SELECT staff_id FROM staff_permission_override_removals ORDER BY staff_id")).rows,[{staff_id:'r61-active'}]);
    assert.equal((await c.query("SELECT count(*)::int n FROM staff_role_permissions WHERE role IN ('STAFF','MANAGER','ADMIN') AND permission IN ('BOOKING_VIEW','REFUND_OVERRIDE')")).rows[0].n,6);
   }finally{await c.query('ROLLBACK');}
   const app=await operations.connect();try{
    await app.query('BEGIN');await app.query("SELECT set_config('zao.actor','system:refund-worker',true)");
    await assert.rejects(app.query("INSERT INTO public.ops_refund_effects VALUES(txid_current(),pg_backend_pid(),'00000000-0000-0000-0000-000000000001')"),{code:'42501'});
    await app.query('ROLLBACK');
   }finally{app.release();}
   if(lostCommit){const lost=loseAck(c);await assert.rejects(applyProductionRefundAutomationGrants(lost.wrapped,DATABASE,OWNER),/COMMIT_UNKNOWN_READBACK_REQUIRED/);assert.equal(lost.commits(),1);}
   else assert.equal((await applyProductionRefundAutomationGrants(c,DATABASE,OWNER)).status,'PRODUCTION_REFUND_AUTOMATION_GRANTS_INSTALLED');
   await c.query('BEGIN READ ONLY');
   try{
    for(const fn of functions)assert.deepEqual((await c.query(`SELECT pg_get_userbyid(a.grantee) grantee FROM pg_proc p,
     aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=$1::regprocedure AND a.privilege_type='EXECUTE' ORDER BY 1`,[fn])).rows,[{grantee:OPERATIONS},{grantee:OWNER}]);
    assert.deepEqual(await topology(),membershipsBefore);assert.deepEqual(await unrelated(),unrelatedBefore);
    assert.equal((await c.query('SELECT count(*)::int n FROM public.ops_refund_effects')).rows[0].n,0);
   }finally{await c.query('ROLLBACK');}
   // A nonexistent refund exercises the trusted claim marker INSERT/DELETE without business writes.
   assert.equal((await operations.query("SELECT ops_refund_claim('00000000-0000-0000-0000-000000000001') result")).rows[0].result,null);
   assert.equal((await c.query('SELECT count(*)::int n FROM public.ops_refund_effects')).rows[0].n,0);
   await assert.rejects(applyProductionRefundAutomationMigration(c,DATABASE,OWNER),/RECONCILIATION_REQUIRED/);
   await assert.rejects(applyProductionRefundAutomationGrants(c,DATABASE,OWNER),/GRANTS_REFUSED/);
   console.log('PASS production-shaped incremental '+(lostCommit?'lost COMMIT -> read-only reconciliation':'migration, exact grants, marker isolation and replay refusal'));
  }finally{c.release();}
 }finally{await operations?.end();await owner?.end();await db.stop();}
}
try{await fixture(false);await fixture(true);console.log('PRODUCTION_SHAPED_NON_SUPERUSER_INCREMENTAL_PASS');}
catch(error){console.error('PRODUCTION_SHAPED_NON_SUPERUSER_INCREMENTAL_FAIL',String((error as {code?:string}).code??''),(error as Error).message);process.exitCode=1;}
