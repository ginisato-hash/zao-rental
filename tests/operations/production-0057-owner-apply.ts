// Production-shaped regression for the 0057 owner path (Issue #47 R65_0057_OWNER_PATH_BLOCKER). Disposable PostgreSQL only.
// A Neon-shaped neondb at canonical 0001–0056 (production foundation plan: rental_stage_guard() owned by neondb_custody_executor,
// owner and role admin outside the custody roles) must accept canonical 0057 applied as neondb_owner, with no role bridge,
// membership, ownership, LOGIN or password change, and with rental_stage_guard() byte-for-byte unchanged.
import {STAFF_NOTIFICATION_FUNCTIONS,CUSTOMER_TABLES} from '../../scripts/production-staff-notifications';
import {applyProductionStaffDeltaMigration,applyProductionStaffDeltaGrants,staffDeltaGrantProof,committedProof} from '../../scripts/production-staff-delta';
import {applyProductionCouponAdminMigration,applyProductionCouponAdminGrants,couponAdminGrantProof,couponAdminCommittedProof,verifyProductionCouponAdmin} from '../../scripts/production-coupon-admin-delta';
import {applyProductionSalesStopMigration,applyProductionSalesStopGrants,salesStopGrantProof,salesStopCommittedProof,verifyProductionSalesStop} from '../../scripts/production-sales-stop-delta';
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
 assert.equal(entries.length,63);assert.equal(entries[62]!.id,'0063');assert.equal(entries[61]!.id,'0062');assert.equal(entries[58]!.id,'0059');assert.equal(entries[59]!.id,'0060');assert.equal(entries[60]!.id,'0061');assert.equal(entries[56]!.id,'0057');assert.equal(entries[57]!.id,'0058');assert.equal(entries[57]!.provenance.transformation,'NONE');assert.equal(entries[56]!.provenance.transformation,'NONE');
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
 assert.deepEqual(await q('SELECT id,checksum FROM public.foundation_migrations ORDER BY id'),entries.slice(0,57).map(e=>({id:e.id,checksum:e.checksum})));
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
 stage='R67 0058 applied as neondb_owner';
 // R67: 0058 is additive and owner-applicable on the same topology: one transaction, no role/membership/
 // ownership/LOGIN change, rental_stage_guard() unchanged, runtime readers of buckets also read bindings.
 const before58=await guard(),roles58=await roles();
 const c2=await owner.connect();
 try{
  await c2.query('BEGIN');
  await c2.query("SET LOCAL lock_timeout='1500ms';SET LOCAL statement_timeout='15000ms';SET LOCAL search_path=public,pg_catalog");
  await c2.query('SELECT pg_advisory_xact_lock(71820401),pg_advisory_xact_lock(71820600)');
  await c2.query('LOCK TABLE public.foundation_migrations IN EXCLUSIVE MODE');
  await c2.query(entries[57]!.sql);
  await c2.query('INSERT INTO public.foundation_migrations(id,checksum) VALUES($1,$2)',[entries[57]!.id,entries[57]!.checksum]);
  await c2.query('COMMIT');
 }catch(e){await c2.query('ROLLBACK').catch(()=>{});throw e;}finally{c2.release();}
 assert.deepEqual(await q('SELECT id,checksum FROM public.foundation_migrations ORDER BY id'),entries.slice(0,58).map(e=>({id:e.id,checksum:e.checksum})));
 assert.deepEqual(await guard(),before58);
 const roles58After=await roles();assert.deepEqual({roles:roles58After.roles,members:roles58After.members},{roles:roles58.roles,members:roles58.members});
 const owners58=roles58After.owners.filter((o:{k:string})=>!roles58.owners.some((p:{k:string})=>p.k===o.k));
 assert.ok(owners58.length>0&&owners58.every((o:{o:string})=>o.o===OWNER),'every new 0058 object is owner-owned');
 const readers=await q(`SELECT r.rolname FROM pg_roles r WHERE has_table_privilege(r.oid,'public.provisional_capacity_buckets'::regclass,'SELECT') AND NOT r.rolsuper AND r.rolname<>$1 ORDER BY 1`,[OWNER]);
 for(const r of readers)assert.equal((await q(`SELECT has_table_privilege($1,'public.provisional_model_bindings'::regclass,'SELECT') ok`,[r.rolname]))[0].ok,true,r.rolname);
 assert.equal((await q("SELECT provisional_size_key('SNOWBOARD','145') k"))[0].k,'145 cm');
 console.log('PASS canonical 0058 applies as neondb_owner after 0057: registry 57 -> 58, guard/roles/memberships unchanged, new objects owner-owned, bucket readers can read bindings');
 stage='Issue #47 0059+0060 applied as neondb_owner';
 // 0059 (rental terms acceptance) and 0060 (staff inbox/email) are additive and owner-applicable: one transaction each,
 // no role/membership/ownership/LOGIN change, guard unchanged, new objects owner-owned, then EXECUTE-only grants.
 const before60=await guard(),roles60=await roles();
 // Through the fixed Production operator path (scripts/production-staff-delta.ts): grants before migrate are refused,
 // migrate is one all-or-nothing transaction with read-back, and a second migrate is refused (never re-applied).
 const delta=await owner.connect();
 try{
  await assert.rejects(applyProductionStaffDeltaGrants(delta,DB,OWNER),/PRODUCTION_STAFF_DELTA_RECONCILIATION_REQUIRED/,'grants need the exact 0061 registry');
  await assert.rejects(applyProductionStaffDeltaMigration(delta,DB,'someone_else'),/PRODUCTION_STAFF_DELTA_RECONCILIATION_REQUIRED/,'wrong owner identity');
  // DELTA-01: the live service may record a new booking's rows between COMMIT and the read-back; that is a normal install.
  let natural:string|null=null;
  const installed=await applyProductionStaffDeltaMigration(delta,DB,OWNER,{afterCommit:async()=>{natural=(await owner.query("INSERT INTO customer_profiles(display_name,email,created_by) VALUES('SYNTHETIC natural','synthetic-natural@example.invalid','synthetic-service') RETURNING id")).rows[0].id;}});
  assert.ok(natural,'a row was written after COMMIT (immutable, so it stays: counted below)');
  assert.equal(installed.status,'PRODUCTION_STAFF_DELTA_INSTALLED');assert.deepEqual(installed.applied.map(a=>a.id),['0059','0060','0061']);
  await assert.rejects(applyProductionStaffDeltaMigration(delta,DB,OWNER),/PRODUCTION_STAFF_DELTA_RECONCILIATION_REQUIRED/,'no replay');
  // The post-commit read-back still refuses a real defect: a disabled required trigger (inside a rolled-back transaction).
  await delta.query('BEGIN');try{await delta.query('ALTER TABLE rental_terms_reconsents DISABLE TRIGGER rental_terms_reconsent_guard');await assert.rejects(committedProof(delta,OWNER),/PRODUCTION_STAFF_DELTA_RECONCILIATION_REQUIRED/);}finally{await delta.query('ROLLBACK');}
  await committedProof(delta,OWNER);
 }finally{delta.release();}
 assert.deepEqual(await q('SELECT id,checksum FROM public.foundation_migrations ORDER BY id'),entries.slice(0,61).map(e=>({id:e.id,checksum:e.checksum})));
 assert.deepEqual(await guard(),before60);
 const roles60After=await roles();assert.deepEqual({roles:roles60After.roles,members:roles60After.members},{roles:roles60.roles,members:roles60.members});
 const owners60=roles60After.owners.filter((o:{k:string})=>!roles60.owners.some((p:{k:string})=>p.k===o.k));
 assert.ok(owners60.length>0&&owners60.every((o:{o:string})=>o.o===OWNER),'every new 0059/0060/0061 object is owner-owned');
 assert.equal((await q('SELECT count(*)::int n FROM rental_terms_bundles'))[0].n,1);
 for(const t of ['rental_terms_acceptances','staff_booking_events','staff_notification_recipients','staff_notification_outbox','customer_profiles','customer_booking_links','customer_link_requests','staff_order_drafts','rental_terms_reconsents'])assert.equal((await q(`SELECT count(*)::int n FROM ${t}`))[0].n,t==='customer_profiles'?1:0,t+' starts empty: nothing is backfilled or emailed');
 const ops=DB+'_operations';assert.equal((await q("SELECT has_function_privilege($1,'staff_inbox_list(text[],boolean,timestamptz,uuid,integer)','EXECUTE') ok",[ops]))[0].ok,false,'no grant before the 0060 grant step');
 const grantsClient=await owner.connect();try{const g=await applyProductionStaffDeltaGrants(grantsClient,DB,OWNER);assert.equal(g.status,'PRODUCTION_STAFF_DELTA_GRANTS_INSTALLED');await staffDeltaGrantProof(grantsClient,ops);}finally{grantsClient.release();}
 for(const fn of STAFF_NOTIFICATION_FUNCTIONS)assert.equal((await q("SELECT has_function_privilege($1,$2,'EXECUTE') ok",[ops,fn]))[0].ok,true,fn);
 for(const t of ['staff_booking_events','staff_notification_outbox','staff_notification_recipients'])assert.equal((await q("SELECT has_table_privilege($1,$2,'SELECT') OR has_table_privilege($1,$2,'INSERT') ok",[ops,t]))[0].ok,false,'function-only access to '+t);
 for(const t of CUSTOMER_TABLES){assert.equal((await q("SELECT has_table_privilege($1,$2,'SELECT') ok",[ops,t]))[0].ok,true,t);for(const priv of ['INSERT','UPDATE','DELETE'])assert.equal((await q('SELECT has_table_privilege($1,$2,$3) ok',[ops,t,priv]))[0].ok,false,t+' '+priv);}
 assert.equal((await q("SELECT has_function_privilege($1,'customer_link_legacy(uuid,uuid,text)','EXECUTE') ok",[ops]))[0].ok,true);
 // Payment start reads the governing terms; re-consent is insert-only (no UPDATE/DELETE on either table).
 for(const [t,allowed] of [['rental_terms_acceptances',['SELECT']],['rental_terms_reconsents',['SELECT','INSERT']]] as const)for(const priv of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await q('SELECT has_table_privilege($1,$2,$3) ok',[ops,t,priv]))[0].ok,(allowed as readonly string[]).includes(priv),t+' '+priv);
 assert.equal((await q("SELECT has_function_privilege('public','customer_link_legacy(uuid,uuid,text)','EXECUTE') ok"))[0].ok,false,'no PUBLIC execute');
 console.log('PASS canonical 0059+0060+0061 apply as neondb_owner after 0058: registry 58 -> 61, guard/roles/memberships unchanged, new objects owner-owned, empty new tables, EXECUTE-only grants');
 stage='0062 sales stops applied as neondb_owner';
 // 0062 (day-level sales stop) through its fixed operator path: grants before migrate refused, one transaction with read-back,
 // no replay, no role/membership change, new objects owner-owned and empty; then SELECT + set-function EXECUTE for operations only.
 const before62=await guard(),roles62=await roles();
 const ss=await owner.connect();
 try{
  await assert.rejects(applyProductionSalesStopGrants(ss,DB,OWNER),/PRODUCTION_SALES_STOP_RECONCILIATION_REQUIRED/,'grants need the exact 0062 registry');
  await assert.rejects(applyProductionSalesStopMigration(ss,DB,'someone_else'),/PRODUCTION_SALES_STOP_RECONCILIATION_REQUIRED/,'wrong owner identity');
  await assert.rejects(applyProductionStaffDeltaMigration(ss,DB,OWNER),/PRODUCTION_STAFF_DELTA_RECONCILIATION_REQUIRED/,'the 0059-0061 delta never re-applies on 0061');
  const installed=await applyProductionSalesStopMigration(ss,DB,OWNER,{afterCommit:async()=>{await owner.query("BEGIN;SELECT set_config('zao.actor','synthetic-staff',true);SELECT store_sales_stop_set(ARRAY['MOUNTAIN_BASE'],'2030-01-02','2030-01-02',true,'SYNTHETIC natural');COMMIT");}});
  assert.equal(installed.status,'PRODUCTION_SALES_STOP_INSTALLED');assert.deepEqual(installed.applied.map(a=>a.id),['0062']);
  await assert.rejects(applyProductionSalesStopMigration(ss,DB,OWNER),/PRODUCTION_SALES_STOP_RECONCILIATION_REQUIRED/,'no replay');
  await ss.query('BEGIN');try{await ss.query('ALTER TABLE store_sales_stop_history DISABLE TRIGGER store_sales_stop_history_append_only');await assert.rejects(salesStopCommittedProof(ss,OWNER),/PRODUCTION_SALES_STOP_RECONCILIATION_REQUIRED/);}finally{await ss.query('ROLLBACK');}
  // The guest-hold guard is what keeps a pre-0062 build from booking a stopped day (PR74-ROLLBACK-01): without it the proof refuses.
  await ss.query('BEGIN');try{await ss.query('ALTER TABLE inventory_holds DISABLE TRIGGER store_sales_stop_hold_guard');await assert.rejects(salesStopCommittedProof(ss,OWNER),/PRODUCTION_SALES_STOP_RECONCILIATION_REQUIRED/);}finally{await ss.query('ROLLBACK');}
  await salesStopCommittedProof(ss,OWNER);
 }finally{ss.release();}
 assert.deepEqual(await q('SELECT id,checksum FROM public.foundation_migrations ORDER BY id'),entries.slice(0,62).map(e=>({id:e.id,checksum:e.checksum})));
 assert.deepEqual(await guard(),before62);
 const roles62After=await roles();assert.deepEqual({roles:roles62After.roles,members:roles62After.members},{roles:roles62.roles,members:roles62.members});
 const owners62=roles62After.owners.filter((o:{k:string})=>!roles62.owners.some((p:{k:string})=>p.k===o.k));
 assert.ok(owners62.length>0&&owners62.every((o:{o:string})=>o.o===OWNER),'every new 0062 object is owner-owned');
 assert.deepEqual((await q("SELECT store_id,to_char(day,'YYYY-MM-DD') d FROM store_sales_stops")),[{store_id:'MOUNTAIN_BASE',d:'2030-01-02'}],'the row written after COMMIT stays');
 assert.equal((await q("SELECT has_function_privilege($1,'store_sales_stop_set(text[],date,date,boolean,text)','EXECUTE') ok",[ops]))[0].ok,false,'no grant before the 0062 grant step');
 const g62=await owner.connect();try{
  await assert.rejects(verifyProductionSalesStop(g62,DB,OWNER),/PRODUCTION_SALES_STOP_RECONCILIATION_REQUIRED/,'verify needs the grants too');
  const g=await applyProductionSalesStopGrants(g62,DB,OWNER);assert.equal(g.status,'PRODUCTION_SALES_STOP_GRANTS_INSTALLED');await salesStopGrantProof(g62,ops);
  // Read-only verify (also the rollback check): counts only, no write, the guest-hold guard reported enabled.
  const hist=(await q('SELECT count(*)::int n FROM store_sales_stop_history'))[0].n;
  const v=await verifyProductionSalesStop(g62,DB,OWNER);
  assert.deepEqual(v,{status:'PRODUCTION_SALES_STOP_VERIFIED',registry:62,guestHoldGuard:'ENABLED',stoppedStationDaysFromToday:1,firstStoppedDay:'2030-01-02',lastStoppedDay:'2030-01-02',writes:0});
  assert.equal((await q('SELECT count(*)::int n FROM store_sales_stop_history'))[0].n,hist);
  await g62.query('ALTER TABLE inventory_holds DISABLE TRIGGER store_sales_stop_hold_guard');
  await assert.rejects(verifyProductionSalesStop(g62,DB,OWNER),/PRODUCTION_SALES_STOP_RECONCILIATION_REQUIRED/,'a disabled guest-hold guard fails verify');
  // REPLICA-only fires only under session_replication_role=replica, never in ordinary sessions: also refused (PR74-VERIFY-01).
  await g62.query('ALTER TABLE inventory_holds ENABLE REPLICA TRIGGER store_sales_stop_hold_guard');
  await assert.rejects(verifyProductionSalesStop(g62,DB,OWNER),/PRODUCTION_SALES_STOP_RECONCILIATION_REQUIRED/,'a replica-only guest-hold guard fails verify');
  await assert.rejects(salesStopCommittedProof(g62,OWNER),/PRODUCTION_SALES_STOP_RECONCILIATION_REQUIRED/);
  await g62.query('ALTER TABLE inventory_holds ENABLE TRIGGER store_sales_stop_hold_guard');await verifyProductionSalesStop(g62,DB,OWNER);
 }finally{g62.release();}
 for(const t of ['store_sales_stops','store_sales_stop_history'])for(const priv of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await q('SELECT has_table_privilege($1,$2,$3) ok',[ops,t,priv]))[0].ok,priv==='SELECT',t+' '+priv);
 assert.equal((await q("SELECT has_function_privilege('public','store_sales_stop_set(text[],date,date,boolean,text)','EXECUTE') ok"))[0].ok,false,'no PUBLIC set');
 for(const r of ['neondb_hold','neondb_guest','neondb_recommendation','neondb_transfer'])if((await q('SELECT 1 FROM pg_roles WHERE rolname=$1',[r])).length)assert.equal((await q("SELECT has_function_privilege($1,'store_sales_stopped_days(text[],date,date)','EXECUTE') ok",[r]))[0].ok,true,r+' reads stopped days');
 console.log('PASS canonical 0062 applies as neondb_owner after 0061: registry 61 -> 62, guard/roles/memberships unchanged, new objects owner-owned, operations SELECT + set EXECUTE only, PUBLIC reads stopped days only');
  stage='0063 coupon admin applied as neondb_owner';
 // 0063 (coupon administration) through its fixed operator path: grants before migrate refused, one transaction with read-back, no replay,
 // no role/membership change, new objects owner-owned, empty event log; then pricing SELECT/INSERT + both functions, operations functions only.
 const before63=await guard(),roles63=await roles(),pricingRole=DB+'_pricing';
 const ca=await owner.connect();
 try{
  await assert.rejects(applyProductionCouponAdminGrants(ca,DB,OWNER),/PRODUCTION_COUPON_ADMIN_RECONCILIATION_REQUIRED/,'grants need the exact 0063 registry');
  await assert.rejects(applyProductionCouponAdminMigration(ca,DB,'someone_else'),/PRODUCTION_COUPON_ADMIN_RECONCILIATION_REQUIRED/,'wrong owner identity');
  await assert.rejects(applyProductionSalesStopMigration(ca,DB,OWNER),/PRODUCTION_SALES_STOP_RECONCILIATION_REQUIRED/,'the 0062 delta never re-applies on 0062');
  const installed=await applyProductionCouponAdminMigration(ca,DB,OWNER);
  assert.equal(installed.status,'PRODUCTION_COUPON_ADMIN_INSTALLED');assert.deepEqual(installed.applied.map(a=>a.id),['0063']);
  await assert.rejects(applyProductionCouponAdminMigration(ca,DB,OWNER),/PRODUCTION_COUPON_ADMIN_RECONCILIATION_REQUIRED/,'no replay');
  await ca.query('BEGIN');try{await ca.query('ALTER TABLE coupon_status_events DISABLE TRIGGER coupon_status_immutable');await assert.rejects(couponAdminCommittedProof(ca,OWNER),/PRODUCTION_COUPON_ADMIN_RECONCILIATION_REQUIRED/);}finally{await ca.query('ROLLBACK');}
  await couponAdminCommittedProof(ca,OWNER);
 }finally{ca.release();}
 assert.deepEqual(await q('SELECT id,checksum FROM public.foundation_migrations ORDER BY id'),entries.map(e=>({id:e.id,checksum:e.checksum})));
 assert.deepEqual(await guard(),before63);
 const roles63After=await roles();assert.deepEqual({roles:roles63After.roles,members:roles63After.members},{roles:roles63.roles,members:roles63.members});
 const owners63=roles63After.owners.filter((o:{k:string})=>!roles63.owners.some((p:{k:string})=>p.k===o.k));
 assert.ok(owners63.length>0&&owners63.every((o:{o:string})=>o.o===OWNER),'every new 0063 object is owner-owned');
 assert.equal((await q('SELECT count(*)::int n FROM coupon_status_events'))[0].n,0,'the event log starts empty');
 for(const r of [pricingRole,ops])assert.equal((await q("SELECT has_function_privilege($1,'coupon_is_active(uuid)','EXECUTE') ok",[r]))[0].ok,false,'no grant before the 0063 grant step');
 const g63=await owner.connect();try{
  await assert.rejects(verifyProductionCouponAdmin(g63,DB,OWNER),/PRODUCTION_COUPON_ADMIN_RECONCILIATION_REQUIRED/,'verify needs the grants too');
  const g=await applyProductionCouponAdminGrants(g63,DB,OWNER);assert.equal(g.status,'PRODUCTION_COUPON_ADMIN_GRANTS_INSTALLED');await couponAdminGrantProof(g63,pricingRole,ops);
  const v=await verifyProductionCouponAdmin(g63,DB,OWNER);
  assert.deepEqual(v,{status:'PRODUCTION_COUPON_ADMIN_VERIFIED',registry:63,eventLog:'APPEND_ONLY',statusEvents:0,disabledCoupons:0,coupons:0,writes:0});
  await g63.query('ALTER TABLE coupon_status_events DISABLE TRIGGER coupon_status_immutable');
  await assert.rejects(verifyProductionCouponAdmin(g63,DB,OWNER),/PRODUCTION_COUPON_ADMIN_RECONCILIATION_REQUIRED/,'a disabled immutability trigger fails verify');
  await g63.query('ALTER TABLE coupon_status_events ENABLE REPLICA TRIGGER coupon_status_immutable');
  await assert.rejects(verifyProductionCouponAdmin(g63,DB,OWNER),/PRODUCTION_COUPON_ADMIN_RECONCILIATION_REQUIRED/,'a replica-only trigger fails verify');
  await g63.query('ALTER TABLE coupon_status_events ENABLE TRIGGER coupon_status_immutable');await verifyProductionCouponAdmin(g63,DB,OWNER);
 }finally{g63.release();}
 for(const priv of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await q('SELECT has_table_privilege($1,$2,$3) ok',[pricingRole,'coupon_status_events',priv]))[0].ok,priv==='SELECT'||priv==='INSERT','pricing '+priv);
 for(const priv of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await q('SELECT has_table_privilege($1,$2,$3) ok',[ops,'coupon_status_events',priv]))[0].ok,false,'operations '+priv);
 console.log('PASS canonical 0063 applies as neondb_owner after 0062: registry 62 -> 63, guard/roles/memberships unchanged, new objects owner-owned, pricing SELECT/INSERT + functions, operations functions only, PUBLIC nothing');
}catch(e){console.error('PRODUCTION_0057_OWNER_APPLY_FAILED '+stage);throw e;}finally{for(const close of closers)await close().catch(()=>{});await db.stop();}
