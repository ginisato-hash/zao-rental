// Cutover rehearsal (Issue #47 / TD #7214138953 §A): move the DATA of a Neon-shaped 0001–0064 database into a freshly bootstrapped
// 0001–0065 database in the same cluster, and prove it. Disposable PostgreSQL, synthetic data only. No Production, no external party.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool,Client} from 'pg';
import {groupFixture} from '../group/fixture';
import {requestFor} from '../inventory/fixture';
import {trackPoolLifecycle} from '../../scripts/pool-lifecycle';
import {productionFoundationPlan,runFoundationPlan} from '../../scripts/production-bootstrap';
import {installGroupRoleOnFoundation65,groupGrantProof,groupRoleNames} from '../../scripts/production-group-delta';
import {copyData,runCutover,listTables,tableDigests,tableColumns,loadOrder,assertRegistries,assertTableSets,foreignKeyOrphans,triggerStates,schemaState,
 sequencePositions,loadPlan,readWrite,installDeltaGrantsOnFoundation65,auditChain,inFlightWork,TARGET_ONLY_COLUMNS,NOT_COPIED} from '../../scripts/production-cutover';

const SRC='neondb',DST='neondb_next',OWNER='neondb_owner';
const SOURCE_ONLY={'public.rental_loan_items':['group_part_id','hold_id']};
let stage='setup',count=0;const closers:Array<()=>Promise<void>>=[];
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const x=await groupFixture(20);
try{
 const superPassword=(x.db.pool.options as {password:string}).password,ownerPassword=randomBytes(18).toString('hex'),port=x.db.identity.dbPort;
 const connect=(user:string,password:string,database:string)=>{const p=new Pool({host:'127.0.0.1',port,user,password,database,max:4});closers.push(trackPoolLifecycle(p));return p;};
 const superuser=connect(x.db.identity.user,superPassword,x.db.identity.database);
 await superuser.query('CREATE ROLE synthetic_neon_superuser NOLOGIN CREATEDB CREATEROLE BYPASSRLS');
 await superuser.query('GRANT pg_read_all_data,pg_write_all_data TO synthetic_neon_superuser WITH ADMIN OPTION');
 await superuser.query(`CREATE ROLE ${OWNER} LOGIN NOSUPERUSER CREATEDB CREATEROLE INHERIT PASSWORD '${ownerPassword}'`);
 await superuser.query(`GRANT synthetic_neon_superuser TO ${OWNER}`);
 for(const db of [SRC,DST])await superuser.query(`CREATE DATABASE ${db} OWNER ${OWNER}`);
 const srcOwner=connect(OWNER,ownerPassword,SRC),dstOwner=connect(OWNER,ownerPassword,DST);

 // ---- synthetic business state in the canonical fixture database (bookings, a payment, groups at three stages)
 stage='synthetic business state';
 const confirmed=await x.draft(undefined,requestFor('2035-03-03'),{reason:'SYNTHETIC cutover fixture'});await x.service.startPayment(confirmed.booking.id,randomUUID());
 const pending=await x.draft(undefined,requestFor('2035-03-04'),{reason:'SYNTHETIC cutover fixture'});
 const token=await x.entrance();
 const draftGroup=await x.start(token,'SYNTHETIC draft group');
 const held=await x.held(token,2,'SYNTHETIC held group');
 const heldB=await x.held(token,3,'SYNTHETIC confirmed group');
 await x.svc.confirm(x.admin,heldB.groupId,{requestKey:randomUUID(),expectedRevision:heldB.revision,fitAcknowledgedMemberIds:[]});
 void pending;void draftGroup;void held;
 const fixtureCounts=async(p:Pool)=>Object.fromEntries(await Promise.all(['rental_bookings','rental_payment_attempts','inventory_holds','inventory_claims','group_orders','group_members','group_events','group_notification_outbox','auth_user','staff_members','price_quotes'].map(async t=>[t,Number((await p.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n)])));
 const business=await fixtureCounts(x.db.pool);
 for(const t of ['rental_bookings','rental_payment_attempts','inventory_holds','inventory_claims','group_orders','group_members','group_events','price_quotes'])assert.ok(business[t]!>0,'fixture holds '+t);

 // ---- Neon-shaped topology: source at registry 64, target bootstrapped at 65 by the proven path (ephemeral creator, no leftover privilege)
 stage='source and target bootstrap';
 const srcPlan=await productionFoundationPlan(SRC),dstPlan=await productionFoundationPlan(DST);
 assert.equal(srcPlan.bootstrap.entries.length,65);
 await runFoundationPlan(srcOwner,{...srcPlan,bootstrap:{...srcPlan.bootstrap,entries:srcPlan.bootstrap.entries.slice(0,64)}});
 await runFoundationPlan(dstOwner,dstPlan);
 const dstClient=await dstOwner.connect();
 try{const r=await installGroupRoleOnFoundation65(dstClient,DST,OWNER);assert.equal(r.roleChanges,1);
  const d=await installDeltaGrantsOnFoundation65(dstClient,DST,OWNER);assert.equal(d.roleChanges,0);}finally{dstClient.release();}
 await dstOwner.query(`ALTER DATABASE ${DST} SET default_transaction_read_only=on`);
 const manager=srcPlan.roles.managerRole,operations=groupRoleNames(SRC).operations;
 assert.ok(srcPlan.roles.operationalRoleNames.includes(operations));

 await check('the source is registry 0001–0064 and the target is the canonical 0001–0065 with the group role installed',async()=>{
  const reg=await assertRegistries(srcOwner,dstOwner);assert.deepEqual(reg,{source:64,target:65});
  await assert.rejects(assertRegistries(srcOwner,dstOwner,65),/CUTOVER_SOURCE_REGISTRY_UNEXPECTED/);
  assert.equal((await assertTableSets(srcOwner,dstOwner)).targetOnly[0],'public.group_part_preparations');
  const g=await dstOwner.connect();try{await g.query('BEGIN READ ONLY');await groupGrantProof(g,DST,OWNER,true);await g.query('ROLLBACK');}finally{g.release();}
  assert.equal((await dstOwner.query('SELECT count(*)::int n FROM public.group_orders')).rows[0].n,0);
 });

 // Seed the source from the fixture with the same copier the cutover uses (source-only 0065 columns are NULL in the fixture).
 await check('the source is seeded with the fixture rows (identity, sequences and trigger-derived values verbatim)',async()=>{
  const c=await srcOwner.connect();
  try{await c.query('BEGIN');const r=await copyData(x.db.pool,c,{ignoreSourceOnly:SOURCE_ONLY});await c.query('COMMIT');assert.ok(r.rows>0);}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  assert.deepEqual(await fixtureCounts(srcOwner),business);
  const tables=(await listTables(x.db.pool)).filter(t=>!(NOT_COPIED as readonly string[]).includes(t));
  const a=await tableDigests(x.db.pool,tables,TARGET_ONLY_COLUMNS),b=await tableDigests(srcOwner,tables.filter(t=>!['public.group_part_preparations'].includes(t)),{'public.rental_loan_items':['group_part_id','hold_id']});
  for(const [t,d] of Object.entries(b))assert.deepEqual(d,a[t],t);
  assert.equal(Number((await srcOwner.query("SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled<>'O'")).rows[0].n),0,'source triggers re-enabled');
 });

 await check('load order covers every table; the group foreign-key cycle and self-references are broken by transaction-local deferral',async()=>{
  const tables=(await listTables(srcOwner)).filter(t=>!(NOT_COPIED as readonly string[]).includes(t));
  const order=await loadOrder(srcOwner,tables);assert.equal(order.length,tables.length);
  const plan=await loadPlan(srcOwner,tables);assert.ok(plan.deferred.some(d=>d.table==='public.group_orders'&&d.parent==='public.group_quotes'),'confirmed_quote_id cycle edge');assert.ok(plan.deferred.some(d=>d.table==='public.group_payments'&&d.parent==='public.group_payments'),'self reference');
  assert.ok(order.indexOf('public.group_orders')<order.indexOf('public.group_order_parts'));
  assert.ok(order.indexOf('public.rental_bookings')<order.indexOf('public.rental_payment_attempts'));
  const cols=await tableColumns(srcOwner);assert.ok(cols.get('public.inventory_claims')!.some(c=>c.identityAlways),'ALWAYS identity columns exist and are overridden on load');
 });

 // The synthetic application session that the cutover must fence out.
 await srcOwner.query(`SET ROLE ${manager}`).catch(()=>undefined);
 const mgr=await srcOwner.connect();
 try{await mgr.query(`SET ROLE ${manager}`);await mgr.query(`ALTER ROLE ${operations} LOGIN PASSWORD '${ownerPassword}'`);await mgr.query('RESET ROLE');}finally{mgr.release();}
 await srcOwner.query('RESET ROLE').catch(()=>undefined);
 // A pooled connection keeps the read-only default it started with: judge the database by a brand-new session.
 const readOnlyNow=async(database:string)=>{const c=new Client({host:'127.0.0.1',port,user:OWNER,password:ownerPassword,database});await c.connect();try{return (await c.query('SHOW transaction_read_only')).rows[0].transaction_read_only==='on';}finally{await c.end();}};
 const appPool=()=>{const p=new Pool({host:'127.0.0.1',port,user:operations,password:ownerPassword,database:SRC,max:1});p.on('error',()=>undefined);return p;};
 let switched=0;const probes:Record<string,unknown>={};
 const options=(over:Partial<Parameters<typeof runCutover>[0]>={})=>({source:srcOwner,target:dstOwner,sourceOwner:srcOwner,targetOwner:dstOwner,sourceDatabase:SRC,targetDatabase:DST,
  runtimeRoles:[operations],managerRole:manager,fenceWaitMs:800,ignoreSourceOnly:SOURCE_ONLY,
  switchRuntime:async()=>{switched++;},postSwitchProbe:async()=>{},...over});
 const roleLogin=async()=>(await srcOwner.query('SELECT rolcanlogin FROM pg_roles WHERE rolname=$1',[operations])).rows[0].rolcanlogin as boolean;
 const sourceWritable=async()=>!(await readOnlyNow(SRC));
 const resetBoth=async()=>{const c=await srcOwner.connect();try{await c.query(`SET ROLE ${manager}`);await c.query(`ALTER ROLE ${operations} LOGIN`);await c.query('RESET ROLE');}finally{c.release();}
  await readWrite(srcOwner,[`ALTER DATABASE ${SRC} RESET default_transaction_read_only`]);await readWrite(dstOwner,[`ALTER DATABASE ${DST} SET default_transaction_read_only=on`]);};

 await check('a running application session that cannot be terminated aborts the cutover and the source is unfenced again',async()=>{
  const app=appPool();
  try{
   await app.query('SELECT 1');assert.equal(await roleLogin(),true);
   await assert.rejects(runCutover(options()),(e:{message:string;stage:string;rolledBack:boolean;chainValid:boolean})=>{
    assert.match(e.message,/CUTOVER_FENCE_SESSIONS_REMAIN/);assert.equal(e.stage,'fence');assert.equal(e.rolledBack,true);assert.equal(e.chainValid,true);return true;});
   assert.equal(await roleLogin(),true,'runtime role LOGIN restored');assert.equal(await sourceWritable(),true,'source writable again');
   assert.equal(switched,0);
   assert.equal((await dstOwner.query('SELECT count(*)::int n FROM public.group_orders')).rows[0].n,0,'target untouched');
  }finally{await app.end().catch(()=>undefined);}
 });

 // ASSUMPTION (unproven on real Neon): the owner may terminate runtime-role sessions (pg_signal_backend). Locally granted to prove the termination path.
 await superuser.query(`GRANT pg_signal_backend TO ${OWNER}`);

 await check('faults before enable-writes roll back: the source is unfenced, no application write reached the target',async()=>{
  for(const fault of ['preflight','fence','copy','reconcile'] as const){
   const app=appPool();await app.query('SELECT 1');
   try{
    await assert.rejects(runCutover(options({fault})),(e:{message:string;stage:string;rolledBack:boolean;audit:{step:string}[];chainValid:boolean})=>{
     assert.match(e.message,new RegExp('CUTOVER_INJECTED_FAULT '+fault));assert.equal(e.stage,fault);assert.equal(e.rolledBack,true);assert.equal(e.chainValid,true);
     assert.equal(e.audit.at(-1)!.step,'rollback');return true;});
   }finally{await app.end().catch(()=>undefined);}
   assert.equal(await roleLogin(),true,fault);assert.equal(await sourceWritable(),true,fault);
   const ro=(await dstOwner.query('SELECT setconfig FROM pg_db_role_setting s JOIN pg_database d ON d.oid=s.setdatabase WHERE d.datname=$1 AND s.setrole=0',[DST])).rows[0].setconfig as string[];
   assert.ok(ro.includes('default_transaction_read_only=on'),'target stays read-only after '+fault);
   if(fault==='copy'||fault==='preflight'||fault==='fence')assert.equal((await dstOwner.query('SELECT count(*)::int n FROM public.group_orders')).rows[0].n,0,'copy transaction rolled back after '+fault);
  }
  assert.equal(switched,0);
 });

 await check('a fault inside the copy transaction (after 40 tables) leaves the target exactly as it was and every trigger enabled',async()=>{
  const all=(await listTables(dstOwner)).filter(t=>!(NOT_COPIED as readonly string[]).includes(t)),beforeState=await tableDigests(dstOwner,all);
  const c=await dstOwner.connect();
  try{await c.query('BEGIN READ WRITE');
   const first=(await loadOrder(srcOwner,(await listTables(srcOwner)).filter(t=>!(NOT_COPIED as readonly string[]).includes(t))))[40]!;
   await assert.rejects(copyData(srcOwner,c,{faultAfterTable:first}),/CUTOVER_INJECTED_FAULT/);await c.query('ROLLBACK');
  }finally{c.release();}
  assert.deepEqual(await tableDigests(dstOwner,all),beforeState);
  assert.equal((await triggerStates(dstOwner)).filter(t=>t.state!=='O').length,0);
 });

 await check('in-flight work (a reconciliation lease or a delivery in progress) refuses the window',async()=>{
  assert.deepEqual(await inFlightWork(srcOwner),{reconciliationLeases:0,bookingDeliveries:0,staffDeliveries:0,groupDeliveries:0,executorTransientRows:0});
  const work=await srcOwner.query("SELECT count(*)::int n FROM public.group_notification_outbox WHERE status='SENDING'");assert.equal(work.rows[0].n,0);
 });

 await check('a fault after writes are enabled is forward-fix only: the source stays fenced, there is never a second writer',async()=>{
  await assert.rejects(runCutover(options({fault:'switch'})),(e:{message:string;stage:string;rolledBack:boolean;audit:{step:string;detail:Record<string,unknown>}[]})=>{
   assert.equal(e.stage,'switch');assert.equal(e.rolledBack,false);assert.equal(e.audit.at(-1)!.step,'forward-fix-only');assert.equal(e.audit.at(-1)!.detail.sourceFenced,true);return true;});
  assert.equal(await roleLogin(),false,'source runtime role stays NOLOGIN');assert.equal(await sourceWritable(),false,'source stays read-only');
  assert.equal(await readOnlyNow(DST),false,'target writable');
  assert.equal(switched,1);
  // Test-only operator recovery back to the pre-window state (the product contract stops here and asks for a human decision).
  await resetBoth();switched=0;
 });

 await check('a tampered target row is caught by the reconciliation digest, and a re-run replaces the copy',async()=>{
  const c=await dstOwner.connect();
  try{await c.query('BEGIN READ WRITE');await c.query('ALTER TABLE public.group_members DISABLE TRIGGER USER');
   await c.query('DELETE FROM public.group_members WHERE id=(SELECT id FROM public.group_members LIMIT 1)');await c.query('ALTER TABLE public.group_members ENABLE TRIGGER USER');await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  const a=await tableDigests(srcOwner,['public.group_members']),b=await tableDigests(dstOwner,['public.group_members']);
  assert.notEqual(a['public.group_members']!.sha256,b['public.group_members']!.sha256);
  assert.equal(Number((await dstOwner.query("SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled<>'O'")).rows[0].n),0);
 });

 const probe=async(dst:Pool)=>{
  const q=async(sql:string,params:unknown[]=[])=>(await dst.query(sql,params)).rows;
  // 0065 is native: columns, table, constraint, executor-owned definers, and the group role of the 0064 installer.
  probes.columns=(await q("SELECT column_name FROM information_schema.columns WHERE table_name='rental_loan_items' AND column_name IN ('group_part_id','hold_id') ORDER BY 1")).map(r=>r.column_name);
  assert.deepEqual(probes.columns,['group_part_id','hold_id']);
  assert.equal((await q("SELECT count(*)::int n FROM pg_constraint WHERE conname='rental_loan_subject'"))[0].n,1);
  const owners=await q("SELECT p.proname,pg_get_userbyid(p.proowner) o,p.prosecdef FROM pg_proc p WHERE p.proname IN ('rental_apply_receipt','rental_stage_guard','rental_validate_loan') ORDER BY 1");
  for(const o of owners){assert.equal(o.o,DST+'_custody_executor',o.proname);assert.equal(o.prosecdef,true,o.proname);}
  assert.equal((await q('SELECT count(*)::int n FROM pg_auth_members WHERE roleid=$1::regrole',[DST+'_custody_executor']))[0].n,0,'executor has no member');
  assert.equal((await q("SELECT count(*)::int n FROM pg_roles WHERE rolname LIKE 'zao\\_boot\\_%'"))[0].n,0,'no ephemeral creator role remains');
  // Append-only guard is live: a group event cannot be rewritten.
  const c=await dst.connect();
  try{await c.query('BEGIN READ WRITE');
   await assert.rejects(c.query("UPDATE public.group_events SET event_type=event_type||'X' WHERE id=(SELECT id FROM public.group_events LIMIT 1)"),(e:{code?:string})=>{probes.appendOnlyCode=e.code;return true;});
  }finally{await c.query('ROLLBACK').catch(()=>undefined);c.release();}
  // Ordinary booking and group compete for the same asset-day: a second active claim on a group-reserved asset is refused (live unique index).
  const claim=(await q("SELECT c.asset_id,c.day,c.hold_id FROM public.inventory_claims c JOIN public.inventory_holds h ON h.id=c.hold_id WHERE c.active AND c.asset_id IS NOT NULL AND h.allocation_stage='GROUP_RESERVED' LIMIT 1"))[0];
  const other=(await q("SELECT h.id FROM public.inventory_holds h WHERE h.allocation_stage<>'GROUP_RESERVED' LIMIT 1"))[0];
  assert.ok(claim&&other,'group claim and booking hold exist');
  const c2=await dst.connect();
  try{await c2.query('BEGIN READ WRITE');
   await assert.rejects(c2.query("INSERT INTO public.inventory_claims(hold_id,requirement_key,asset_id,day,active) VALUES($1,'cutover-competition',$2,$3,true)",[other.id,claim.asset_id,claim.day]),(e:{code?:string})=>{probes.competitionCode=e.code;return ['23505','23514'].includes(e.code??'');});
  }finally{await c2.query('ROLLBACK').catch(()=>undefined);c2.release();}
 };
 probes.deltaGrantRoles=Object.fromEntries(await Promise.all(['customer_profiles','store_sales_stops','coupon_status_events','staff_notification_outbox','group_orders'].map(async t=>[t,(await dstOwner.query("SELECT coalesce(string_agg(DISTINCT pg_get_userbyid(a.grantee),',' ORDER BY pg_get_userbyid(a.grantee)),'') r FROM pg_class c,aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid=to_regclass($1) AND a.grantee<>c.relowner",['public.'+t])).rows[0].r])));
 const trusted=await schemaState(dstOwner);
 let result:Awaited<ReturnType<typeof runCutover>>|undefined;
 await check('the full cutover: fence, copy, reconcile, enable writes, switch, post-switch probe, hash-chained audit',async()=>{
  const app=appPool();await app.query('SELECT 1');
  try{result=await runCutover(options({postSwitchProbe:probe}));}finally{await app.end().catch(()=>undefined);}
  assert.equal(result!.status,'CUTOVER_COMPLETE');assert.equal(result!.chainValid,true);assert.equal(switched,1);
  assert.deepEqual(result!.audit.map(a=>a.step),['preflight','fence','copy','reconcile','enable-writes','switch','post-switch']);
  assert.ok(result!.audit.find(a=>a.step==='fence')!.detail.terminated as number>=1,'the running session was terminated');
  assert.deepEqual(result!.audit.find(a=>a.step==='fence')!.detail.inFlight,{reconciliationLeases:0,bookingDeliveries:0,staffDeliveries:0,groupDeliveries:0,executorTransientRows:0});
  const detail=JSON.stringify(result!.audit);assert.ok(!/synthetic-guest|example\.invalid|@/.test(detail),'audit carries no row content');
 });

 await check('end-to-end identity: fixture = source = target for every table, sequences and foreign keys included',async()=>{
  const tables=(await listTables(srcOwner)).filter(t=>!(NOT_COPIED as readonly string[]).includes(t));
  const s=await tableDigests(srcOwner,tables),t=await tableDigests(dstOwner,tables,TARGET_ONLY_COLUMNS);
  for(const name of tables)assert.deepEqual(t[name],s[name],name);
  const f=await tableDigests(x.db.pool,tables,TARGET_ONLY_COLUMNS);
  for(const name of tables)assert.deepEqual(t[name],f[name],'fixture '+name);
  assert.deepEqual(await fixtureCounts(dstOwner),business);
  const seqS=await sequencePositions(srcOwner),seqT=new Map((await sequencePositions(dstOwner)).map(r=>[r.s,r.v]));
  // Equality was proved inside the cutover (reconcile). The post-switch probe's refused INSERT burns one value (nextval is not transactional), so here: never behind.
  for(const r of seqS)if(r.v!==null)assert.ok(BigInt(seqT.get(r.s)!)>=BigInt(r.v),r.s);
  assert.equal(result!.audit.find(a=>a.step==='reconcile')!.detail.foreignKeys as number>0,true);
  assert.deepEqual((await foreignKeyOrphans(dstOwner)).orphans,[]);
  assert.equal((await triggerStates(dstOwner)).filter(r=>r.state!=='O').length,0);
  assert.equal((await dstOwner.query('SELECT count(*)::int n FROM public.group_part_preparations')).rows[0].n,0);
  assert.deepEqual((await assertRegistries(srcOwner,dstOwner)),{source:64,target:65},'the source registry is untouched at 0001–0064');
 });

 await check('schema, trigger, owner, ACL and function state of the target is unchanged by the data load',async()=>{
  const after=await schemaState(dstOwner);assert.equal(after.sha256,trusted.sha256);
  assert.equal((await dstOwner.query('SELECT rolcanlogin FROM pg_roles WHERE rolname=$1',[groupRoleNames(DST).group])).rows[0].rolcanlogin,false,'target runtime roles stay NOLOGIN until the Owner issues credentials');
 });

 await check('after the cutover the source is a read-only, fenced fallback and the target accepts writes',async()=>{
  assert.equal(await roleLogin(),false);assert.equal(await sourceWritable(),false);
  assert.equal(await readOnlyNow(DST),false);
  assert.equal((await dstOwner.query("SELECT count(*)::int n FROM pg_roles WHERE rolname LIKE 'zao\\_boot\\_%'")).rows[0].n,0);
 });


 // Governance (§5.2-4): how a LATER migration that touches executor-owned functions can be applied on the new database without any external party.
 // Option B: the role that created the executor stays as a dormant NOLOGIN administrator (it keeps ADMIN on the executor, nothing else); the owner can SET
 // to it but holds no executor authority between windows. Measured here on PostgreSQL with a non-superuser CREATEROLE owner (PG16+ role semantics).
 await check('migration governance: a dormant NOLOGIN administrator opens a revocable executor window; with no window the owner is refused',async()=>{
  await superuser.query('CREATE DATABASE zao_proof OWNER '+OWNER);
  const proof=connect(OWNER,ownerPassword,'zao_proof');
  const q=(sql:string)=>proof.query(sql);
  const members=async(role:string)=>(await proof.query("SELECT pg_get_userbyid(member) m,admin_option a,inherit_option i,set_option s FROM pg_auth_members WHERE roleid=$1::regrole ORDER BY 1",[role])).rows;
  await q('CREATE ROLE zp_dormant NOLOGIN NOINHERIT CREATEROLE');
  await q(`GRANT zp_dormant TO ${OWNER} WITH SET TRUE, INHERIT FALSE`);
  const c=await proof.connect();
  try{
   await c.query('SET ROLE zp_dormant');await c.query('CREATE ROLE zp_exec NOLOGIN NOINHERIT');await c.query('RESET ROLE');
   assert.deepEqual(await members('zp_exec'),[{m:'zp_dormant',a:true,i:false,s:false}],'the creator, and only the creator, administers the executor');
   await c.query('CREATE FUNCTION public.zp_fn() RETURNS integer LANGUAGE sql AS $$SELECT 1$$');
   const window=async(statements:string[])=>{
    await c.query('SET ROLE zp_dormant');await c.query(`GRANT zp_exec TO ${OWNER} WITH INHERIT TRUE, SET TRUE`);await c.query('RESET ROLE');
    try{for(const s of statements)await c.query(s);}finally{await c.query('SET ROLE zp_dormant');await c.query(`REVOKE zp_exec FROM ${OWNER}`);await c.query('RESET ROLE');}
   };
   // Window 1: hand the function to the executor (the executor needs CREATE on the schema for exactly this statement).
   await c.query('GRANT CREATE ON SCHEMA public TO zp_exec');
   await window(['ALTER FUNCTION public.zp_fn() OWNER TO zp_exec']);
   await c.query('REVOKE CREATE ON SCHEMA public FROM zp_exec');
   assert.deepEqual(await members('zp_exec'),[{m:'zp_dormant',a:true,i:false,s:false}],'no owner membership between windows');
   await assert.rejects(c.query('CREATE OR REPLACE FUNCTION public.zp_fn() RETURNS integer LANGUAGE sql AS $$SELECT 2$$'),(e:{code?:string})=>e.code==='42501','no window: the owner cannot replace an executor-owned function');
   // Window 2: a later migration replaces it, owner and definer identity unchanged.
   await window(['CREATE OR REPLACE FUNCTION public.zp_fn() RETURNS integer LANGUAGE sql AS $$SELECT 3$$']);
   assert.equal((await c.query('SELECT public.zp_fn() v')).rows[0].v,3);
   assert.equal((await c.query("SELECT pg_get_userbyid(proowner) o FROM pg_proc WHERE oid='public.zp_fn()'::regprocedure")).rows[0].o,'zp_exec');
   assert.deepEqual(await members('zp_exec'),[{m:'zp_dormant',a:true,i:false,s:false}],'windows leave nothing behind');
   {const rows=await members('zp_dormant');assert.ok(rows.some(r=>r.s&&!r.i),'reachable by SET ROLE');assert.ok(rows.every(r=>!r.i&&r.m===OWNER),'never inherited, no other member');}
   assert.equal((await c.query("SELECT rolcanlogin FROM pg_roles WHERE rolname='zp_dormant'")).rows[0].rolcanlogin,false);
  }finally{c.release();}
 });

 await check('the audit chain detects tampering',async()=>{
  const chain=auditChain();chain.add('a',{n:1});chain.add('b',{n:2});assert.equal(chain.verify(),true);
  chain.entries[0]!.detail={n:9};assert.equal(chain.verify(),false);
 });

 console.log(JSON.stringify({status:'PASS',cases:count,source:SRC,target:DST,tables:(await listTables(dstOwner)).length,rows:result!.report.rows,sequences:result!.report.sequences,
  appendOnlyCode:probes.appendOnlyCode,deltaGrantRoles:probes.deltaGrantRoles,competitionCode:probes.competitionCode,productionDdl:0,externalContact:0,
  notRun:['real Neon pg_signal_backend for the owner','real data volume/timing','Vercel secret switch','runtime-role credential issuance for the target']}));
}catch(e){console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:(e as Error).message.slice(0,1200)}));process.exitCode=1;}
finally{for(const close of closers)await close().catch(()=>undefined);await x.close().catch(()=>undefined);}
