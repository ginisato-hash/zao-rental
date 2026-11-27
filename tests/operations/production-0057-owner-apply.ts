// Production-shaped regression for the 0057 owner path (Issue #47 R65_0057_OWNER_PATH_BLOCKER). Disposable PostgreSQL only.
// A Neon-shaped neondb at canonical 0001–0056 (production foundation plan: rental_stage_guard() owned by neondb_custody_executor,
// owner and role admin outside the custody roles) must accept canonical 0057 applied as neondb_owner, with no role bridge,
// membership, ownership, LOGIN or password change, and with rental_stage_guard() byte-for-byte unchanged.
import {STAFF_NOTIFICATION_FUNCTIONS,CUSTOMER_TABLES} from '../../scripts/production-staff-notifications';
import {applyProductionStaffDeltaMigration,applyProductionStaffDeltaGrants,staffDeltaGrantProof,committedProof} from '../../scripts/production-staff-delta';
import {applyProductionCouponAdminMigration,applyProductionCouponAdminGrants,couponAdminGrantProof,couponAdminCommittedProof,verifyProductionCouponAdmin} from '../../scripts/production-coupon-admin-delta';
import {applyProductionGroupMigration,applyProductionGroupGrants,applyProductionCustodyLink,preflightProductionCustodyLink,groupGrantProof,groupCommittedProof,custodyLinkAbsentProof,verifyProductionGroup,CUSTODY_LINK_OPERATIONS_GRANTS,GROUP_TABLES,groupRoleNames} from '../../scripts/production-group-delta';
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
 assert.equal(entries.length,65);assert.equal(entries[64]!.id,'0065');assert.equal(entries[63]!.id,'0064');assert.equal(entries[62]!.id,'0063');assert.equal(entries[61]!.id,'0062');assert.equal(entries[58]!.id,'0059');assert.equal(entries[59]!.id,'0060');assert.equal(entries[60]!.id,'0061');assert.equal(entries[56]!.id,'0057');assert.equal(entries[57]!.id,'0058');assert.equal(entries[57]!.provenance.transformation,'NONE');assert.equal(entries[56]!.provenance.transformation,'NONE');
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
 assert.deepEqual(await q('SELECT id,checksum FROM public.foundation_migrations ORDER BY id'),entries.slice(0,63).map(e=>({id:e.id,checksum:e.checksum})));
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

 stage='0064 group order core (Owner decision 2026-11-27, option A): owner path, grants, verify; then 0065 is refused on the owner path';
 // 0064 (group order core) through its fixed operator path: grants before migrate refused, one transaction with read-back, no replay, no role/membership change,
 // the executor-owned custody objects untouched byte for byte, every new table owner-owned and empty; then the group role (created by the NOLOGIN manager,
 // never by the owner) with exactly the hold-equivalent + group delta. 0065 (the custody link) is NOT applied: the owner path is refused (42501) and rolls back.
 const roles64=await roles(),gr=groupRoleNames(DB);
 const exec64=async()=>(await q(`SELECT p.oid::regprocedure::text k,pg_get_userbyid(p.proowner) o,p.prosecdef sd,coalesce(p.proacl::text,'') acl,coalesce(p.proconfig::text,'') cfg,md5(pg_get_functiondef(p.oid)) def FROM pg_proc p WHERE p.oid IN ('public.rental_apply_receipt(uuid)'::regprocedure,'public.rental_stage_guard()'::regprocedure,'public.rental_validate_loan()'::regprocedure) ORDER BY 1`));
 const loanTriggers=async()=>(await q("SELECT t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) d FROM pg_trigger t WHERE t.tgrelid='public.rental_loan_items'::regclass AND NOT t.tgisinternal ORDER BY 1"));
 const view63=async()=>(await q("SELECT pg_get_viewdef('public.rental_inventory_blocks'::regclass) d,pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.rental_inventory_blocks'::regclass)) o"))[0];
 const gm=await owner.connect();
 try{
  await assert.rejects(applyProductionGroupGrants(gm,DB,OWNER),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/,'grants need the exact 0064 registry');
  await assert.rejects(applyProductionGroupMigration(gm,DB,'someone_else'),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/,'wrong owner identity');
  await assert.rejects(applyProductionCouponAdminMigration(gm,DB,OWNER),/PRODUCTION_COUPON_ADMIN_RECONCILIATION_REQUIRED/,'the 0063 delta never re-applies on 0063');
  const execBefore=await exec64(),trigBefore=await loanTriggers(),viewBefore=await view63();
  assert.equal(execBefore.length,3);assert.ok(execBefore.every((r:{o:string})=>r.o===EXECUTOR),'the custody functions are executor-owned');
  // The owner (no custody membership) applies the canonical 0064 as a whole: it touches nothing the executor owns.
  const m=await applyProductionGroupMigration(gm,DB,OWNER);
  assert.equal(m.status,'PRODUCTION_GROUP_INSTALLED');assert.deepEqual(m.applied.map(a=>a.id),['0064']);assert.equal(m.grantsAdded,0);assert.equal(m.roleChanges,0);
  assert.deepEqual(await q('SELECT id,checksum FROM public.foundation_migrations ORDER BY id'),entries.slice(0,64).map(e=>({id:e.id,checksum:e.checksum})),'exactly 0001-0064, canonical checksums');
  assert.deepEqual(await exec64(),execBefore,'rental_apply_receipt / rental_stage_guard / rental_validate_loan are byte-identical (owner, ACL, settings, source)');
  assert.deepEqual(await loanTriggers(),trigBefore,'the ordinary loan trigger is untouched');assert.deepEqual(await view63(),viewBefore,'rental_inventory_blocks is untouched');
  assert.deepEqual(await guard(),before63,'the stage guard is byte-identical');
  await assert.rejects(applyProductionGroupMigration(gm,DB,OWNER),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/,'no replay once 0064 is registered');
  await gm.query('BEGIN');try{await gm.query('ALTER TABLE group_orders DISABLE TRIGGER group_order_guard');await assert.rejects(groupCommittedProof(gm,DB,OWNER),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/);}finally{await gm.query('ROLLBACK');}
  await groupCommittedProof(gm,DB,OWNER);await custodyLinkAbsentProof(gm);
  // A half-applied custody link is refused by the absent proof (the loan subject column on its own).
  await gm.query('BEGIN');try{await gm.query('ALTER TABLE rental_loan_items ADD COLUMN group_part_id uuid');await assert.rejects(custodyLinkAbsentProof(gm),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/);}finally{await gm.query('ROLLBACK');}
  await custodyLinkAbsentProof(gm);
 }finally{gm.release();}
 const roles64After=await roles();assert.deepEqual({roles:roles64After.roles,members:roles64After.members},{roles:roles64.roles,members:roles64.members},'migrate changes no role, no membership, no LOGIN, no password');
 const owners64=roles64After.owners.filter((o:{k:string})=>!roles64.owners.some((p:{k:string})=>p.k===o.k));
 assert.ok(owners64.length>0&&owners64.every((o:{k:string;o:string})=>o.o===OWNER),'every new 0064 object is owner-owned (nothing is executor-owned)');
 assert.ok(!owners64.some((o:{k:string})=>/rental_validate_group_loan|group_part_preparations/.test(o.k)),'no custody-link object exists');
 for(const t of GROUP_TABLES)assert.equal((await q(`SELECT count(*)::int n FROM ${t}`))[0].n,0,t+' starts empty');
 assert.equal((await q("SELECT count(*)::int n FROM pg_roles WHERE rolname=$1",[gr.group]))[0].n,0,'no group role before the grants step');
 const g64=await owner.connect();try{
  await assert.rejects(verifyProductionGroup(g64,DB,OWNER),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/,'verify needs the grants too');
  const g=await applyProductionGroupGrants(g64,DB,OWNER);assert.equal(g.status,'PRODUCTION_GROUP_GRANTS_INSTALLED');assert.equal(g.roleChanges,1);await groupGrantProof(g64,DB,OWNER);
  await assert.rejects(applyProductionGroupGrants(g64,DB,OWNER),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/,'no second grants run');
  const v=await verifyProductionGroup(g64,DB,OWNER);
  assert.deepEqual(v,{status:'PRODUCTION_GROUP_VERIFIED',registry:64,custodyLink:'NOT_APPLIED',groupRoleLogin:false,tables:13,groups:0,activeGroups:0,entranceRows:0,events:0,pendingNotices:0,groupHolds:0,writes:0});
  await g64.query('ALTER TABLE group_orders DISABLE TRIGGER group_order_guard');
  await assert.rejects(verifyProductionGroup(g64,DB,OWNER),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/,'a disabled guard trigger fails verify');
  await g64.query('ALTER TABLE group_orders ENABLE REPLICA TRIGGER group_order_guard');
  await assert.rejects(verifyProductionGroup(g64,DB,OWNER),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/,'a replica-only trigger fails verify');
  await g64.query('ALTER TABLE group_orders ENABLE TRIGGER group_order_guard');await verifyProductionGroup(g64,DB,OWNER);
  // Exact privileges: any extra or missing privilege fails verify.
  await g64.query(`GRANT DELETE ON group_orders TO ${gr.group}`);await assert.rejects(verifyProductionGroup(g64,DB,OWNER),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/,'an extra group DELETE fails verify');await g64.query(`REVOKE DELETE ON group_orders FROM ${gr.group}`);
  await g64.query('GRANT SELECT ON group_payments TO PUBLIC');await assert.rejects(verifyProductionGroup(g64,DB,OWNER),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/,'PUBLIC access fails verify');await g64.query('REVOKE SELECT ON group_payments FROM PUBLIC');
  await g64.query(`GRANT SELECT ON group_events TO ${DB}_pricing`);await assert.rejects(verifyProductionGroup(g64,DB,OWNER),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/,'another role on a group table fails verify');await g64.query(`REVOKE SELECT ON group_events FROM ${DB}_pricing`);
  await g64.query(`GRANT SELECT ON group_orders TO ${DB}_operations`);await assert.rejects(verifyProductionGroup(g64,DB,OWNER),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/,'a custody-link privilege (operations on a group table) is NOT part of 0064 and fails verify');await g64.query(`REVOKE SELECT ON group_orders FROM ${DB}_operations`);
  await g64.query(`REVOKE UPDATE(status) ON group_notification_outbox FROM ${gr.group}`);await assert.rejects(verifyProductionGroup(g64,DB,OWNER),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/,'a missing delivery column fails verify');await g64.query(`GRANT UPDATE(status) ON group_notification_outbox TO ${gr.group}`);
  await verifyProductionGroup(g64,DB,OWNER);
 }finally{g64.release();}
 const members64=await q("SELECT pg_get_userbyid(roleid) r,pg_get_userbyid(member) m FROM pg_auth_members WHERE roleid=$1::regrole OR member=$1::regrole",[gr.group]);
 assert.deepEqual(members64,[{r:gr.group,m:gr.manager}],'only the role manager administers the group role (the owner holds no membership)');
 assert.equal((await q("SELECT rolcanlogin FROM pg_roles WHERE rolname=$1",[gr.group]))[0].rolcanlogin,false,'NOLOGIN until the Owner connection step');
 assert.equal((await q("SELECT has_function_privilege($1,'group_register_actor(uuid)','EXECUTE') ok",[gr.group]))[0].ok,true);
 assert.equal((await q("SELECT has_function_privilege($1,'group_register_actor(uuid)','EXECUTE') ok",[ops]))[0].ok,false);
 // Least privilege: 0064 alone gives the custody (operations) role NOTHING on any group table, and nobody else anything either.
 for(const t of GROUP_TABLES)for(const p of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await q('SELECT has_table_privilege($1,$2,$3) ok',[ops,t,p]))[0].ok,false,'operations has no '+t+' '+p+' before the custody link');
 assert.equal((await q("SELECT has_column_privilege($1,'group_notification_outbox','sent_at','UPDATE') ok",[gr.group]))[0].ok,true);
 assert.equal((await q("SELECT has_column_privilege($1,'group_notification_outbox','admin_message','UPDATE') bad",[gr.group]))[0].bad,false);
 for(const r of [pricingRole,DB+'_hold',DB+'_guest',DB+'_recommendation',DB+'_transfer'])if((await q('SELECT 1 FROM pg_roles WHERE rolname=$1',[r])).length)for(const t of GROUP_TABLES)assert.equal((await q("SELECT has_table_privilege($1,$2,'SELECT') ok",[r,t]))[0].ok,false,r+' cannot read '+t);
 console.log('PASS canonical 0064 applies as neondb_owner after 0063: registry 63 -> 64, executor-owned custody objects byte-identical, no role/membership change, 13 owner-owned empty tables; grants create only the NOLOGIN group role (via the role manager), exact privileges, PUBLIC and operations nothing');

 stage='0065 custody link: refused on the owner path, UNAPPLIED, Production runs on 0064; then read by verify when a privileged path applies it';
 {
  const rolesBefore65=await roles(),execBefore65=await exec64();
  const c65=await owner.connect();
  try{
   await c65.query('BEGIN');await c65.query('SET LOCAL search_path=public,pg_catalog');
   // The link re-creates the ordinary loan trigger (EXECUTE on the executor-owned validator), replaces executor-owned functions and hands a function to the executor:
   // PostgreSQL refuses the owner (42501). This is why 0065 waits for a privileged path.
   await assert.rejects(c65.query(entries[64]!.sql),(e:{code?:string})=>e.code==='42501','the owner cannot apply 0065 (executor-owned custody objects)');
   await c65.query('ROLLBACK');
  }finally{c65.release();}
  assert.deepEqual(await q('SELECT id FROM public.foundation_migrations ORDER BY id'),entries.slice(0,64).map(e=>({id:e.id})),'0065 stays unregistered');
  assert.deepEqual(await roles(),rolesBefore65,'the refused 0065 changed no role, membership or owner');assert.deepEqual(await exec64(),execBefore65);
  const v0=await owner.connect();try{const v=await verifyProductionGroup(v0,DB,OWNER);assert.equal(v.custodyLink,'NOT_APPLIED');assert.equal(v.registry,64);}finally{v0.release();}
  // The installer's own path (docs/execution/group/CUSTODY_LINK_PRIVILEGED_PATH.md). Without the platform-granted executor membership it refuses with a fixed code and
  // changes nothing; a wrongly shaped grant (ADMIN, or SET without INHERIT) is not accepted either.
  {
   const pf0=await owner.connect();try{const p=await preflightProductionCustodyLink(pf0,DB,OWNER);assert.equal(p.executorMembership,'ABSENT');assert.equal(p.ready,false);assert.equal(p.writes,0);}finally{pf0.release();}
   const a0=await owner.connect();try{await assert.rejects(applyProductionCustodyLink(a0,DB,OWNER),/PRODUCTION_CUSTODY_LINK_PRIVILEGED_PATH_REQUIRED/,'no membership: refused with a fixed code');}finally{a0.release();}
   for(const bad of ['WITH INHERIT TRUE, SET TRUE, ADMIN TRUE','WITH INHERIT FALSE, SET TRUE, ADMIN FALSE','WITH INHERIT TRUE, SET FALSE, ADMIN FALSE']){
    await observer.query(`GRANT ${EXECUTOR} TO ${OWNER} ${bad}`);
    const pf=await owner.connect();try{assert.equal((await preflightProductionCustodyLink(pf,DB,OWNER)).ready,false,bad);}finally{pf.release();}
    const ab=await owner.connect();try{await assert.rejects(applyProductionCustodyLink(ab,DB,OWNER),/PRODUCTION_CUSTODY_LINK_PRIVILEGED_PATH_REQUIRED/,bad);}finally{ab.release();}
    await observer.query(`REVOKE ${EXECUTOR} FROM ${OWNER}`);
   }
   assert.deepEqual(await q('SELECT id FROM public.foundation_migrations ORDER BY id'),entries.slice(0,64).map(e=>({id:e.id})),'nothing was applied by the refusals');
   // The platform grants exactly one membership for one window (SIMULATED here by the isolated cluster superuser).
   await observer.query(`GRANT ${EXECUTOR} TO ${OWNER} WITH INHERIT TRUE, SET TRUE, ADMIN FALSE`);
   const pf1=await owner.connect();try{const p=await preflightProductionCustodyLink(pf1,DB,OWNER);assert.equal(p.executorMembership,'GRANTED');assert.equal(p.ready,true);assert.equal(p.writes,0);}finally{pf1.release();}
   const before=await roles(),stageBefore=await exec64();
   const ap=await owner.connect();let res;try{res=await applyProductionCustodyLink(ap,DB,OWNER);}finally{ap.release();}
   assert.equal(res.status,'PRODUCTION_CUSTODY_LINK_INSTALLED');assert.deepEqual(res.applied.map(x=>x.id),['0065']);assert.equal(res.roleChanges,0);assert.equal(res.credentialChanges,0);assert.equal(res.businessWrites,0);assert.equal(res.executorMembershipRevokeRequired,true);
   assert.deepEqual(await q('SELECT id,checksum FROM public.foundation_migrations ORDER BY id'),entries.slice(0,65).map(e=>({id:e.id,checksum:e.checksum})),'exactly 0001-0065, canonical checksums');
   const after=await roles();assert.deepEqual({roles:after.roles,members:after.members},{roles:before.roles,members:before.members},'the install changed no role and no membership');
   const stageAfter=await exec64();
   const vl=(rows:{k:string}[])=>JSON.stringify(rows.filter(r=>r.k==='rental_validate_loan()'));assert.equal(vl(stageAfter),vl(stageBefore),'the ordinary loan validator is byte-identical');assert.equal(stageAfter.length,3);
   assert.ok(stageAfter.every((r:{o:string})=>r.o===EXECUTOR),'all three custody functions stay executor-owned');
   // a second run is refused (0065 is registered)
   const again=await owner.connect();try{await assert.rejects(applyProductionCustodyLink(again,DB,OWNER),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/);}finally{again.release();}
   // the platform revokes the window; the verify read must work without it
   await observer.query(`REVOKE ${EXECUTOR} FROM ${OWNER}`);
   const pfAfter=await owner.connect();try{await assert.rejects(preflightProductionCustodyLink(pfAfter,DB,OWNER),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/,'preflight is for registry 64 only');}finally{pfAfter.release();}
  }
  assert.equal((await q("SELECT count(*)::int n FROM pg_proc WHERE oid='public.rental_validate_group_loan()'::regprocedure AND pg_get_userbyid(proowner)=$1",[EXECUTOR]))[0].n,1,'the group loan validator is executor-owned');
  const v1=await owner.connect();
  try{
   await observer.query(`REVOKE SELECT ON group_orders,group_order_parts,group_members,group_payments FROM ${ops}`);
   await assert.rejects(verifyProductionGroup(v1,DB,OWNER),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/,'0065 present without the custody-side privileges it needs is not accepted');
   for(const s of CUSTODY_LINK_OPERATIONS_GRANTS)await observer.query(s.replace('{OPS}',ops));
   const v=await verifyProductionGroup(v1,DB,OWNER);
   assert.equal(v.registry,65);assert.equal(v.custodyLink,'APPLIED');
   await v1.query('ALTER TABLE rental_loan_items DISABLE TRIGGER rental_validate_group_loan');
   await assert.rejects(verifyProductionGroup(v1,DB,OWNER),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/,'a disabled group loan validator fails the read of 0065');
   await v1.query('ALTER TABLE rental_loan_items ENABLE TRIGGER rental_validate_group_loan');await verifyProductionGroup(v1,DB,OWNER);
   // The 0064 installer never writes on a 0065 database.
   await assert.rejects(applyProductionGroupGrants(v1,DB,OWNER),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/);await assert.rejects(applyProductionGroupMigration(v1,DB,OWNER),/PRODUCTION_GROUP_RECONCILIATION_REQUIRED/);
  }finally{v1.release();}
  console.log('PASS 0065 custody link: refused as 42501 on the owner path and left unregistered (Production stays on 0064; verify reads NOT_APPLIED); the installer applies it only under the platform-granted executor membership (fixed refusal codes otherwise), then verify reads it separately (exact shape, exact custody privileges)');
 }
}catch(e){console.error('PRODUCTION_0057_OWNER_APPLY_FAILED '+stage);throw e;}finally{for(const close of closers)await close().catch(()=>{});await db.stop();}
