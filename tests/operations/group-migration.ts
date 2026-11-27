import assert from 'node:assert/strict';
import {groupFixture} from '../group/fixture';
import {grantGroupNotificationDelta} from '../../scripts/group-notification-role';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {migrationPlan} from '../../packages/db/src/index';
import {CUSTODY_LINK_FUNCTIONS,CUSTODY_LINK_TABLES,CUSTODY_LINK_TRIGGERS,GROUP_FUNCTIONS,GROUP_PERMISSIONS,GROUP_TABLES,GROUP_TRIGGERS,custodyLinkAbsentProof,custodyLinkAppliedProof,expectedGroupAcl,groupCommittedProof,groupRoleNames} from '../../scripts/production-group-delta';

// 0064 group order core (and, when ZAO_TEST_CUSTODY_LINK is not '0', the 0065 custody link): the database contract the installer and verify rely on (Issue #47). Synthetic local PostgreSQL only; no provider, payment or network.
// Proves: the migration is registered last and applied once, every relation/trigger/function the production installer proves exists here with the same
// shape, the development group role holds exactly the privileges the production grants step defines (so the two cannot drift), the database guards refuse
// direct writes and an unauthorised actor registration, PUBLIC and the other application roles hold nothing on group data, and only ADMIN gets GROUP_*.
// Two states, both run by `npm run test:group-migration`: the full schema (0064 + 0065) and the Production state (0064 only, the custody link NOT applied).
const link=process.env.ZAO_TEST_CUSTODY_LINK!=='0';
const x=await groupFixture(2);
let stage='setup',count=0,opsRole:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const code=(c:string)=>(e:{code?:string})=>{assert.equal(e.code,c,JSON.stringify(e));return true;};
try{
 const owner=x.db.pool,db=x.db.identity.database,roles=groupRoleNames(db);
 const ownerName=(await owner.query('SELECT current_user u')).rows[0].u as string;
 await grantGroupNotificationDelta(owner,db);
 // The development operations role is provisioned AFTER the schema exists, exactly like the real roles; its group grants exist only when the custody link does.
 opsRole=await provisionOperationsRole(owner,x.db.identity);

 await check('0064 stays registered last and is applied exactly once',async()=>{
  assert.equal(migrationPlan.at(-1)!.id,'0065');assert.equal(migrationPlan.at(-2)!.id,'0064');
  assert.deepEqual((await owner.query("SELECT id FROM foundation_migrations WHERE id IN ('0064','0065') ORDER BY id")).rows,link?[{id:'0064'},{id:'0065'}]:[{id:'0064'}]);
  assert.equal(GROUP_TABLES.length,13);assert.equal(CUSTODY_LINK_TABLES.length,1);
 });
 await check('every relation, trigger (enabled), function, permission and hold constraint the production proof requires exists in the migrated schema',async()=>{
  await groupCommittedProof(owner,db,ownerName);
  if(link)await custodyLinkAppliedProof(owner,db,ownerName);else await custodyLinkAbsentProof(owner);
  assert.equal(GROUP_TRIGGERS.length,20);assert.equal(CUSTODY_LINK_TRIGGERS.length,4);
  // The proof must cover every group function 0064/0065 created: no unlisted group_* function.
  const listed=new Set([...GROUP_FUNCTIONS,...(link?CUSTODY_LINK_FUNCTIONS:[])].map(f=>f.sig.split('(')[0]));
  const actual=(await owner.query("SELECT DISTINCT p.proname n FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE 'group\\_%' OR p.proname='rental_validate_group_loan')")).rows.map(r=>r.n as string);
  assert.deepEqual(actual.filter(n=>!listed.has(n)),[],'no unlisted group function (the installer proof would not cover it)');
  // ... and every trigger on a group table is listed.
  const listedTriggers=new Set([...GROUP_TRIGGERS,...(link?CUSTODY_LINK_TRIGGERS:[])].map(([t,n])=>t+'.'+n));
  const triggers=(await owner.query("SELECT c.relname||'.'||t.tgname k FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname=ANY($1)",[[...GROUP_TABLES,...(link?CUSTODY_LINK_TABLES:[])]])).rows.map(r=>r.k as string);
  assert.deepEqual(triggers.filter(k=>!listedTriggers.has(k)),[],'no unlisted trigger on a group table');
 });
 await check('the development group role holds exactly the privileges the production grants step defines on the group relations',async()=>{
  const exp=expectedGroupAcl(roles,link);
  const mine=(rows:string[],role:string)=>rows.filter(r=>r.split('|')[1]===role);
  const t=(await owner.query(`SELECT c.relname||'|'||pg_get_userbyid(a.grantee)||'|'||a.privilege_type k FROM pg_class c,aclexplode(c.relacl) a WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1) AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname=$2) ORDER BY 1`,[GROUP_TABLES as unknown as string[],roles.group])).rows.map(r=>r.k as string);
  assert.deepEqual(t,mine(exp.tableLevel,roles.group));
  const c=(await owner.query(`SELECT c.relname||'.'||t.attname||'|'||pg_get_userbyid(a.grantee)||'|'||a.privilege_type k FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid,aclexplode(t.attacl) a WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1) AND t.attacl IS NOT NULL AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname=$2) ORDER BY 1`,[GROUP_TABLES as unknown as string[],roles.group])).rows.map(r=>r.k as string);
  assert.deepEqual(c,mine(exp.columnLevel,roles.group));
  assert.equal((await owner.query("SELECT has_function_privilege($1,'group_register_actor(uuid)','EXECUTE') ok",[roles.group])).rows[0].ok,true);
  assert.equal((await owner.query("SELECT has_sequence_privilege($1,'group_number_seq','USAGE') ok",[roles.group])).rows[0].ok,true);
  // The group role never holds a custody-link privilege (least privilege): it cannot write a loan.
  assert.equal((await owner.query("SELECT has_table_privilege($1,'rental_loan_items','INSERT') ok",[roles.group])).rows[0].ok,false);
  // The custody (operations) side: nothing on the group tables in the 0064-only state; the exact link set once 0065 exists.
  const ops=(await owner.query(`SELECT c.relname||'|'||pg_get_userbyid(a.grantee)||'|'||a.privilege_type k FROM pg_class c,aclexplode(c.relacl) a WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1) AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname=$2) ORDER BY 1`,[[...GROUP_TABLES,...CUSTODY_LINK_TABLES],roles.operations])).rows.map(r=>r.k as string);
  assert.deepEqual(ops,mine(exp.tableLevel,roles.operations),link?'operations reads the confirmed group and records the preparation':'operations holds nothing on any group table before 0065');
 });
 await check('PUBLIC and the other application roles hold nothing on group data; PUBLIC cannot run the revoked functions',async()=>{
  for(const t of [...GROUP_TABLES,...(link?CUSTODY_LINK_TABLES:[])])for(const p of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal((await owner.query('SELECT has_table_privilege(\'public\',$1,$2) ok',[t,p])).rows[0].ok,false,t+' '+p);
  for(const f of [...GROUP_FUNCTIONS,...(link?CUSTODY_LINK_FUNCTIONS:[])].filter(f=>!f.publicExecute))assert.equal((await owner.query("SELECT has_function_privilege('public',$1,'EXECUTE') ok",[f.sig])).rows[0].ok,false,f.sig);
  await assert.rejects(x.roles.holdPool.query('SELECT count(*) FROM group_orders'),code('42501'));
  await assert.rejects(x.flow.flowPool.query('SELECT count(*) FROM group_payments'),code('42501'));
  await assert.rejects(x.roles.holdPool.query("SELECT group_register_actor('00000000-0000-0000-0000-000000000000')"),code('42501'));
 });
 await check('database guards refuse a direct group write (even by the owner) and an actor registration outside a group operation',async()=>{
  const g=x.groupPool;
  await assert.rejects(g.query("INSERT INTO group_events(group_id,revision,event_type,actor,payload) VALUES(gen_random_uuid(),1,'GROUP_STARTED','synthetic','{}')"),(e:{code?:string})=>e.code==='23514');
  await assert.rejects(g.query("SELECT group_register_actor(gen_random_uuid())"),code('42501'));
  // The owner is not exempt either: only the group role inside an explicit group operation may append.
  await assert.rejects(owner.query("INSERT INTO group_events(group_id,revision,event_type,actor,payload) VALUES(gen_random_uuid(),1,'GROUP_STARTED','synthetic','{}')"),code('23514'));
 });
 await check('only ADMIN holds the GROUP_* permissions (MANAGER and STAFF none); the permission list is exactly the seven approved',async()=>{
  const r=(await owner.query("SELECT role,count(*)::int n FROM staff_role_permissions WHERE permission LIKE 'GROUP\\_%' GROUP BY role ORDER BY 1")).rows;
  assert.deepEqual(r,[{role:'ADMIN',n:GROUP_PERMISSIONS.length}]);
  assert.deepEqual((await owner.query("SELECT permission FROM staff_role_permissions WHERE role='ADMIN' AND permission LIKE 'GROUP\\_%' ORDER BY 1")).rows.map(x=>x.permission),[...GROUP_PERMISSIONS].sort());
  await assert.rejects(owner.query("INSERT INTO staff_role_permissions(role,permission) VALUES('ADMIN','GROUP_UNKNOWN')"),code('23514'));
 });
 console.log('PASS group-migration '+count+' checks');
}catch(e){console.error('GROUP_MIGRATION_FAILED '+stage);throw e;}finally{await opsRole?.close();await x.close();}
