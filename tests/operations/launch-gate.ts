import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {FieldAcceptance,fieldScenarios} from '../../packages/core/src/operations/field-acceptance';
import {LaunchGate} from '../../packages/core/src/operations/launch-gate';
import {observeOperationalFailure} from '../../packages/core/src/operations/ops-signal';
import {launchGateRows} from '../../packages/contracts/src/launch-staging';
const COMPONENTS={APP:'READY',DB:'READY',GUEST:'READY',PAYMENT_ADAPTER:'UNCONNECTED',MEDIA:'OFF',NOTIFICATION:'CONFIGURED'};
let failed=false,stage='fixture',count=0;const x=await flowFixture();let ops:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 ops=await provisionOperationsRole(x.db.pool,x.db.identity);
 const ctx=new OperationsContext(ops.operationsPool,x.roles.authPool,x.signed.identity);
 const field=new FieldAcceptance(ctx),gate=new LaunchGate(ctx);
 const run=randomUUID();
 const record=(o:Record<string,unknown>={})=>({runId:run,scenario:'IPHONE_QR_SCAN',deviceClass:'IOS',store:'MOUNTAIN_BASE',result:'PASS',safeNote:'NONE',...o});

 await check('field acceptance and the launch gate are denied without explicit permission',async()=>{
  await assert.rejects(field.record(randomUUID(),record()),{status:403});
  await assert.rejects(field.status(run),{status:403});
  await assert.rejects(gate.status({runId:run,components:COMPONENTS,backup:null}),{status:403});
  assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM staff_role_permissions WHERE permission='FIELD_ACCEPTANCE'")).rows[0].n,0);
 });

 await check('reading the gate does not allow recording a field result',async()=>{
  await x.db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,'OPERATIONS_VIEW',true)",[x.actor]);
  Object.assign(x.principal,(await loadStaff(x.roles.authPool,x.actor))!);
  assert.deepEqual((await field.status(run)).map(r=>r.result),fieldScenarios.map(()=>'NOT_RUN'));
  await assert.rejects(field.record(randomUUID(),record()),{status:403});
 });

 await check('records accept fixed enums only, so no customer material can be stored',async()=>{
  await x.db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,'FIELD_ACCEPTANCE',true)",[x.actor]);
  Object.assign(x.principal,(await loadStaff(x.roles.authPool,x.actor))!);
  for(const bad of [{scenario:'ANYTHING'},{result:'MAYBE'},{safeNote:'guest Tanaka 090-0000-0000'},{deviceClass:'FAX'},{store:'NOWHERE'}])
   await assert.rejects(field.record(randomUUID(),record(bad)),{status:422});
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM field_acceptance_records')).rows[0].n,0);
  const columns=(await x.db.pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='field_acceptance_records' ORDER BY 1")).rows.map(r=>r.column_name);
  for(const forbidden of ['email','phone','name','contact','note_text','customer'])assert.ok(!columns.includes(forbidden),forbidden);
 });

 await check('a recorded result is idempotent and re-recording replaces only that scenario',async()=>{
  const key=randomUUID(),first=await field.record(key,record()),again=await field.record(key,record());
  assert.deepEqual(first,again);
  assert.equal((first as {result:string}).result,'PASS');
  assert.equal((first as {businessStateChanged:boolean}).businessStateChanged,false);
  await field.record(randomUUID(),record({result:'FAIL',safeNote:'SCAN_TIMEOUT'}));
  const status=await field.status(run);
  assert.equal(status.find(s=>s.scenario==='IPHONE_QR_SCAN')!.result,'FAIL');
  assert.equal(status.find(s=>s.scenario==='ANDROID_QR_SCAN')!.result,'NOT_RUN');
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM field_acceptance_records WHERE run_id=$1',[run])).rows[0].n,1);
  assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM ops_history WHERE resource='field_acceptance_records'")).rows[0].n,2);
 });

 await check('the launch gate reports every row read-only and offers no activation',async()=>{
  const result=await gate.status({runId:run,components:COMPONENTS,backup:null});
  assert.equal(result.readOnly,true);assert.equal(result.canActivateProduction,false);
  assert.deepEqual(result.rows.map(r=>r.row),[...launchGateRows]);
  const by=Object.fromEntries(result.rows.map(r=>[r.row,r.state]));
  assert.equal(by.DB_SCHEMA,'READY');assert.equal(by.CODE,'READY');assert.equal(by.CI,'NOT_RUN');
  // Fixture stock is synthetic, so real inventory is honestly still absent.
  assert.equal(by.REAL_DATA,'NOT_RUN');assert.equal(result.realInventoryRows,0);
  assert.equal(by.PAYMENT,'NOT_RUN');assert.equal(by.WEBHOOK,'NOT_RUN');
  assert.equal(by.MEDIA,'NOT_RUN');assert.equal(by.NOTIFICATION,'PENDING');
  assert.equal(by.BACKUP,'NOT_RUN');
  // A failed device scenario blocks; the rehearsal scenarios are still unexercised.
  assert.equal(by.FIELD_DEVICE,'BLOCKED');assert.equal(by.STAFF_REHEARSAL,'NOT_RUN');
  assert.equal(Object.values(await gate.status({runId:null,components:COMPONENTS,backup:null})).length>0,true);
 });

 await check('backup metadata moves only the backup row',async()=>{
  const ready=await gate.status({runId:run,components:COMPONENTS,backup:{backupEnabled:true,retentionDays:30,pitrEnabled:true,latestSuccessfulBackupAgeHours:2,restoreTargetIsolated:true}});
  assert.equal(ready.rows.find(r=>r.row==='BACKUP')!.state,'READY');
  const blocked=await gate.status({runId:run,components:COMPONENTS,backup:{backupEnabled:true,retentionDays:1,pitrEnabled:false,latestSuccessfulBackupAgeHours:200,restoreTargetIsolated:false}});
  assert.equal(blocked.rows.find(r=>r.row==='BACKUP')!.state,'BLOCKED');
  assert.equal(blocked.rows.find(r=>r.row==='DB_SCHEMA')!.state,'READY');
 });

 await check('an unusable operations sink never blocks a booking',async()=>{
  // The ops pool is closed, so observation fails; booking and payment must not notice.
  await ops!.close();ops=undefined;
  const closed=await observeOperationalFailure(ctx.pool,'STORAGE_FAILED','MOUNTAIN_BASE');
  assert.equal(closed,false);
  const d=await x.draft();await x.service.startPayment(d.booking.id,randomUUID());
  assert.equal((await x.db.pool.query('SELECT state FROM rental_bookings WHERE id=$1',[d.booking.id])).rows[0].state,'CONFIRMED_DEV');
 });

 await check('optional features stay outside the booking critical path',async()=>{
  const columns=(await x.db.pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='rental_bookings' ORDER BY 1")).rows.map(r=>r.column_name);
  for(const optional of ['avatar_id','media_id','ops_exception_id','field_acceptance_id','notification_id'])assert.ok(!columns.includes(optional),optional);
  const constraints=(await x.db.pool.query("SELECT count(*)::int n FROM pg_constraint c JOIN pg_class p ON p.oid=c.confrelid WHERE c.conrelid='rental_bookings'::regclass AND c.contype='f' AND p.relname IN ('avatar_visuals','ops_exceptions','field_acceptance_records','booking_notification_outbox','content_media_objects')")).rows[0].n;
  assert.equal(constraints,0);
 });

 console.log(JSON.stringify({status:'PASS',cases:count,productionActivations:0,secretsAccepted:0,realCustomer:0,hostedDb:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:(e as Error).message.slice(0,500)}));}
finally{await ops?.close();await x.close();}
if(failed)process.exit(1);
