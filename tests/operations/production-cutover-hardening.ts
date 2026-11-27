// Cutover HARDENING (Issue #47 / TD #7219973419 §2-C/§2-D): lossless copy, exact sequence state, partial-fence/crash/lost-reply recovery from the REAL database state,
// exclusive locks, rollback only when the target is provably untouched, full privilege comparison, the dormant migration administrator and a real later migration through
// its window. Disposable PostgreSQL, synthetic data only. No Production, no Neon, no Vercel, no external party.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {groupFixture} from '../group/fixture';
import {requestFor} from '../inventory/fixture';
import {trackPoolLifecycle} from '../../scripts/pool-lifecycle';
import {productionFoundationPlan,runFoundationPlan} from '../../scripts/production-bootstrap';
import {aclLines,PLATFORM_EXPLAINED,TARGET_GRANT_PLAN,copyData,fenceSource,readFenceState,readWrite,sequenceStates,tableDigests,unfenceSource,readActivationMarker,MAX_TABLE_ROWS} from '../../scripts/production-cutover';
import {groupRoleNames} from '../../scripts/production-group-delta';
import {closeMigrationWindow,openMigrationWindow,runInMigrationWindow,windowState} from '../../scripts/production-migration-window';
import {auditChain} from '../../scripts/production-cutover';
import {bootstrapTarget,installTargetGrantsCommand,copyAndSwitch,preflight,prewindowCheck,recover,rollback,verifyTarget,BINDINGS_EVIDENCE_FILE,BINDINGS_EVIDENCE_VERSION,LIVE_BINDING_EVIDENCE_FILE,LIVE_BINDING_EVIDENCE_VERSION,type RunConfig,type RunPorts} from '../../scripts/production-cutover-run';
import type {CutoverFault} from '../../scripts/production-cutover';
import {collectBackupEvidence,writeBackupEvidence,OPERATIONAL_BACKUP_FILE,type BackupPort,type BackupRun} from '../../scripts/production-cutover-backup-evidence';

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
 let backupRuns:BackupRun[]=[];
 const backupPort:BackupPort={runs:async()=>backupRuns,migrationCommittedAt:async()=>new Date(Date.now()-3*3600*1000)};
 const config=(over:Partial<RunConfig>={}):RunConfig=>({source:SRC,target:DST,owner:OWNER,allowedTargets:[DST],root,fenceWaitMs:800,activate:false,requirePrewindow:false,requireBindings:false,...over});
 const ports=(over:Partial<RunConfig>={}):RunPorts=>({config:config(over),release:()=>'a'.repeat(40),now:()=>new Date(),aclAllowed:FIXTURE_ONLY_GRANTS,backup:backupPort,...(fault?{fault}:{}),
  openOwner:async database=>{const pool=new Pool({host:'127.0.0.1',port,user:OWNER,password:ownerPassword,database,max:4});pool.on('error',()=>undefined);return{pool,close:async()=>{await pool.end().catch(()=>undefined);}};}});
 const statePath=join(root,'.local/evidence/production-cutover/state.json'),lockPath=join(root,'.local/evidence/production-cutover/lock');
 const state=()=>JSON.parse(readFileSync(statePath,'utf8')) as {phase:string;writes?:string;activation?:string;prewindow?:{ready:boolean;blockers:string[]};sourceLoginRoles:string[];sourceDbSetting?:string|null;sourceFence?:{wasLogin:string[];dbSetting:string|null};dormantAdminRole?:string;recoveryReason?:string};
 const srcSetting=async()=>(await readFenceState(srcOwner,SRC,[operations,pricing]));
 const dst=()=>connect(OWNER,ownerPassword,DST);
 type Rec=Record<string,unknown>;
 const recoverNow=async()=>(await recover(ports())) as Rec;
 const sessionOf=(role:string)=>{const p=new Pool({host:'127.0.0.1',port,user:role,password:ownerPassword,database:SRC,max:1});p.on('error',()=>undefined);return p;};
 const sourceRestored=async(label:string)=>{const s=await srcSetting();assert.deepEqual(s.loginRoles.sort(),[operations,pricing].sort(),label+': both runtime roles can log in again');assert.equal(s.dbSetting,null,label+': the database default is back to what it was');};
 // TEST-ONLY operator reset between rehearsal cases (the product never does this: after the boundary it stops and asks for a human decision).
 const testOnlyReset=async()=>{
  const st=state();const snap=st.sourceFence;
  if(snap)await unfenceSource(srcOwner,SRC,{roles:[operations,pricing],terminated:0,terminateDenied:false,verified:true,wasLogin:snap.wasLogin,dbSetting:snap.dbSetting},manager);
  await readWrite(dst(),[`ALTER DATABASE ${DST} SET default_transaction_read_only=on`,`COMMENT ON DATABASE ${DST} IS NULL`]);
  const {sourceFence:_f,recoveryReason:_r,prewindow:_p,...rest}=st as Record<string,unknown>;void _f;void _r;void _p;
  writeFileSync(statePath,JSON.stringify({...rest,phase:'TARGET_BOOTSTRAPPED',writes:'NEVER',activation:'NONE'}),{mode:0o600});
 };
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

 await check('LOST ENABLE-WRITES REPLY: the boundary was recorded BEFORE the lift, so even though the database is untouched and identical, nothing goes back — forward-fix only (the counterexample to "data equal = safe")',async()=>{
  fault='enable-writes-lost';
  await assert.rejects(copyAndSwitch(ports()),(e:{rolledBack:boolean;recoveryRequired:boolean;message:string})=>{assert.equal(e.rolledBack,false,'no rollback is claimed once the boundary was recorded');return true;});
  fault=undefined;
  assert.equal(state().phase,'FORWARD_FIX_ONLY');assert.equal(state().writes,'ENABLED');assert.equal(state().activation,'STARTED');
  assert.match(String(await readActivationMarker(dst(),DST)),/^STARTED:/,'the marker is in the target DATABASE, not only in the file');
  assert.deepEqual((await srcSetting()).loginRoles,[],'the source stays fenced: never two writers');
  assert.equal((await readFenceState(dst(),DST,[])).dbSetting,null,'the target really is writable');
  // Nothing wrote to the target and nobody is connected — the data even equals the frozen source. That proves nothing about work done while it was open.
  const r=await recoverNow();
  assert.equal(r.status,'CUTOVER_FORWARD_FIX_ONLY');assert.equal(r.reason,'ACTIVATION_BOUNDARY_CROSSED');assert.equal(r.targetUntouched,true,'data are equal, and that is NOT the criterion');
  assert.deepEqual((await srcSetting()).loginRoles,[],'never unfenced after the boundary');
  await assert.rejects(rollback(ports()),code(/ROLLBACK_PHASE_REFUSED_FORWARD_FIX_ONLY/));
  await testOnlyReset();await sourceRestored('lost enable-writes');
 });

 await check('TARGET WRITTEN after the boundary: recover still refuses; the source stays fenced and no success is claimed',async()=>{
  fault='enable-writes-lost';
  await assert.rejects(copyAndSwitch(ports()),(e:{rolledBack:boolean})=>{assert.equal(e.rolledBack,false);return true;});
  fault=undefined;
  const t=dst();const seq=(await t.query("SELECT schemaname||'.'||sequencename s FROM pg_sequences WHERE last_value IS NOT NULL LIMIT 1")).rows[0].s as string;
  await readWrite(t,[`SELECT nextval('${seq}')`]);
  const r=await recoverNow();
  assert.equal(r.status,'CUTOVER_FORWARD_FIX_ONLY');assert.equal(r.reason,'ACTIVATION_BOUNDARY_CROSSED');assert.equal(r.targetUntouched,false);
  assert.deepEqual((await srcSetting()).loginRoles,[],'never unfenced after the boundary');assert.equal(state().phase,'FORWARD_FIX_ONLY');
  await testOnlyReset();await sourceRestored('target written');
 });

 await check('PRE-BOUNDARY rollback is kept: a crash after the fence but before the boundary is rolled back by the `rollback` command AND by `recover`, from the real state',async()=>{
  const st=state();
  writeFileSync(statePath,JSON.stringify({...st,phase:'WINDOW_OPEN',writes:'NEVER',activation:'NONE',sourceLoginRoles:[operations,pricing],sourceDbSetting:null}),{mode:0o600});
  await fenceSource(srcOwner,SRC,[operations,pricing],{managerRole:manager,waitMs:800});
  const r=await rollback(ports());assert.equal(r.status,'CUTOVER_ROLLED_BACK');await sourceRestored('pre-boundary rollback');assert.equal(state().phase,'ROLLED_BACK');
  await testOnlyReset();
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
  await assert.rejects(rollback(ports()),code(/ROLLBACK_REFUSED_ACTIVATION_STARTED/));
  assert.deepEqual((await srcSetting()).loginRoles,[],'the source stays fenced');assert.equal(state().phase,'COPIED_AWAITING_OWNER');
  // even after the operator puts every sequence back so that data AND sequences equal the frozen source again, rollback stays refused (the boundary, not the data, decides)
  const src=(await sequenceStates(srcOwner)).find(q=>q.s===seq)!;await readWrite(t,[`SELECT setval('${seq}',${src.v},${src.c})`]);
  await assert.rejects(rollback(ports()),code(/ROLLBACK_REFUSED_ACTIVATION_STARTED/));
  await testOnlyReset();await sourceRestored('rollback');
 });

 await check('COUNTEREXAMPLE LOGIN→NOLOGIN: a target runtime role was LOGIN at some point and is NOLOGIN again, data identical — rollback and recover are both refused',async()=>{
  const r=await copyAndSwitch(ports());assert.equal(r.status,'CUTOVER_COPIED_AWAITING_OWNER');
  await superuser.query(`ALTER ROLE ${DST}_operations LOGIN`);await superuser.query(`ALTER ROLE ${DST}_operations NOLOGIN`);
  assert.equal((await verifyTarget(ports())).status,'CUTOVER_TARGET_FULLY_VERIFIED','data are identical, nobody is logged in');
  await assert.rejects(rollback(ports()),code(/ROLLBACK_REFUSED_ACTIVATION_STARTED/));
  assert.equal((await recoverNow()).status,'CUTOVER_NOTHING_TO_RECOVER','COPIED_AWAITING_OWNER is not a recoverable phase');
  assert.deepEqual((await srcSetting()).loginRoles,[],'the source stays fenced');
  await testOnlyReset();await sourceRestored('login counterexample');
 });

 await check('FAIL CLOSED: missing, corrupt or inconsistent activation evidence is never read as "safe to go back"',async()=>{
  await copyAndSwitch(ports());
  const good=readFileSync(statePath,'utf8');
  // (a) the activation field is missing (unknown past): refused even though the phase is a rollback phase
  writeFileSync(statePath,JSON.stringify({...JSON.parse(good),phase:'WINDOW_OPEN',activation:undefined}),{mode:0o600});
  await assert.rejects(rollback(ports()),code(/ROLLBACK_REFUSED_ACTIVATION_STARTED/));
  let r=await recoverNow();assert.equal(r.status,'CUTOVER_FORWARD_FIX_ONLY');assert.equal(r.reason,'ACTIVATION_EVIDENCE_UNKNOWN');
  // (b) the file says NONE but the database carries the marker: mismatch
  writeFileSync(statePath,JSON.stringify({...JSON.parse(good),phase:'WINDOW_OPEN',activation:'NONE'}),{mode:0o600});
  await assert.rejects(rollback(ports()),code(/ROLLBACK_REFUSED_ACTIVATION_STARTED/));
  r=await recoverNow();assert.equal(r.status,'CUTOVER_FORWARD_FIX_ONLY');assert.equal(r.reason,'ACTIVATION_MARKER_STATE_MISMATCH');
  // (c) a corrupt state file
  writeFileSync(statePath,'{not json',{mode:0o600});
  await assert.rejects(rollback(ports()),code(/PRODUCTION_CUTOVER_STATE_INVALID/));await assert.rejects(recoverNow(),code(/PRODUCTION_CUTOVER_STATE_INVALID/));
  // (d) no state file at all
  rmSync(statePath);
  await assert.rejects(rollback(ports()),code(/ROLLBACK_PHASE_REFUSED_NONE/));await assert.rejects(recoverNow(),code(/PRODUCTION_CUTOVER_PHASE_REFUSED_NONE/));
  assert.deepEqual((await srcSetting()).loginRoles,[],'through all of this the source stayed fenced');
  writeFileSync(statePath,good,{mode:0o600});
  await testOnlyReset();await sourceRestored('fail closed');
 });

 await check('INSTALL-TARGET-GRANTS: the fixed 11-grant plan is installed on the target only, the four unneeded rental_preparations column privileges are revoked, the 14 Neon platform lines are explained EXACTLY, and every excess (PUBLIC, grant option, other platform privilege) stays unexpected',async()=>{
  const sup=connect(x.db.identity.user,superPassword,SRC);
  for(const role of ['neon_superuser','cloud_admin'])await superuser.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  const roleNames=['operations','pay_projection','pay_truth','pay_dispatch','hold','group'];
  for(const db of [SRC,DST])for(const r of roleNames)await superuser.query(`DO $$ BEGIN CREATE ROLE ${db}_${r} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  const tgt=dst();
  const has=async(p:Pool,db:string,g:{kind:string;object:string;role:string})=>(await p.query(g.kind==='function'?`SELECT has_function_privilege('${db}_${g.role}','${g.object}','EXECUTE') h`:`SELECT has_table_privilege('${db}_${g.role}','${g.object}','SELECT') h`)).rows[0].h as boolean;
  const colPriv=async(p:Pool,db:string)=>(await Promise.all(['prepared_at','prepared_by','fit_evidence','version'].map(async c=>(await p.query(`SELECT has_column_privilege('${db}_operations','public.rental_preparations','${c}','UPDATE') h`)).rows[0].h as boolean)));
  // production: the 11 grants exist, the column UPDATE never did. The current plan gives a fresh target the opposite.
  await srcOwner.query(`REVOKE UPDATE (prepared_at,prepared_by,fit_evidence,version) ON TABLE public.rental_preparations FROM ${SRC}_operations`);
  for(const g of TARGET_GRANT_PLAN)await srcOwner.query(g.kind==='function'?`GRANT EXECUTE ON FUNCTION ${g.object} TO ${SRC}_${g.role}`:`GRANT SELECT ON TABLE ${g.object} TO ${SRC}_${g.role}`);
  await readWrite(tgt,TARGET_GRANT_PLAN.map(g=>g.kind==='function'?`REVOKE EXECUTE ON FUNCTION ${g.object} FROM ${DST}_${g.role}`:`REVOKE SELECT ON TABLE ${g.object} FROM ${DST}_${g.role}`));
  await readWrite(tgt,[`GRANT UPDATE (prepared_at,prepared_by,fit_evidence,version) ON TABLE public.rental_preparations TO ${DST}_operations`]);
  assert.deepEqual(await colPriv(srcOwner,SRC),[false,false,false,false]);assert.deepEqual(await colPriv(tgt,DST),[true,true,true,true],'the current plan over-grants these four');
  for(const g of TARGET_GRANT_PLAN)assert.equal(await has(tgt,DST,g),false);
  // the Neon platform's own privileges on a platform-created database
  await srcOwner.query(`GRANT CONNECT,CREATE,TEMPORARY ON DATABASE ${SRC} TO neon_superuser`);
  await sup.query('ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO neon_superuser WITH GRANT OPTION');
  await sup.query('ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON TABLES TO neon_superuser WITH GRANT OPTION');
  const cfg={requirePrewindow:false,requireBindings:false,requireIndependentBackup:false};
  assert.equal(state().phase,'TARGET_BOOTSTRAPPED');
  const sourceBefore=await aclLines(srcOwner,SRC,[OWNER]);
  let r=await prewindowCheck(ports(cfg)) as Rec;
  assert.equal(r.aclIdenticalExceptExplained,false);assert.ok((r.blockers as string[]).includes('ACL_NOT_IDENTICAL'));
  assert.ok(Number(r.aclPlatformExplained)>=13,'the platform lines are explained exactly and counted: '+r.aclPlatformExplained);
  assert.equal(((await verifyTarget(ports(cfg))) as Rec).status,'CUTOVER_TARGET_VERIFY_FAILED');
  // the installer: fixed plan, target only
  const rep=await installTargetGrantsCommand(ports(cfg)) as Rec;
  assert.equal(rep.status,'CUTOVER_TARGET_GRANTS_INSTALLED');assert.equal(rep.added,11);assert.equal(rep.removed,4);assert.equal(rep.structureUnchanged,true);assert.equal(rep.aclDeltaExact,true);assert.equal(rep.aclUnexpectedAfter,0);assert.equal(rep.sourceWritten,false);assert.equal(rep.rolesMembershipsCredentialsChanged,0);
  for(const g of TARGET_GRANT_PLAN)assert.equal(await has(tgt,DST,g),true,g.object+' → '+g.role);
  assert.deepEqual(await colPriv(tgt,DST),[false,false,false,false],'the four unneeded column privileges are gone, like the source');
  assert.deepEqual(await aclLines(srcOwner,SRC,[OWNER]),sourceBefore,'the source ACL is never changed');
  assert.equal((await tgt.query(`SELECT count(*)::int n FROM pg_database d,aclexplode(d.datacl) a WHERE d.datname=current_database() AND pg_get_userbyid(a.grantee)='neon_superuser'`)).rows[0].n,0,'platform privileges are never applied');
  assert.equal((await tgt.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only,'on');
  // the 0065 privileges on group objects are kept (the installer touches nothing else)
  assert.equal((await tgt.query(`SELECT has_table_privilege('${DST}_group','public.group_orders','SELECT') h`)).rows[0].h,true);
  r=await prewindowCheck(ports(cfg)) as Rec;assert.equal(r.aclIdenticalExceptExplained,true);assert.ok(!(r.blockers as string[]).includes('ACL_NOT_IDENTICAL'));
  assert.notEqual(((await verifyTarget(ports(cfg))) as Rec).status,'CUTOVER_TARGET_VERIFY_FAILED');
  // idempotent
  const again=await installTargetGrantsCommand(ports(cfg)) as Rec;assert.equal(again.added,0);assert.equal(again.removed,0);assert.equal(again.alreadyPresent,11);
  // excess is never explained: PUBLIC on a 0065 object, a grant option on one, and an extra platform privilege
  const unexpectedNow=async()=>(await prewindowCheck(ports(cfg)) as Rec).aclIdenticalExceptExplained;
  await readWrite(tgt,['GRANT SELECT ON TABLE public.group_orders TO PUBLIC']);assert.equal(await unexpectedNow(),false,'PUBLIC on a 0065 object');
  await readWrite(tgt,['REVOKE SELECT ON TABLE public.group_orders FROM PUBLIC']);assert.equal(await unexpectedNow(),true);
  await readWrite(tgt,[`GRANT SELECT ON TABLE public.group_orders TO ${DST}_hold WITH GRANT OPTION`]);assert.equal(await unexpectedNow(),false,'a grant option on a 0065 object');
  await readWrite(tgt,[`REVOKE SELECT ON TABLE public.group_orders FROM ${DST}_hold`]);assert.equal(await unexpectedNow(),true);
  await srcOwner.query('GRANT SELECT ON TABLE public.rental_preparations TO neon_superuser');assert.equal(await unexpectedNow(),false,'neon_superuser on a business table is NOT a platform line');
  await srcOwner.query('REVOKE SELECT ON TABLE public.rental_preparations FROM neon_superuser');assert.equal(await unexpectedNow(),true);
  assert.equal(PLATFORM_EXPLAINED('default|cloud_admin:r:public|neon_superuser|SELECT|false'),false,'the grant option is pinned');
  assert.equal(PLATFORM_EXPLAINED('function|x()|neon_superuser|EXECUTE|false'),false);
  await testOnlyReset();   // drop the prewindow record these checks wrote
 });

 await check('PREWINDOW + ACTIVATION IN THE WINDOW: nothing is fenced without a fresh READY prewindow-check; the window then activates by itself (LOGIN after the boundary, no human step) and is forward-only',async()=>{
  const strict={activate:true,requirePrewindow:true,requireBindings:true};
  // no prewindow check yet: refused, nothing fenced
  await assert.rejects(copyAndSwitch(ports(strict)),code(/PRODUCTION_CUTOVER_PREWINDOW_REQUIRED/));
  assert.deepEqual((await srcSetting()).loginRoles.sort(),[operations,pricing].sort(),'nothing fenced');
  // the check reports every item separately; without bindings evidence it is NOT ready and names why
  let r=await prewindowCheck(ports(strict)) as Rec;
  assert.equal(r.status,'CUTOVER_PREWINDOW_NOT_READY');assert.deepEqual(r.blockers,['BINDINGS_METADATA_NOT_CHECKED','LIVE_BINDINGS_NOT_CHECKED','INDEPENDENT_BACKUP_ABSENT']);
  assert.equal(r.runtimeCredentialsLiveBinding,'NOT_VERIFIABLE_BEFORE_WINDOW(NOLOGIN)');assert.equal(r.liveBindingsScope,'TARGET_OWNER_CONNECTION_ONLY');assert.match(String(r.deliveryBinding),/IN_WINDOW_ONLY/);assert.equal(r.independentBackupRestoreTested,false);
  assert.equal(r.bindingsMetadata,'NOT_CHECKED');assert.equal(r.liveBindings,'NOT_CHECKED');assert.equal(r.retainedSourceCopy,true);assert.equal(r.independentBackupEvidence,'ABSENT');
  assert.match(String(r.recoveryBasis),/not an independent backup/);
  await assert.rejects(copyAndSwitch(ports(strict)),code(/PRODUCTION_CUTOVER_PREWINDOW_REQUIRED/));
  // independent recovery point: neither a hand-written file nor the retained source copy is enough; it must be confirmed ONLINE (a successful backup run after migration 0064)
  const stamp=(over:Partial<BackupRun>={}):BackupRun=>({id:4242,createdAt:new Date(Date.now()-30*60000).toISOString().replace(/\.\d+Z$/,'Z'),headSha:'d'.repeat(40),event:'schedule',stepConclusion:'success',stepStartedAt:new Date(Date.now()-29*60000).toISOString(),stepCompletedAt:new Date(Date.now()-27*60000).toISOString(),...over});
  const dirB=join(root,'.local/evidence/production-cutover');mkdirSync(dirB,{recursive:true});
  mkdirSync(join(root,'.local/evidence/production-backup'),{recursive:true});
  writeFileSync(join(root,'.local/evidence/production-backup/restore-pass-pre-0064.json'),JSON.stringify({result:'PASS',objectKey:'hourly/2026/11/27/2026-11-27T05-17-11-000Z.dump.age',migrations:63}));
  writeFileSync(join(dirB,OPERATIONAL_BACKUP_FILE),JSON.stringify({version:'production-operational-backup-evidence/1',kind:'OPERATIONAL_BACKUP_RUN',self:'declared'}));
  r=await prewindowCheck(ports(strict)) as Rec;assert.equal(r.independentBackupEvidence,'ABSENT','a hand-written record is not evidence');assert.ok((r.blockers as string[]).includes('INDEPENDENT_BACKUP_ABSENT'));
  const good=stamp();backupRuns=[good];
  const verdict=await collectBackupEvidence(backupPort,srcOwner,root,new Date());assert.equal(verdict.ok,true,JSON.stringify(verdict.reasons));
  writeBackupEvidence(root,verdict.evidence!);
  r=await prewindowCheck(ports(strict)) as Rec;assert.equal(r.independentBackupEvidence,'PRESENT');assert.equal(r.independentBackupRunId,4242);assert.equal(r.independentBackupRestoreTested,false);
  assert.ok(!(r.blockers as string[]).includes('INDEPENDENT_BACKUP_ABSENT'));
  // the run vanishes online (or fails): the stored file alone no longer counts
  backupRuns=[{...good,stepConclusion:'failure'}];
  r=await prewindowCheck(ports(strict)) as Rec;assert.equal(r.independentBackupEvidence,'ABSENT');
  backupRuns=[good];
  // metadata CONSISTENT is NOT a live connection/delivery pass
  const dir=join(root,'.local/evidence/production-cutover');mkdirSync(dir,{recursive:true});
  const ev=(file:string,version:string,status:string,over:Rec={})=>writeFileSync(join(dir,file),JSON.stringify({version,target:DST,at:new Date().toISOString(),status,...over}),{mode:0o600});
  ev(BINDINGS_EVIDENCE_FILE,BINDINGS_EVIDENCE_VERSION,'CONSISTENT');
  r=await prewindowCheck(ports(strict)) as Rec;assert.equal(r.bindingsMetadata,'CONSISTENT');assert.equal(r.liveBindings,'NOT_CHECKED');assert.deepEqual(r.blockers,['LIVE_BINDINGS_NOT_CHECKED']);
  assert.equal(r.independentBackupEvidence,'PRESENT');
  ev(LIVE_BINDING_EVIDENCE_FILE,LIVE_BINDING_EVIDENCE_VERSION,'FAIL');
  r=await prewindowCheck(ports(strict)) as Rec;assert.equal(r.liveBindings,'FAIL');assert.deepEqual(r.blockers,['LIVE_BINDINGS_FAIL']);
  ev(LIVE_BINDING_EVIDENCE_FILE,LIVE_BINDING_EVIDENCE_VERSION,'PASS',{target:'neondb_other'});
  r=await prewindowCheck(ports(strict)) as Rec;assert.equal(r.liveBindings,'NOT_CHECKED','evidence for another target is ignored');
  ev(LIVE_BINDING_EVIDENCE_FILE,LIVE_BINDING_EVIDENCE_VERSION,'PASS');
  r=await prewindowCheck(ports(strict)) as Rec;assert.equal(r.status,'CUTOVER_PREWINDOW_READY');assert.deepEqual(r.blockers,[]);assert.equal(state().prewindow!.ready,true);
  // the window: activation is part of it
  const w=await copyAndSwitch(ports(strict)) as Rec;
  assert.equal(w.status,'CUTOVER_ACTIVATED');assert.equal(w.targetRuntimeLogin,true);assert.equal(w.activationBoundary,'RECORDED_FORWARD_FIX_ONLY');
  assert.equal(state().phase,'ACTIVATED');assert.equal(state().activation,'STARTED');
  const roles=(w.switchManifest as {targetRuntimeRoles:string[]}).targetRuntimeRoles;
  for(const role of roles)assert.equal((await superuser.query('SELECT rolcanlogin FROM pg_roles WHERE rolname=$1',[role])).rows[0].rolcanlogin,true,role+' LOGIN granted by the window itself');
  assert.match(String(await readActivationMarker(dst(),DST)),/^STARTED:/);
  assert.deepEqual((await srcSetting()).loginRoles,[],'the source is fenced');
  await assert.rejects(rollback(ports(strict)),code(/ROLLBACK_PHASE_REFUSED_ACTIVATED/));
  assert.equal((await recover(ports(strict)) as Rec).status,'CUTOVER_NOTHING_TO_RECOVER');
  // a finished window is never re-run
  await assert.rejects(copyAndSwitch(ports(strict)),code(/PHASE_REFUSED_ACTIVATED/));
  for(const role of roles)await superuser.query(`ALTER ROLE ${role} NOLOGIN`);
  await testOnlyReset();await sourceRestored('activation');
  // a stale prewindow check (older than the limit) is refused, and a rolled-back window drops it
  await prewindowCheck(ports(strict));
  await assert.rejects(copyAndSwitch(ports({...strict,prewindowMaxAgeMs:1})),code(/PRODUCTION_CUTOVER_PREWINDOW_REQUIRED/));
  rmSync(join(dir,BINDINGS_EVIDENCE_FILE));rmSync(join(dir,LIVE_BINDING_EVIDENCE_FILE));
 });

 // ===================================================================== D: the dormant migration administrator and a REAL later migration through its window
 await check('NEXT MIGRATION: executor-owned functions cannot be changed without a window, can through the window, and nothing is left behind (membership, CREATE, posture, audit chain)',async()=>{
  await testOnlyReset();
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
}catch(e){console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:(e as Error).message.slice(0,1500),at:process.env.CUTOVER_TEST_STACK?String((e as Error).stack).split("\n").slice(1,5).join(" | "):undefined}));process.exitCode=1;}
finally{for(const close of closers)await close().catch(()=>undefined);await x.close().catch(()=>undefined);rmSync(root,{recursive:true,force:true});}
