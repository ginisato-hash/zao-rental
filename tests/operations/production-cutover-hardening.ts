// Cutover HARDENING (Issue #47 / TD #7219973419 §2-C/§2-D): lossless copy, exact sequence state, partial-fence/crash/lost-reply recovery from the REAL database state,
// exclusive locks, rollback only when the target is provably untouched, full privilege comparison, the dormant migration administrator and a real later migration through
// its window. Disposable PostgreSQL, synthetic data only. No Production, no Neon, no Vercel, no external party.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {groupFixture} from '../group/fixture';
import {requestFor} from '../inventory/fixture';
import {trackPoolLifecycle} from '../../scripts/pool-lifecycle';
import {productionFoundationPlan,runFoundationPlan} from '../../scripts/production-bootstrap';
import {copyData,fenceSource,readFenceState,readWrite,sequenceStates,tableDigests,MAX_TABLE_ROWS} from '../../scripts/production-cutover';
import {groupRoleNames} from '../../scripts/production-group-delta';
import {closeMigrationWindow,openMigrationWindow,runInMigrationWindow,windowState} from '../../scripts/production-migration-window';
import {auditChain} from '../../scripts/production-cutover';
import {bootstrapTarget,copyAndSwitch,preflight,recover,rollback,verifyTarget,type RunConfig,type RunPorts} from '../../scripts/production-cutover-run';
import type {CutoverFault} from '../../scripts/production-cutover';

