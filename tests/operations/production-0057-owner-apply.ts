// Production-shaped regression for the 0057 owner path (Issue #47 R65_0057_OWNER_PATH_BLOCKER). Disposable PostgreSQL only.
// A Neon-shaped neondb at canonical 0001–0056 (production foundation plan: rental_stage_guard() owned by neondb_custody_executor,
// owner and role admin outside the custody roles) must accept canonical 0057 applied as neondb_owner, with no role bridge,
// membership, ownership, LOGIN or password change, and with rental_stage_guard() byte-for-byte unchanged.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {startIsolatedPostgres} from '../../scripts/postgres';
import {trackPoolLifecycle} from '../../scripts/pool-lifecycle';
import {productionFoundationPlan,runFoundationPlan} from '../../scripts/production-bootstrap';

const DB='neondb',OWNER='neondb_owner',EXECUTOR='neondb_custody_executor';
let stage='setup';
const db=await startIsolatedPostgres(),closers:Array<()=>Promise<void>>=[];
try{
 const superPassword=(db.pool.options as {password:string}).password,ownerPassword=randomBytes(18).toString('hex');
 const connect=(user:string,password:string)=>{const p=new Pool({host:'127.0.0.1',port:db.identity.dbPort,user,password,database:DB,max:3});closers.push(trackPoolLifecycle(p));return p;};
 await db.pool.query('CREATE ROLE synthetic_neon_superuser NOLOGIN CREATEDB CREATEROLE BYPASSRLS');
 await db.pool.query('GRANT pg_read_all_data,pg_write_all_data TO synthetic_neon_superuser WITH ADMIN OPTION');
 await db.pool.query(`CREATE ROLE ${OWNER} LOGIN NOSUPERUSER CREATEDB CREATEROLE INHERIT PASSWORD '${ownerPassword}'`);
 await db.pool.query(`GRANT synthetic_neon_superuser TO ${OWNER}`);
 await db.pool.query(`CREATE DATABASE ${DB} OWNER ${OWNER}`);
 const owner=connect(OWNER,ownerPassword),observer=connect(db.identity.user,superPassword);
 const full=await productionFoundationPlan(DB),entries=full.bootstrap.entries;
 assert.equal(entries.length,57);assert.equal(entries[56]!.id,'0057');assert.equal(entries[56]!.provenance.transformation,'NONE');
 stage='registry56 production topology';
 await runFoundationPlan(owner,{...full,bootstrap:{...full.bootstrap,entries:entries.slice(0,56)}});
 const q=async(sql:string,params:unknown[]=[])=>(await observer.query(sql,params)).rows;
 const guard=async()=>(await q(`SELECT pg_get_functiondef(p.oid) def,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,coalesce(p.proacl::text,'') acl FROM pg_proc p WHERE p.oid='public.rental_stage_guard()'::regprocedure`))[0];
 const roles=async()=>({roles:await q(`SELECT rolname,rolcanlogin,rolinherit,rolcreaterole,rolsuper,rolbypassrls,rolvaliduntil::text,rolpassword IS NOT NULL has_password FROM pg_authid WHERE rolname !~ '^pg_' ORDER BY 1`),
  members:await q(`SELECT pg_get_userbyid(roleid) r,pg_get_userbyid(member) m,admin_option,inherit_option,set_option FROM pg_auth_members ORDER BY 1,2`),
  owners:await q(`SELECT 'fn:'||p.oid::regprocedure::text k,pg_get_userbyid(p.proowner) o FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','rental_internal')
   UNION ALL SELECT 'rel:'||c.oid::regclass::text,pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','rental_internal') ORDER BY 1`)});
 const before=await guard(),rolesBefore=await roles();
 assert.equal(before.owner,EXECUTOR);
 assert.deepEqual((await q(`SELECT pg_has_role($1,$2,'MEMBER') owner_member,pg_has_role($3,$2,'MEMBER') admin_member`,[OWNER,EXECUTOR,full.roles.managerRole]))[0],{owner_member:false,admin_member:false});
 assert.equal((await q(`SELECT count(*)::int n FROM pg_auth_members WHERE roleid=$1::regrole`,[EXECUTOR]))[0].n,0);
 console.log('PASS registry56 Production topology: guard owned by custody executor; owner/role-admin custody membership 0');

 stage='canonical 0057 applied as neondb_owner';
 const c=await owner.connect();
 try{
  await c.query('BEGIN');
  await c.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='15000ms';SET LOCAL idle_in_transaction_session_timeout='20000ms';SET LOCAL search_path=public,pg_catalog");
  await c.query('SELECT pg_advisory_xact_lock(71820401),pg_advisory_xact_lock(71820600)');
  const id=(await c.query('SELECT current_user AS u,session_user AS s,pg_get_userbyid(datdba) AS o FROM pg_database WHERE datname=current_database()')).rows[0];
  assert.deepEqual(id,{u:OWNER,s:OWNER,o:OWNER});
  await c.query('LOCK TABLE public.foundation_migrations IN EXCLUSIVE MODE');
  const pre=(await c.query('SELECT id,checksum FROM public.foundation_migrations ORDER BY id')).rows;
  assert.deepEqual(pre,entries.slice(0,56).map(e=>({id:e.id,checksum:e.checksum})));
  await c.query(entries[56]!.sql);
  await c.query('INSERT INTO public.foundation_migrations(id,checksum) VALUES($1,$2)',[entries[56]!.id,entries[56]!.checksum]);
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
 assert.deepEqual(await q('SELECT id,checksum FROM public.foundation_migrations ORDER BY id'),entries.map(e=>({id:e.id,checksum:e.checksum})));
 console.log('PASS canonical 0057 applies as neondb_owner in one transaction: registry 56 → 57, latest 0057, 57 canonical checksums');

 stage='no role or guard mutation';
 const after=await guard();assert.deepEqual(after,before);assert.deepEqual(await roles(),rolesBefore);
 const receipt=(g:typeof before)=>({defSha256:createHash('sha256').update(g.def).digest('hex'),owner:g.owner,prosecdef:g.prosecdef,proconfig:g.proconfig,acl:g.acl});
 console.log('GUARD_RECEIPT '+JSON.stringify({pre:receipt(before),post:receipt(after),equal:true,executorMembers:0,ownerCustodyMember:false,roleAdminCustodyMember:false,roleMembershipDelta:0}));
 console.log('PASS rental_stage_guard() definition/owner/SECURITY DEFINER/search_path/ACL unchanged; roles, memberships, LOGIN/password and object owners unchanged');

 stage='0057 objects and Production runtime privileges';
 assert.equal((await q(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='inventory_pole_exemptions_variant_ids_check'`))[0].d,'CHECK ((cardinality(variant_ids) >= 0))');
 const sync=(await q(`SELECT pg_get_userbyid(proowner) AS owner,prosecdef,proconfig,EXISTS(SELECT 1 FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) a WHERE a.grantee=0) public_exec,position('INTEGRATED_V1_3' in prosrc)>0 v13,position('SKI_SET' in prosrc)>0 skiset FROM pg_proc WHERE oid='public.inventory_sync_pole_exemptions(uuid)'::regprocedure`))[0];
 assert.deepEqual(sync,{owner:OWNER,prosecdef:true,proconfig:['search_path=pg_catalog, public, pg_temp'],public_exec:false,v13:true,skiset:true});
 const priv=await q(`SELECT r.rolname,has_function_privilege(r.oid,'public.inventory_sync_pole_exemptions(uuid)'::regprocedure,'EXECUTE') sync,
  has_table_privilege(r.oid,'public.inventory_pole_exemptions'::regclass,'SELECT') exemptions,has_table_privilege(r.oid,'public.rental_loan_items'::regclass,'INSERT') loans,
  has_column_privilege(r.oid,'public.inventory_holds'::regclass,'allocation_stage','UPDATE') stage FROM pg_roles r WHERE r.rolname=ANY($1) ORDER BY 1`,[['neondb_hold','neondb_transfer','neondb_operations',EXECUTOR]]);
 const by=Object.fromEntries(priv.map(r=>[r.rolname,r]));
 for(const r of ['neondb_hold','neondb_transfer','neondb_operations'])assert.equal(by[r]?.sync,true,r);
 assert.deepEqual({e:by.neondb_operations.exemptions,l:by.neondb_operations.loans,s:by.neondb_operations.stage},{e:true,l:true,s:true});
 assert.equal(by[EXECUTOR].exemptions,false,'0057 adds no custody-executor privilege');
 console.log('PASS 0057 constraint, V1.3 SKI_SET sync function (owner, SECURITY DEFINER, pinned path, no PUBLIC EXECUTE); hold/transfer/operations EXECUTE and operations checkout privileges present; executor privileges unchanged');
}catch(e){console.error('PRODUCTION_0057_OWNER_APPLY_FAILED '+stage);throw e;}finally{for(const close of closers)await close().catch(()=>{});await db.stop();}
