// Production cutover RUNNER (scripts/production-cutover-run.ts) against disposable PostgreSQL with synthetic data only: all five commands, their guards, the state machine,
// the rollback boundary and secret hygiene. No Production, no Neon, no Vercel, no external party. The library (runCutover/copyData) is proved by production-cutover.ts.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {groupFixture} from '../group/fixture';
import {requestFor} from '../inventory/fixture';
import {trackPoolLifecycle} from '../../scripts/pool-lifecycle';
import {productionFoundationPlan,runFoundationPlan} from '../../scripts/production-bootstrap';
import {copyData,listTables,tableDigests,NOT_COPIED,readWrite} from '../../scripts/production-cutover';
import {groupRoleNames} from '../../scripts/production-group-delta';
import {requirePre0065Recovery} from '../../scripts/production-recovery-evidence-pre0065';
import {bootstrapTarget,copyAndSwitch,main,openProductionOwner,preflight,rollback,verifyTarget,PRODUCTION_SOURCE,PRODUCTION_TARGETS,productionPorts,type RunConfig,type RunPorts} from '../../scripts/production-cutover-run';

const SRC='neondb',DST='neondb_next',OWNER='neondb_owner';
const SOURCE_ONLY={'public.rental_loan_items':['group_part_id','hold_id']};
let stage='setup',count=0;const closers:Array<()=>Promise<void>>=[];
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const code=(re:RegExp)=>(e:unknown)=>{assert.match(String((e as Error).message),re);return true;};
const root=mkdtempSync(join(tmpdir(),'zao-cutover-run-')),emptyRoot=mkdtempSync(join(tmpdir(),'zao-cutover-run-empty-'));
const x=await groupFixture(20);
try{
 const superPassword=(x.db.pool.options as {password:string}).password,ownerPassword=randomBytes(18).toString('hex'),port=x.db.identity.dbPort;
 const connect=(user:string,password:string,database:string)=>{const p=new Pool({host:'127.0.0.1',port,user,password,database,max:4});p.on('error',()=>undefined);closers.push(trackPoolLifecycle(p));return p;};
 const superuser=connect(x.db.identity.user,superPassword,x.db.identity.database);
 await superuser.query('CREATE ROLE synthetic_neon_superuser NOLOGIN CREATEDB CREATEROLE BYPASSRLS');
 await superuser.query('GRANT pg_read_all_data,pg_write_all_data TO synthetic_neon_superuser WITH ADMIN OPTION');
 await superuser.query(`CREATE ROLE ${OWNER} LOGIN NOSUPERUSER CREATEDB CREATEROLE INHERIT PASSWORD '${ownerPassword}'`);
 await superuser.query(`GRANT synthetic_neon_superuser TO ${OWNER}`);
 await superuser.query(`CREATE DATABASE ${SRC} OWNER ${OWNER}`);
 const srcOwner=connect(OWNER,ownerPassword,SRC);

 // ---- synthetic Production-shaped source: registry 0001–0064 with bookings, a payment and groups at several stages
 stage='source fixture';
 const confirmed=await x.draft(undefined,requestFor('2035-03-03'),{reason:'SYNTHETIC cutover-run fixture'});await x.service.startPayment(confirmed.booking.id,randomUUID());
 const token=await x.entrance();
 await x.start(token,'SYNTHETIC draft group');await x.held(token,2,'SYNTHETIC held group');
 const heldB=await x.held(token,3,'SYNTHETIC confirmed group');
 await x.svc.confirm(x.admin,heldB.groupId,{requestKey:randomUUID(),expectedRevision:heldB.revision,fitAcknowledgedMemberIds:[]});
 const srcPlan=await productionFoundationPlan(SRC);
 await runFoundationPlan(srcOwner,{...srcPlan,bootstrap:{...srcPlan.bootstrap,entries:srcPlan.bootstrap.entries.slice(0,64)}});
 {const c=await srcOwner.connect();try{await c.query('BEGIN');await copyData(x.db.pool,c,{ignoreSourceOnly:SOURCE_ONLY});await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 const manager=srcPlan.roles.managerRole,operations=groupRoleNames(SRC).operations;
 {const c=await srcOwner.connect();try{await c.query(`SET ROLE ${manager}`);await c.query(`ALTER ROLE ${operations} LOGIN PASSWORD '${ownerPassword}'`);await c.query('RESET ROLE');}finally{c.release();}}
 const tables=(await listTables(srcOwner)).filter(t=>!(NOT_COPIED as readonly string[]).includes(t));
 const sourceBefore=await tableDigests(srcOwner,tables);
 const appPool=()=>{const p=new Pool({host:'127.0.0.1',port,user:operations,password:ownerPassword,database:SRC,max:1});p.on('error',()=>undefined);return p;};

 const config=(over:Partial<RunConfig>={}):RunConfig=>({source:SRC,target:DST,owner:OWNER,allowedTargets:[DST],root,fenceWaitMs:800,...over});
 let opened=0,released=0;
 const ports=(over:Partial<RunConfig>={},rootOverride?:string):RunPorts=>({config:config({...over,...(rootOverride?{root:rootOverride}:{})}),release:()=>{released++;return 'a'.repeat(40);},now:()=>new Date(),
  openOwner:async database=>{opened++;const pool=new Pool({host:'127.0.0.1',port,user:OWNER,password:ownerPassword,database,max:4});pool.on('error',()=>undefined);return{pool,close:async()=>{await pool.end().catch(()=>undefined);}};}});
 const state=()=>JSON.parse(readFileSync(join(root,'.local/evidence/production-cutover/state.json'),'utf8')) as {phase:string;sourceLoginRoles:string[];switchManifest?:{targetRuntimeRoles:string[];database:string}};
 const roleLogin=async(role:string)=>(await superuser.query('SELECT rolcanlogin FROM pg_roles WHERE rolname=$1',[role])).rows[0]?.rolcanlogin as boolean|undefined;
 const dbSetting=async(db:string)=>((await superuser.query('SELECT s.setconfig FROM pg_db_role_setting s JOIN pg_database d ON d.oid=s.setdatabase WHERE d.datname=$1 AND s.setrole=0',[db])).rows[0]?.setconfig??[]) as string[];

 await check('fixed targets: the Production constants name exactly the source and two replaceable targets, and the target is never the source',async()=>{
  assert.equal(PRODUCTION_SOURCE,'neondb');assert.deepEqual([...PRODUCTION_TARGETS],['neondb_v65','neondb_v65b']);
  const p=productionPorts('/nonexistent');assert.equal(p.config.target,PRODUCTION_TARGETS[0]);assert.ok(!PRODUCTION_TARGETS.includes(PRODUCTION_SOURCE as never));
 });

 await check('guards: wrong target, target equal to the source, unknown command and extra argument are refused before any database connection',async()=>{
  const before=opened;
  await assert.rejects(preflight(ports({target:'neondb_other'})),code(/PRODUCTION_CUTOVER_TARGET_REFUSED/));
  await assert.rejects(preflight(ports({target:SRC,allowedTargets:[SRC]})),code(/PRODUCTION_CUTOVER_TARGET_REFUSED/));
  await assert.rejects(preflight(ports({target:'zr_0123456789ab',allowedTargets:['zr_0123456789ab']})),code(/PRODUCTION_TARGET_INVALID/));
  await assert.rejects(main(['nope'],ports()),code(/PRODUCTION_CUTOVER_ARGUMENTS_REJECTED/));
  await assert.rejects(main(['preflight','--target','x'],ports()),code(/PRODUCTION_CUTOVER_ARGUMENTS_REJECTED/));
  assert.equal(opened,before,'no connection was opened');
  await assert.rejects(bootstrapTarget(ports()),code(/PRODUCTION_PRE0065_RECOVERY_REQUIRED|PRODUCTION_INSTALL_PRE0065_RECOVERY_REQUIRED/),'no recovery evidence yet');
  await assert.rejects(copyAndSwitch(ports()),code(/PRODUCTION_INSTALL_PRE0065_RECOVERY_REQUIRED/));
  assert.equal(opened,before);
 });

 await check('preflight is READ ONLY: it measures the source, never touches it, records a retained-source recovery base and refuses nothing it can measure',async()=>{
  const logins=await roleLogin(operations);
  const app=appPool();await app.query('SELECT 1');
  try{
   const r=await preflight(ports());
   assert.equal(r.status,'CUTOVER_PREFLIGHT_OK');assert.equal(r.registry,64);assert.equal(r.ownerCreatedb,true);assert.equal(r.canSetManager,true);assert.equal(r.ownerCanTerminateRuntimeSessions,false);
   assert.equal(r.targetExists,false);assert.equal(r.runtimeLoginRoles,1);assert.ok(r.runtimeSessions>=1);assert.ok(r.rows>0&&r.tables>0);
   assert.deepEqual(r.inFlight,{reconciliationLeases:0,bookingDeliveries:0,staffDeliveries:0,groupDeliveries:0,executorTransientRows:0});
   assert.match(r.note,/Owner must stop the application first/);
  }finally{await app.end().catch(()=>undefined);}
  assert.equal(await roleLogin(operations),logins,'runtime role LOGIN untouched');
  assert.equal((await dbSetting(SRC)).includes('default_transaction_read_only=on'),false,'source not fenced');
  assert.deepEqual(await tableDigests(srcOwner,tables),sourceBefore,'source rows untouched');
  assert.equal(requirePre0065Recovery(root).kind,'RETAINED_SOURCE_DATABASE');
  assert.equal(state().phase,'PREFLIGHT_OK');assert.equal(statSync(join(root,'.local/evidence/production-cutover/state.json')).mode&0o777,0o600);
  const text=readFileSync(join(root,'.local/evidence/production-cutover/state.json'),'utf8')+readFileSync(join(root,'.local/evidence/production-backup/pre-0065-recovery.json'),'utf8');
  assert.ok(!text.includes(ownerPassword)&&!/postgres(ql)?:\/\//.test(text),'no secret or URI in any evidence file');
 });

 await check('bootstrap-target: creates the NEW database, builds 0001–0065 with the proven bootstrap, installs the group role and 0059–0063 grants, keeps it read-only; a re-run is refused',async()=>{
  const r=await bootstrapTarget(ports());
  assert.equal(r.status,'CUTOVER_TARGET_BOOTSTRAPPED');assert.equal(r.registry,65);assert.equal(r.readOnlyUntilVerified,true);
  assert.equal(state().phase,'TARGET_BOOTSTRAPPED');
  assert.ok((await dbSetting(DST)).includes('default_transaction_read_only=on'));
  assert.equal(await roleLogin(DST+'_group'),false);assert.equal(await roleLogin(DST+'_operations'),false,'target runtime roles stay NOLOGIN');
  assert.equal(Number((await superuser.query("SELECT count(*)::int n FROM pg_roles WHERE rolname LIKE 'zao\\_boot\\_%'")).rows[0].n),0,'no ephemeral creator role remains');
  await assert.rejects(bootstrapTarget(ports()),code(/PRODUCTION_CUTOVER_PREFLIGHT_REQUIRED/),'second bootstrap refused');
  const s=await srcOwner.query('SELECT count(*)::int n FROM public.foundation_migrations');assert.equal(s.rows[0].n,64,'source registry untouched');
 });

 await check('verify-target before the window: structure proof only (the source is still writable), rows not yet compared',async()=>{
  const r=await verifyTarget(ports());
  assert.equal(r.status,'CUTOVER_TARGET_VERIFIED');assert.equal(r.mode,'STRUCTURAL_ONLY_TARGET_IN_USE');
  assert.equal(r.rowsIdenticalToSource,null);assert.equal(r.custodyLinkNative,true);assert.equal(r.executorMembers,0);assert.equal(r.fkOrphans,0);assert.equal(r.triggersNotEnabled,0);assert.equal(r.executorOwnedDefiners,3);
 });

 await check('a running application session that cannot be terminated aborts the window: rolled back, source unfenced, target untouched, phase unchanged',async()=>{
  const app=appPool();await app.query('SELECT 1');
  try{
   await assert.rejects(copyAndSwitch(ports()),(e:{message:string;rolledBack?:boolean;stage?:string})=>{assert.match(e.message,/PRODUCTION_CUTOVER_CUTOVER_FENCE_SESSIONS_REMAIN|PRODUCTION_CUTOVER_FENCE_SESSIONS_REMAIN/);assert.equal(e.rolledBack,true);assert.equal(e.stage,'fence');return true;});
  }finally{await app.end().catch(()=>undefined);}
  assert.equal(await roleLogin(operations),true,'runtime role LOGIN restored');
  assert.equal((await dbSetting(SRC)).includes('default_transaction_read_only=on'),false);
  assert.equal(Number((await superuser.query('SELECT count(*)::int n FROM public.group_orders')).rows[0].n)>=0,true);
  assert.equal(Number((await (await connect(OWNER,ownerPassword,DST)).query('SELECT count(*)::int n FROM public.group_orders')).rows[0].n),0,'target untouched');
  assert.equal(state().phase,'TARGET_BOOTSTRAPPED');
 });

 // ASSUMPTION (unproven on real Neon): the owner may terminate runtime-role sessions. Granted locally to prove the termination path.
 await superuser.query(`GRANT pg_signal_backend TO ${OWNER}`);

 let switchRoles:string[]=[];
 await check('copy-and-switch: fence, copy, reconcile, enable writes — and STOP with the application still unable to reach the target; the Owner switch is not performed',async()=>{
  const app=appPool();await app.query('SELECT 1');
  let r:Awaited<ReturnType<typeof copyAndSwitch>>;
  try{r=await copyAndSwitch(ports());}finally{await app.end().catch(()=>undefined);}
  assert.equal(r.status,'CUTOVER_COPIED_AWAITING_OWNER');assert.equal(r.chainValid,true);assert.equal(r.sourceFenced,true);assert.equal(r.targetWritableByApplication,false);
  assert.deepEqual(r.steps,['preflight','fence','copy','reconcile','enable-writes','switch','post-switch']);
  assert.ok(r.rows>0);assert.equal(state().phase,'COPIED_AWAITING_OWNER');
  assert.equal(await roleLogin(operations),false,'source runtime role fenced');assert.ok((await dbSetting(SRC)).includes('default_transaction_read_only=on'));
  assert.equal((await dbSetting(DST)).includes('default_transaction_read_only=on'),false,'target writable once verified');
  switchRoles=r.switchManifest.targetRuntimeRoles;
  assert.ok(switchRoles.length>=17&&switchRoles.every(n=>n.startsWith(DST+'_')&&!n.endsWith('_backup')),'target role names carry the new prefix and exclude the backup role');
  assert.equal(r.switchManifest.database,DST);assert.equal(r.switchManifest.rolePrefixFrom,SRC+'_');assert.equal(r.switchManifest.rolePrefixTo,DST+'_');
  for(const role of switchRoles)assert.equal(await roleLogin(role),false,role+' NOLOGIN');
  const text=JSON.stringify(r);assert.ok(!text.includes(ownerPassword)&&!/synthetic|@/.test(text.replace(/synthetic_neon_superuser/g,'')),'report carries no secret or row content');
  await assert.rejects(copyAndSwitch(ports()),code(/PRODUCTION_CUTOVER_PHASE_REFUSED_COPIED_AWAITING_OWNER/),'a finished window is never re-run');
  await assert.rejects(preflight(ports()),code(/PRODUCTION_CUTOVER_PHASE_REFUSED_COPIED_AWAITING_OWNER/));
  await assert.rejects(bootstrapTarget(ports()),code(/PRODUCTION_CUTOVER_PREFLIGHT_REQUIRED/));
 });

 await check('verify-target after the window: full row identity with the fenced source, structure unchanged, sequences and foreign keys proven',async()=>{
  const r=await verifyTarget(ports());
  assert.equal(r.status,'CUTOVER_TARGET_VERIFIED');assert.equal(r.mode,'FULL_PRE_SWITCH');assert.equal(r.rowsIdenticalToSource,true);assert.equal(r.schemaUnchanged,true);assert.equal(r.sourceRuntimeLoginRoles,0);assert.deepEqual(r.runtimeLoginRoles,[]);
  const t=await tableDigests(await connect(OWNER,ownerPassword,DST),tables,{'public.rental_loan_items':['group_part_id','hold_id']});
  for(const name of tables)assert.deepEqual(t[name],sourceBefore[name],name);
 });

 await check('rollback while the application has never used the target: source unfenced, target read-only again, phase ROLLED_BACK, and a new window can be run',async()=>{
  const r=await rollback(ports());
  assert.equal(r.status,'CUTOVER_ROLLED_BACK');assert.equal(r.targetReadOnly,true);assert.equal(r.sourceRuntimeRolesRestored,1);
  assert.equal(await roleLogin(operations),true);assert.equal((await dbSetting(SRC)).includes('default_transaction_read_only=on'),false);
  assert.ok((await dbSetting(DST)).includes('default_transaction_read_only=on'));assert.equal(state().phase,'ROLLED_BACK');
  assert.deepEqual(await tableDigests(srcOwner,tables),sourceBefore,'the source is exactly what it was');
  await assert.rejects(rollback(ports()),code(/PRODUCTION_CUTOVER_ROLLBACK_PHASE_REFUSED_ROLLED_BACK/));
  const again=await copyAndSwitch(ports());assert.equal(again.status,'CUTOVER_COPIED_AWAITING_OWNER');assert.equal(state().phase,'COPIED_AWAITING_OWNER');
 });

 await check('once any target runtime role can log in, rollback is refused (forward fix only: never two writers) and verify-target falls back to the structural proof',async()=>{
  await superuser.query(`ALTER ROLE ${DST}_operations LOGIN`);
  await assert.rejects(rollback(ports()),code(/PRODUCTION_CUTOVER_ROLLBACK_REFUSED_TARGET_IN_USE/));
  assert.equal(await roleLogin(operations),false,'source stays fenced');assert.equal(state().phase,'COPIED_AWAITING_OWNER');
  const v=await verifyTarget(ports());assert.equal(v.mode,'STRUCTURAL_ONLY_TARGET_IN_USE');assert.equal(v.rowsIdenticalToSource,null);assert.deepEqual(v.runtimeLoginRoles,[DST+'_operations']);
  await superuser.query(`ALTER ROLE ${DST}_operations NOLOGIN`);
 });

 await check('the source database is never dropped, truncated or re-registered by any command (identity, registry and every row digest unchanged)',async()=>{
  assert.equal(Number((await superuser.query('SELECT count(*)::int n FROM pg_database WHERE datname=$1',[SRC])).rows[0].n),1);
  assert.equal(Number((await srcOwner.query('SELECT count(*)::int n FROM public.foundation_migrations')).rows[0].n),64);
  assert.deepEqual(await tableDigests(srcOwner,tables),sourceBefore);
  assert.ok(released>=8,'every command admitted the accepted main release first');
 });

 await check('the Production owner session refuses ambiguity, a wrong database and a URI of another host before any connection; secrets never appear in the refusal',async()=>{
  const neon=(endpoints:unknown,uri?:string)=>({get:async(path:string)=>path.endsWith('/endpoints')?{endpoints}:{uri},post:async()=>({})});
  await assert.rejects(openProductionOwner(neon([]),'neondb'),code(/PRODUCTION_CUTOVER_ENDPOINT_AMBIGUOUS/));
  await assert.rejects(openProductionOwner(neon([{type:'read_write',branch_id:'br-long-king-azkou4fy',host:'a.example.com'},{type:'read_write',branch_id:'br-long-king-azkou4fy',host:'b.example.com'}]),'neondb'),code(/PRODUCTION_CUTOVER_ENDPOINT_AMBIGUOUS/));
  await assert.rejects(openProductionOwner(neon([{type:'read_write',branch_id:'br-long-king-azkou4fy',host:'evil.example.com'}],['postgresql:','//u:',ownerPassword,'@evil.example.com/neondb'].join('')),'neondb'),(e:Error)=>{assert.ok(!e.message.includes(ownerPassword));return true;});
 });

 console.log(JSON.stringify({status:'PASS',cases:count,source:SRC,target:DST,productionDdl:0,externalContact:0,
  notRun:['real Neon pg_signal_backend for the owner','real data volume/timing','Vercel secret switch and redeploy','target runtime-role LOGIN/password issuance (Owner)','Neon connection_uri for a database created by SQL']}));
}catch(e){console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:(e as Error).message.slice(0,1200)}));process.exitCode=1;}
finally{for(const close of closers)await close().catch(()=>undefined);await x.close().catch(()=>undefined);rmSync(root,{recursive:true,force:true});rmSync(emptyRoot,{recursive:true,force:true});void existsSync;void readWrite;}