const SRC='neondb',DST='neondb_next',OWNER='neondb_owner';
const SOURCE_ONLY={'public.rental_loan_items':['group_part_id','hold_id']};
let stage='setup',count=0;const closers:Array<()=>Promise<void>>=[];
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const code=(re:RegExp)=>(e:unknown)=>{assert.match(String((e as Error).message),re);return true;};
const root=mkdtempSync(join(tmpdir(),'zao-cutover-hard-'));
const x=await groupFixture(20);
try{
 const superPassword=(x.db.pool.options as {password:string}).password,ownerPassword=randomBytes(18).toString('hex'),port=x.db.identity.dbPort;
 const connect=(user:string,password:string,database:string)=>{const p=new Pool({host:'127.0.0.1',port,user,password,database,max:4});p.on('error',()=>undefined);closers.push(trackPoolLifecycle(p));return p;};
 const superuser=connect(x.db.identity.user,superPassword,x.db.identity.database);
 await superuser.query('CREATE ROLE synthetic_neon_superuser NOLOGIN CREATEDB CREATEROLE BYPASSRLS');
 await superuser.query('GRANT pg_read_all_data,pg_write_all_data TO synthetic_neon_superuser WITH ADMIN OPTION');
 await superuser.query(`CREATE ROLE ${OWNER} LOGIN NOSUPERUSER CREATEDB CREATEROLE INHERIT PASSWORD '${ownerPassword}'`);
 await superuser.query(`GRANT synthetic_neon_superuser TO ${OWNER}`);
 await superuser.query(`GRANT pg_signal_backend TO ${OWNER}`);

 // ===================================================================== D: lossless copy and exact sequence state (scratch databases, one table, no application schema)
 await check('the copy is lossless: bigint beyond 2^53, high-precision numeric, microsecond timestamps, bytea, jsonb and floats keep every digit; digests are equal',async()=>{
  for(const db of ['zl_src','zl_dst'])await superuser.query(`CREATE DATABASE ${db} OWNER ${OWNER}`);
  const a=connect(OWNER,ownerPassword,'zl_src'),b=connect(OWNER,ownerPassword,'zl_dst');
  const ddl=`CREATE TABLE public.t(id bigint PRIMARY KEY,n numeric(38,12) NOT NULL,ts timestamptz NOT NULL,f double precision NOT NULL,r real NOT NULL,raw bytea NOT NULL,j jsonb NOT NULL,txt text NOT NULL,d date NOT NULL,iv interval NOT NULL);
   CREATE SEQUENCE public.s_never;CREATE SEQUENCE public.s_called;CREATE SEQUENCE public.s_reset START 5;`;
  await a.query(ddl);await b.query(ddl);
  const rows:Array<[string,string,string,number,number,string,string,string,string,string]>=[
   ['9007199254740993','12345678901234567890123456.123456789012','2035-03-03 12:34:56.123456+09',0.1+0.2,1.1,'\\xdeadbeef','{"big":12345678901234567890,"nested":{"x":[1,2.50,null]}}','日本語 \u0000x'.replace('\u0000',''),'2035-03-03','1 day 02:03:04.567891'],
   ['9223372036854775807','0.000000000001','1999-12-31 23:59:59.999999+00',1e308,3.4e38,'\\x00','{}','','2035-12-31','-3 mons'],
   ['-9223372036854775808','-99999999999999999999999999.999999999999','2035-03-04 00:00:00+00',-0.0,1e-30,'\\x','[]','quote\'s "q" \\ back','2000-02-29','0'],
  ];
  for(const r of rows)await a.query('INSERT INTO public.t VALUES($1,$2,$3,$4,$5,$6::bytea,$7::jsonb,$8,$9,$10::interval)',r);
  await a.query("SELECT nextval('public.s_called')");await a.query("SELECT setval('public.s_reset',17,false)");
  const c=await b.connect();
  try{await c.query('BEGIN');const rep=await copyData(a,c,{batch:2});await c.query('COMMIT');assert.equal(rep.rows,3);assert.equal(rep.sequences,1,'one sequence has been called');assert.equal(rep.sequencesUnused,2);}
  catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  const dump=async(p:Pool)=>(await p.query('SELECT id::text,n::text,ts::text,f::text,r::text,encode(raw,\'hex\') h,j::text,txt,d::text,iv::text FROM public.t ORDER BY id')).rows;
  assert.deepEqual(await dump(b),await dump(a),'every value is byte-identical as text (a JavaScript number round trip would have rounded the bigint and the numeric)');
  assert.deepEqual(await tableDigests(b,['public.t']),await tableDigests(a,['public.t']));
  const sa=await sequenceStates(a),sb=await sequenceStates(b);assert.deepEqual(sb,sa,'last_value AND is_called are identical');
  const by=Object.fromEntries(sb.map(r=>[r.s,r]));
  assert.equal(by['public.s_never']!.c,false);assert.equal(by['public.s_called']!.c,true);assert.equal(by['public.s_reset']!.v,'17');assert.equal(by['public.s_reset']!.c,false,'setval(..,false) is preserved: the next value is exactly 17');
  assert.equal((await b.query("SELECT nextval('public.s_reset')::text v")).rows[0].v,'17');
  assert.equal((await b.query("SELECT nextval('public.s_never')::text v")).rows[0].v,'1');
  assert.equal((await b.query("SELECT nextval('public.s_called')::text v")).rows[0].v,'2');
 });

 await check('memory is bounded: rows are read through a server-side cursor in batches, and a table above the row limit is refused (never silently truncated)',async()=>{
  const a=connect(OWNER,ownerPassword,'zl_src'),b=connect(OWNER,ownerPassword,'zl_dst');
  await a.query("INSERT INTO public.t SELECT g,g,'2035-01-01+00',1,1,'\\x01','{}','x','2035-01-01','1 day' FROM generate_series(1,40) g");
  let batches=0;const c=await b.connect();
  try{await c.query('BEGIN');const rep=await copyData(a,c,{batch:7});await c.query('COMMIT');assert.equal(rep.rows,43);batches=Math.ceil(43/7);assert.ok(batches>=7);}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  assert.equal(Number((await b.query('SELECT count(*)::int n FROM public.t')).rows[0].n),43);
  const c2=await b.connect();
  try{await c2.query('BEGIN');await assert.rejects(copyData(a,c2,{maxRows:10}),code(/CUTOVER_TABLE_TOO_LARGE public\.t 43/));}finally{await c2.query('ROLLBACK').catch(()=>undefined);c2.release();}
  assert.ok(MAX_TABLE_ROWS>=1_000_000,'the production limit is far above the measured 163-table / 11 MB database');
 });

 // ===================================================================== Production-shaped source (0001–0064) and runner harness
 stage='source fixture';
 await superuser.query(`CREATE DATABASE ${SRC} OWNER ${OWNER}`);
 const srcOwner=connect(OWNER,ownerPassword,SRC);
 const confirmed=await x.draft(undefined,requestFor('2035-03-03'),{reason:'SYNTHETIC hardening fixture'});await x.service.startPayment(confirmed.booking.id,randomUUID());
 const token=await x.entrance();
 await x.start(token,'SYNTHETIC draft group');await x.held(token,2,'SYNTHETIC held group');
 const srcPlan=await productionFoundationPlan(SRC);
 await runFoundationPlan(srcOwner,{...srcPlan,bootstrap:{...srcPlan.bootstrap,entries:srcPlan.bootstrap.entries.slice(0,64)}});
 {const c=await srcOwner.connect();try{await c.query('BEGIN');await copyData(x.db.pool,c,{ignoreSourceOnly:SOURCE_ONLY});await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 const manager=srcPlan.roles.managerRole,operations=groupRoleNames(SRC).operations,pricing=SRC+'_pricing';
 // two runtime roles can log in, so that a fence interrupted after the FIRST role is genuinely partial
 {const c=await srcOwner.connect();try{await c.query(`SET ROLE ${manager}`);await c.query(`ALTER ROLE ${operations} LOGIN PASSWORD '${ownerPassword}'`);await c.query(`ALTER ROLE ${pricing} LOGIN PASSWORD '${ownerPassword}'`);await c.query('RESET ROLE');}finally{c.release();}}
 const FIXTURE_ONLY_GRANTS=(l:string)=>l.includes('@db@_group')||/\|public\.(staff_order_drafts|rental_terms_|customer_|coupon_|store_sales_|staff_notification)|^function\|(coupon_|customer_|staff_|store_sales_)|^relation\|public\.rental_terms_acceptances\|neondb_owner/.test(l);
 let fault:CutoverFault|undefined;
 const config=(over:Partial<RunConfig>={}):RunConfig=>({source:SRC,target:DST,owner:OWNER,allowedTargets:[DST],root,fenceWaitMs:800,...over});
 const ports=():RunPorts=>({config:config(),release:()=>'a'.repeat(40),now:()=>new Date(),aclAllowed:FIXTURE_ONLY_GRANTS,...(fault?{fault}:{}),
  openOwner:async database=>{const pool=new Pool({host:'127.0.0.1',port,user:OWNER,password:ownerPassword,database,max:4});pool.on('error',()=>undefined);return{pool,close:async()=>{await pool.end().catch(()=>undefined);}};}});
 const statePath=join(root,'.local/evidence/production-cutover/state.json'),lockPath=join(root,'.local/evidence/production-cutover/lock');
 const state=()=>JSON.parse(readFileSync(statePath,'utf8')) as {phase:string;writes?:string;sourceLoginRoles:string[];sourceDbSetting?:string|null;sourceFence?:{wasLogin:string[];dbSetting:string|null};dormantAdminRole?:string;recoveryReason?:string};
 const srcSetting=async()=>(await readFenceState(srcOwner,SRC,[operations,pricing]));
 const dst=()=>connect(OWNER,ownerPassword,DST);
 type Rec=Record<string,unknown>;
 const recoverNow=async()=>(await recover(ports())) as Rec;
 const sessionOf=(role:string)=>{const p=new Pool({host:'127.0.0.1',port,user:role,password:ownerPassword,database:SRC,max:1});p.on('error',()=>undefined);return p;};
 const sourceRestored=async(label:string)=>{const s=await srcSetting();assert.deepEqual(s.loginRoles.sort(),[operations,pricing].sort(),label+': both runtime roles can log in again');assert.equal(s.dbSetting,null,label+': the database default is back to what it was');};
 const stateBefore=async()=>{await preflight(ports());await bootstrapTarget(ports());assert.equal(state().phase,'TARGET_BOOTSTRAPPED');};
 await stateBefore();

 // ===================================================================== C: failure injection
 await check('PARTIAL FENCE: the fence is interrupted after the first role was made NOLOGIN; the exact snapshot is restored and READ BACK (both roles log in, default untouched)',async()=>{
  fault='fence-partial';
  await assert.rejects(copyAndSwitch(ports()),(e:{message:string;rolledBack:boolean;recoveryRequired:boolean;stage:string})=>{
   assert.match(e.message,/PRODUCTION_CUTOVER_INJECTED_FAULT/);assert.equal(e.stage,'fence');assert.equal(e.rolledBack,true,'rolled back only because the restore was proven');assert.equal(e.recoveryRequired,false);return true;});
  fault=undefined;await sourceRestored('partial fence');assert.equal(state().phase,'TARGET_BOOTSTRAPPED');assert.equal(state().writes,'NEVER');
  assert.ok(!existsSync(lockPath),'the lock is released after a failure');
 });

 await check('RECOVERY_REQUIRED: when the restore itself cannot be proven, nothing claims a rollback; the real database stays fenced; `recover` then restores it from the real state',async()=>{
  fault='unfence-fails';
  await assert.rejects(copyAndSwitch(ports()),(e:{message:string;rolledBack:boolean;recoveryRequired:boolean})=>{assert.equal(e.rolledBack,false,'no rollback is claimed');assert.equal(e.recoveryRequired,true);return true;});
  fault=undefined;
  assert.equal(state().phase,'RECOVERY_REQUIRED');assert.equal(state().recoveryReason,'SOURCE_UNFENCE_UNVERIFIED');
  const fenced=await srcSetting();assert.deepEqual(fenced.loginRoles,[],'the source really is still fenced');assert.equal(fenced.dbSetting,'on');
  assert.ok(state().sourceFence&&state().sourceFence!.wasLogin.length===2,'the pre-fence snapshot was persisted BEFORE the fence');
  await assert.rejects(preflight(ports()),code(/PHASE_REFUSED_RECOVERY_REQUIRED/),'nothing else may run while recovery is required');
  await assert.rejects(copyAndSwitch(ports()),code(/PHASE_REFUSED_RECOVERY_REQUIRED/));
  const r=await recoverNow();
  assert.equal(r.status,'CUTOVER_RECOVERED_ROLLED_BACK');assert.equal(r.sourceFenced,true);assert.equal(r.targetReadOnly,true,'the target never became writable, so going back is safe even though it holds no copy');
  await sourceRestored('recover');assert.equal(state().phase,'TARGET_BOOTSTRAPPED');
  assert.equal((await recoverNow()).status,'CUTOVER_NOTHING_TO_RECOVER');
 });

 await check('CRASH MID-WINDOW: the process dies after the fence (state WINDOW_OPEN, source fenced, pre-existing database default "off"); `recover` restores exactly that snapshot, not a blind RESET',async()=>{
  await readWrite(srcOwner,[`ALTER DATABASE ${SRC} SET default_transaction_read_only=off`]);
  const st=state();
  writeFileSync(statePath,JSON.stringify({...st,phase:'WINDOW_OPEN',writes:'NEVER',sourceLoginRoles:[operations,pricing],sourceDbSetting:'off'}),{mode:0o600});
  // the fence ran, and the process was killed before anything else was recorded
  await fenceSource(srcOwner,SRC,[operations,pricing],{managerRole:manager,waitMs:800});
  assert.deepEqual((await srcSetting()).loginRoles,[]);
  const r=await recoverNow();
  assert.equal(r.status,'CUTOVER_RECOVERED_ROLLED_BACK');
  const s=await srcSetting();assert.deepEqual(s.loginRoles.sort(),[operations,pricing].sort());assert.equal(s.dbSetting,'off','the previous default value is restored, not removed');
  await readWrite(srcOwner,[`ALTER DATABASE ${SRC} RESET default_transaction_read_only`]);
  assert.equal(state().phase,'TARGET_BOOTSTRAPPED');
 });

 await check('COMMIT REPLY LOST: the copy committed on the target but the window failed afterwards; the target is still read-only, the source is restored, and a re-run replaces the copy and completes',async()=>{
  fault='copy-commit-lost';
  await assert.rejects(copyAndSwitch(ports()),(e:{rolledBack:boolean})=>{assert.equal(e.rolledBack,true);return true;});
  fault=undefined;
  await sourceRestored('commit lost');
  const t=dst();
  assert.ok(Number((await t.query('SELECT count(*)::int n FROM public.rental_bookings')).rows[0].n)>0,'the committed copy is really there');
  assert.equal((await readFenceState(t,DST,[])).dbSetting,'on','but the target never became writable');
 });

 await check('LOST ENABLE-WRITES REPLY: the read-only default WAS lifted although the call failed; the outcome is read back and judged forward-fix-only (never a false rollback)',async()=>{
  fault='enable-writes-lost';
  await assert.rejects(copyAndSwitch(ports()),(e:{rolledBack:boolean;recoveryRequired:boolean;message:string})=>{assert.equal(e.rolledBack,false,'no rollback is claimed once the lift happened');return true;});
  fault=undefined;
  assert.equal(state().phase,'FORWARD_FIX_ONLY');assert.equal(state().writes,'ENABLED','the readback proved the lift: the file records what the database showed');
  assert.deepEqual((await srcSetting()).loginRoles,[],'the source stays fenced: never two writers');
  assert.equal((await readFenceState(dst(),DST,[])).dbSetting,null,'the target really is writable');
  // Nothing wrote to the target and nobody is connected, so `recover` can PROVE going back is safe: data and every sequence equal the frozen source.
  const r=await recoverNow();
  assert.equal(r.status,'CUTOVER_RECOVERED_ROLLED_BACK');assert.equal(r.targetUntouched,true);assert.equal(r.targetReadOnly,false);
  await sourceRestored('lost enable-writes');
  assert.equal((await readFenceState(dst(),DST,[])).dbSetting,'on','the target is read-only again');
 });

 await check('TARGET WRITTEN: once the target carries any write (here a sequence advance), recover refuses to go back — forward-fix only, source stays fenced, no success claimed',async()=>{
  fault='enable-writes-lost';
  await assert.rejects(copyAndSwitch(ports()),(e:{rolledBack:boolean})=>{assert.equal(e.rolledBack,false);return true;});
  fault=undefined;
  const t=dst();const seq=(await t.query("SELECT schemaname||'.'||sequencename s FROM pg_sequences WHERE last_value IS NOT NULL LIMIT 1")).rows[0].s as string;
  await readWrite(t,[`SELECT nextval('${seq}')`]);
  const r=await recoverNow();
  assert.equal(r.status,'CUTOVER_FORWARD_FIX_ONLY');assert.equal(r.reason,'TARGET_MAY_HOLD_WRITES');assert.equal(r.targetUntouched,false);
  assert.deepEqual((await srcSetting()).loginRoles,[],'never unfenced while the target may hold writes');assert.equal(state().phase,'FORWARD_FIX_ONLY');
  await assert.rejects(rollback(ports()),code(/ROLLBACK_PHASE_REFUSED_FORWARD_FIX_ONLY/));
  // test-only operator reset to continue the rehearsal (the product stops here and asks for a human decision)
  const src0=(await sequenceStates(srcOwner)).find(q=>q.s===seq)!;await readWrite(t,[`SELECT setval('${seq}',${src0.v},${src0.c})`]);
  const again=await recoverNow();assert.equal(again.status,'CUTOVER_RECOVERED_ROLLED_BACK','after the operator restored the sequence the target is provably untouched again');
  await sourceRestored('target written');
 });

 await check('EXCLUSIVE: a second mutating command is refused by the file lock (live other process) and by the database advisory lock, and both are released afterwards',async()=>{
  mkdirSyncSafe();writeFileSync(lockPath,JSON.stringify({pid:process.ppid,at:new Date().toISOString()}),{mode:0o600});
  await assert.rejects(copyAndSwitch(ports()),code(/PRODUCTION_CUTOVER_LOCKED$/));
  rmSync(lockPath);
  const holder=await srcOwner.connect();
  try{
   await holder.query('SELECT pg_advisory_lock(71820402)');
   await assert.rejects(copyAndSwitch(ports()),code(/PRODUCTION_CUTOVER_LOCKED_DB/));
   assert.ok(!existsSync(lockPath),'the file lock is released even when the database lock was refused');
   await sourceRestored('locked');assert.equal(state().phase,'TARGET_BOOTSTRAPPED','a refused run changed nothing');
  }finally{await holder.query('SELECT pg_advisory_unlock(71820402)').catch(()=>undefined);holder.release();}
  // a dead holder is taken over once (stale lock): the run proceeds to the injected pre-window fault instead of being refused
  writeFileSync(lockPath,JSON.stringify({pid:2147480000,at:new Date().toISOString()}),{mode:0o600});
  fault='preflight';
  await assert.rejects(copyAndSwitch(ports()),code(/PRODUCTION_CUTOVER_INJECTED_FAULT/));fault=undefined;
  assert.ok(!existsSync(lockPath));await sourceRestored('stale lock');
 });
 function mkdirSyncSafe(){if(!existsSync(join(root,'.local/evidence/production-cutover')))throw new Error('state directory missing');}

 await check('THE WINDOW RE-CHECKS IN-FLIGHT WORK BEFORE STOPPING ANYTHING: a delivery in progress refuses the window with nothing fenced',async()=>{
  const row=(await srcOwner.query("SELECT id FROM public.group_notification_outbox LIMIT 1")).rows[0];
  assert.ok(row,'the fixture has a group notification outbox row to mark in flight');
  await readWrite(srcOwner,[`ALTER TABLE public.group_notification_outbox DISABLE TRIGGER USER`,`UPDATE public.group_notification_outbox SET status='SENDING',claim_id=gen_random_uuid(),claim_until=clock_timestamp()+interval '5 minutes' WHERE id='${row.id}'`,`ALTER TABLE public.group_notification_outbox ENABLE TRIGGER USER`]);
  const sending=Number((await srcOwner.query("SELECT count(*)::int n FROM public.group_notification_outbox WHERE status='SENDING'")).rows[0].n);
  assert.ok(sending>0,'a delivery is genuinely in flight');
  const app=sessionOf(operations);await app.query('SELECT 1');
  try{
   await assert.rejects(copyAndSwitch(ports()),(e:{message:string;rolledBack:boolean})=>{assert.match(e.message,/PRODUCTION_CUTOVER_PREFLIGHT_IN_FLIGHT_WORK/);assert.equal(e.rolledBack,true);return true;});
   assert.equal((await app.query('SELECT 1 v')).rows[0].v,1,'the live application session was never touched');
  }finally{await app.end().catch(()=>undefined);}
  await sourceRestored('in flight');
  await readWrite(srcOwner,[`ALTER TABLE public.group_notification_outbox DISABLE TRIGGER USER`,`UPDATE public.group_notification_outbox SET status='PENDING',claim_id=NULL,claim_until=NULL WHERE id='${row.id}'`,`ALTER TABLE public.group_notification_outbox ENABLE TRIGGER USER`]).catch(()=>undefined);
 });

 // ===================================================================== the full window, privilege comparison, and rollback only when provably untouched
 await check('after the window: full pass is distinct from a structural pass; every privilege of source and target is compared',async()=>{
  const r=await copyAndSwitch(ports());assert.equal(r.status,'CUTOVER_COPIED_AWAITING_OWNER');assert.equal(state().writes,'ENABLED');
  const v=await verifyTarget(ports());
  assert.equal(v.status,'CUTOVER_TARGET_FULLY_VERIFIED');assert.equal(v.fullMatch,true);assert.equal(v.acl.unexpectedDifferences,0);assert.ok(v.acl.sourceLines>1000&&v.acl.targetLines>=v.acl.sourceLines,'thousands of privilege lines were compared');
  // a privilege present only on the source, outside anything 0065 introduces, is caught and fails the verification
  await readWrite(srcOwner,['GRANT SELECT ON public.rental_bookings TO PUBLIC']);
  const bad=await verifyTarget(ports());
  assert.equal(bad.status,'CUTOVER_TARGET_VERIFY_FAILED');assert.ok(bad.acl.unexpectedDifferences>=1);assert.match(bad.acl.unexpectedSample.join(' '),/rental_bookings\|PUBLIC/);
  await readWrite(srcOwner,['REVOKE SELECT ON public.rental_bookings FROM PUBLIC']);
  assert.equal((await verifyTarget(ports())).status,'CUTOVER_TARGET_FULLY_VERIFIED');
  // and the migration administrator posture is part of the structural proof
  assert.equal(v.migrationAdminDormant,true);assert.equal(v.executorMembers,0);assert.equal(v.strayCreatorRoles,0);
 });

 await check('rollback is refused when the target has carried a write even though nobody is logged in (login=0 alone is not the criterion)',async()=>{
  const t=dst();
  await readWrite(t,['ALTER TABLE public.customer_profiles DISABLE TRIGGER USER']).catch(()=>undefined);
  const seq=(await t.query("SELECT schemaname||'.'||sequencename s FROM pg_sequences WHERE last_value IS NOT NULL LIMIT 1")).rows[0].s as string;
  await readWrite(t,['ALTER TABLE public.customer_profiles ENABLE TRIGGER USER']).catch(()=>undefined);
  await readWrite(t,[`SELECT nextval('${seq}')`]);
  await assert.rejects(rollback(ports()),code(/ROLLBACK_REFUSED_TARGET_WRITTEN/));
  assert.deepEqual((await srcSetting()).loginRoles,[],'the source stays fenced');assert.equal(state().phase,'COPIED_AWAITING_OWNER');
  const src=(await sequenceStates(srcOwner)).find(q=>q.s===seq)!;await readWrite(t,[`SELECT setval('${seq}',${src.v},${src.c})`]);
  const ok=await rollback(ports());assert.equal(ok.status,'CUTOVER_ROLLED_BACK');assert.equal(ok.targetProvenUntouched,true);
  await sourceRestored('rollback');
 });

 // ===================================================================== D: the dormant migration administrator and a REAL later migration through its window
 await check('NEXT MIGRATION: executor-owned functions cannot be changed without a window, can through the window, and nothing is left behind (membership, CREATE, posture, audit chain)',async()=>{
  const again=await copyAndSwitch(ports());assert.equal(again.status,'CUTOVER_COPIED_AWAITING_OWNER');
  const t=dst();
  const admin=state().dormantAdminRole!;assert.match(admin,/^zao_boot_[0-9a-f]{16}$/);
  const roles={admin,executor:DST+'_custody_executor',custody:DST+'_custody'};
  const def=(await t.query("SELECT pg_get_functiondef('public.rental_stage_guard'::regproc) d,md5(pg_get_functiondef('public.rental_stage_guard'::regproc)) m")).rows[0] as {d:string;m:string};
  const owned=async()=>(await t.query("SELECT pg_get_userbyid(proowner) o,prosecdef d FROM pg_proc WHERE proname='rental_stage_guard'")).rows[0] as {o:string;d:boolean};
  const replace=async(c:import('pg').PoolClient)=>{await c.query(def.d);};
  // (1) no window: refused
  await assert.rejects(readWrite(t,[def.d]),(e:{code?:string})=>e.code==='42501');
  assert.deepEqual(await windowState(t,roles),{open:false,ownerMembershipOnExecutor:0,executorCreateOnPublic:false});
  // (2) a window: the migration applies, ownership and definer identity are unchanged, the window closes and is proven closed
  const audit=auditChain();
  const run=await runInMigrationWindow(t,roles,replace,audit);
  assert.equal(run.chainValid,true);assert.deepEqual(run.audit.map(a=>a.step),['window-open','migration-applied','window-close']);
  assert.deepEqual(await owned(),{o:DST+'_custody_executor',d:true});
  assert.equal((await t.query("SELECT md5(pg_get_functiondef('public.rental_stage_guard'::regproc)) m")).rows[0].m,def.m,'identical definition re-applied');
  assert.deepEqual(await windowState(t,roles),{open:false,ownerMembershipOnExecutor:0,executorCreateOnPublic:false});
  assert.equal((await verifyTarget(ports())).executorMembers,0);
  // (3) after the window the owner is refused again
  await assert.rejects(readWrite(t,[def.d]),(e:{code?:string})=>e.code==='42501');
  // (4) a failing migration still closes the window
  await assert.rejects(runInMigrationWindow(t,roles,async c=>{await c.query(def.d);throw new Error('SYNTHETIC_MIGRATION_FAILED');}),/SYNTHETIC_MIGRATION_FAILED/);
  assert.deepEqual(await windowState(t,roles),{open:false,ownerMembershipOnExecutor:0,executorCreateOnPublic:false});
  assert.equal((await t.query("SELECT md5(pg_get_functiondef('public.rental_stage_guard'::regproc)) m")).rows[0].m,def.m);
  // (5) refusals: an open window cannot be opened again, a closed one cannot be closed, and the administrator is not usable as an unknown role
  await openMigrationWindow(t,roles);
  await assert.rejects(openMigrationWindow(t,roles),code(/PRODUCTION_MIGRATION_WINDOW_ALREADY_OPEN/));
  await closeMigrationWindow(t,roles);
  await assert.rejects(runInMigrationWindow(t,{...roles,admin:'zao_boot_0000000000000000'},replace),/does not exist|PRODUCTION_MIGRATION_WINDOW|42704/);
  assert.deepEqual(await windowState(t,roles),{open:false,ownerMembershipOnExecutor:0,executorCreateOnPublic:false});
  const posture=(await t.query("SELECT rolcanlogin,rolinherit,rolcreaterole FROM pg_roles WHERE rolname=$1",[admin])).rows[0];assert.deepEqual(posture,{rolcanlogin:false,rolinherit:false,rolcreaterole:true});
  assert.equal(Number((await t.query('SELECT count(*)::int n FROM pg_shdepend d WHERE d.refclassid=\'pg_authid\'::regclass AND d.refobjid=$1::regrole',[admin])).rows[0].n),0,'the administrator owns nothing and holds no privilege');
 });

 console.log(JSON.stringify({status:'PASS',cases:count,source:SRC,target:DST,productionDdl:0,externalContact:0,
  notRun:['real Neon pg_signal_backend for the owner','real data volume/timing','Vercel secret switch and redeploy','target runtime-role LOGIN/password issuance (Owner)']}));
}catch(e){console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:(e as Error).message.slice(0,1500)}));process.exitCode=1;}
finally{for(const close of closers)await close().catch(()=>undefined);await x.close().catch(()=>undefined);rmSync(root,{recursive:true,force:true});}
