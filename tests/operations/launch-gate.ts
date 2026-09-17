import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {writeAccount} from '../../packages/auth/src/accounts';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {FieldAcceptance,fieldScenarios} from '../../packages/core/src/operations/field-acceptance';
import {LaunchGate} from '../../packages/core/src/operations/launch-gate';
import {InventoryOperations} from '../../packages/core/src/operations/inventory-service';
import {observeOperationalFailure} from '../../packages/core/src/operations/ops-signal';
import {launchGateRows} from '../../packages/contracts/src/launch-staging';
const COMPONENTS={APP:'READY',DB:'READY',GUEST:'READY',PAYMENT_ADAPTER:'READY',WEBHOOK:'UNCONNECTED',MEDIA:'OFF',NOTIFICATION:'CONFIGURED'};
let failed=false,stage='fixture',count=0;const x=await flowFixture();let ops:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 ops=await provisionOperationsRole(x.db.pool,x.db.identity);
 const ctx=new OperationsContext(ops.operationsPool,x.roles.authPool,x.signed.identity);
 const field=new FieldAcceptance(ctx),gate=new LaunchGate(ctx);
 const run=randomUUID();
 const record=(o:Record<string,unknown>={})=>({runId:run,scenario:'IPHONE_QR_SCAN',deviceClass:'IOS',store:'MOUNTAIN_BASE',result:'PASS',safeNote:'NONE',...o});
 const scoped=async(email:string,store:'MOUNTAIN_BASE'|'ONSEN_BASE')=>{
  await writeAccount(x.roles.authPool,x.bp,undefined,{email,password:x.password,displayName:'SYNTHETIC '+store,active:true,role:'ADMIN',scope:'ASSIGNED',storeIds:[store],permissions:{BOOKING_VIEW:true,OPERATIONS_VIEW:true,FIELD_ACCEPTANCE:true}});
  const signed=await x.login(email);const c=new OperationsContext(ops!.operationsPool,x.roles.authPool,signed.identity);
  return {field:new FieldAcceptance(c),gate:new LaunchGate(c)};
 };

 await check('field acceptance and the launch gate are denied without explicit permission',async()=>{
  await assert.rejects(field.record(randomUUID(),record()),{status:403});
  await assert.rejects(field.status(run,'MOUNTAIN_BASE'),{status:403});
  await assert.rejects(gate.status({runId:run,components:COMPONENTS,backup:null}),{status:403});
  assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM staff_role_permissions WHERE permission='FIELD_ACCEPTANCE'")).rows[0].n,0);
 });

 await check('reading the gate does not allow recording a field result',async()=>{
  await x.db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,'OPERATIONS_VIEW',true)",[x.actor]);
  Object.assign(x.principal,(await loadStaff(x.roles.authPool,x.actor))!);
  assert.deepEqual((await field.status(run,'MOUNTAIN_BASE')).map(r=>r.result),fieldScenarios.map(()=>'NOT_RUN'));
  await assert.rejects(field.record(randomUUID(),record()),{status:403});
 });

 await check('a scenario cannot be satisfied from a device class it does not apply to',async()=>{
  await x.db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,'FIELD_ACCEPTANCE',true)",[x.actor]);
  Object.assign(x.principal,(await loadStaff(x.roles.authPool,x.actor))!);
  for(const bad of [{deviceClass:'DESKTOP'},{deviceClass:'NOT_APPLICABLE'},{deviceClass:'ANDROID'}])
   await assert.rejects(field.record(randomUUID(),record(bad)),{code:'FIELD_DEVICE_CLASS_MISMATCH'});
  for(const bad of [{scenario:'ANDROID_QR_SCAN',deviceClass:'IOS'},{scenario:'OFFLINE',deviceClass:'DESKTOP'},{scenario:'CAMERA_PERMISSION_DENIED',deviceClass:'NOT_APPLICABLE'}])
   await assert.rejects(field.record(randomUUID(),record(bad)),{code:'FIELD_DEVICE_CLASS_MISMATCH'});
  // The database refuses the same combination even if the service were bypassed.
  await assert.rejects(x.db.pool.query("INSERT INTO field_acceptance_records(run_id,scenario,device_class,store_id,result,actor) VALUES($1,'IPHONE_QR_SCAN','DESKTOP','MOUNTAIN_BASE','PASS',$2)",[run,x.actor]),{code:'23514'});
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM field_acceptance_records')).rows[0].n,0);
 });

 await check('records accept fixed enums only, so no customer material can be stored',async()=>{
  for(const bad of [{scenario:'ANYTHING'},{result:'MAYBE'},{safeNote:'guest Tanaka 090-0000-0000'},{deviceClass:'FAX'},{store:'NOWHERE'}])
   await assert.rejects(field.record(randomUUID(),record(bad)),{status:422});
  const columns=(await x.db.pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='field_acceptance_records' ORDER BY 1")).rows.map(r=>r.column_name);
  for(const forbidden of ['email','phone','name','contact','note_text','customer'])assert.ok(!columns.includes(forbidden),forbidden);
 });

 let mountainRow:Record<string,unknown>={};
 await check('a store-scoped actor cannot read or overwrite another store result',async()=>{
  const mountain=await scoped('field-mountain@example.invalid','MOUNTAIN_BASE'),onsen=await scoped('field-onsen@example.invalid','ONSEN_BASE');
  await mountain.field.record(randomUUID(),record({result:'PASS',safeNote:'NONE'}));
  mountainRow=(await x.db.pool.query('SELECT * FROM field_acceptance_records WHERE run_id=$1',[run])).rows[0];
  // Same run, scenario and device, but the other store: it must not reach the existing row.
  await assert.rejects(onsen.field.record(randomUUID(),record({store:'MOUNTAIN_BASE',result:'FAIL',safeNote:'SCAN_TIMEOUT'})),{status:403});
  await assert.rejects(onsen.field.status(run,'MOUNTAIN_BASE'),{status:403});
  await assert.rejects(onsen.field.status(run,'SYSTEM'),{status:403});
  await assert.rejects(onsen.gate.status({runId:run,components:COMPONENTS,backup:null}),{status:403});
  assert.deepEqual((await x.db.pool.query('SELECT * FROM field_acceptance_records WHERE run_id=$1',[run])).rows[0],mountainRow);
  // The reverse direction is denied the same way.
  await assert.rejects(mountain.field.status(run,'ONSEN_BASE'),{status:403});
  await assert.rejects(mountain.gate.status({runId:run,components:COMPONENTS,backup:null}),{status:403});
  // Recording the same scenario at the other store creates its own row and leaves this one alone.
  await onsen.field.record(randomUUID(),record({store:'ONSEN_BASE',result:'FAIL',safeNote:'SCAN_TIMEOUT'}));
  assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM field_acceptance_records WHERE run_id=$1',[run])).rows[0].n,2);
  assert.deepEqual((await x.db.pool.query('SELECT * FROM field_acceptance_records WHERE run_id=$1 AND store_id=$2',[run,'MOUNTAIN_BASE'])).rows[0],mountainRow);
  assert.deepEqual((await mountain.field.status(run,'MOUNTAIN_BASE')).find(r=>r.scenario==='IPHONE_QR_SCAN')!.result,'PASS');
  assert.deepEqual((await onsen.field.status(run,'ONSEN_BASE')).find(r=>r.scenario==='IPHONE_QR_SCAN')!.result,'FAIL');
 });

 await check('only explicit ALL scope may aggregate both stores',async()=>{
  const all=await field.status(run,'SYSTEM');
  assert.equal(all.length,fieldScenarios.length);
  assert.ok(['PASS','FAIL'].includes(all.find(r=>r.scenario==='IPHONE_QR_SCAN')!.result));
  const result=await gate.status({runId:run,components:COMPONENTS,backup:null});
  assert.equal(result.readOnly,true);assert.equal(result.canActivateProduction,false);
 });

 await check('the launch gate reports every row and keeps webhook independent of payment',async()=>{
  const result=await gate.status({runId:run,components:COMPONENTS,backup:null});
  assert.deepEqual(result.rows.map(r=>r.row),[...launchGateRows]);
  const by=Object.fromEntries(result.rows.map(r=>[r.row,r.state]));
  assert.equal(by.DB_SCHEMA,'READY');assert.equal(by.CODE,'READY');assert.equal(by.CI,'NOT_RUN');
  // A ready payment adapter must not make an unconnected webhook look ready.
  assert.equal(by.PAYMENT,'READY');assert.equal(by.WEBHOOK,'NOT_RUN');
  assert.equal((await gate.status({runId:run,components:{...COMPONENTS,WEBHOOK:'READY'},backup:null})).rows.find(r=>r.row==='WEBHOOK')!.state,'READY');
  assert.equal(by.MEDIA,'NOT_RUN');assert.equal(by.NOTIFICATION,'PENDING');assert.equal(by.BACKUP,'NOT_RUN');
  assert.equal(by.FIELD_DEVICE,'BLOCKED');assert.equal(by.STAFF_REHEARSAL,'NOT_RUN');
 });

 await check('real inventory readiness needs an acceptance receipt, never a file name',async()=>{
  const before=await gate.status({runId:run,components:COMPONENTS,backup:null});
  assert.equal(before.rows.find(r=>r.row==='REAL_DATA')!.state,'NOT_RUN');
  assert.equal(before.realDataReceipts,0);
  const inventory=new InventoryOperations(ctx);
  assert.deepEqual(await inventory.realDataAcceptance(),[]);
  // A synthetic rehearsal has no receipt, so it can never read as real stock.
  const c=await x.db.pool.connect();
  try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','SYNTHETIC receipt-named rehearsal row',true)",[x.actor]);
   await c.query("INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator) SELECT gen_random_uuid(),v.id,v.family,'MOUNTAIN_BASE','MOUNTAIN_BASE','AVAILABLE','NOT_APPLICABLE','','','UNVERIFIED','SHOP RECEIPT 2026-01','row-9' FROM ledger_variants v WHERE v.family='SKI' LIMIT 1");
   await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  assert.equal((await gate.status({runId:run,components:COMPONENTS,backup:null})).rows.find(r=>r.row==='REAL_DATA')!.state,'NOT_RUN');
  await assert.rejects(inventory.acceptRealData(randomUUID(),{commitId:randomUUID(),expectedStores:null}),{status:409});
  await assert.rejects(inventory.acceptRealData(randomUUID(),{commitId:randomUUID(),expectedStores:['NOWHERE']}),{status:422});
 });

 await check('an unusable operations sink never blocks a booking',async()=>{
  await ops!.close();ops=undefined;
  assert.equal(await observeOperationalFailure(ctx.pool,'STORAGE_FAILED','MOUNTAIN_BASE'),false);
  const d=await x.draft();await x.service.startPayment(d.booking.id,randomUUID());
  assert.equal((await x.db.pool.query('SELECT state FROM rental_bookings WHERE id=$1',[d.booking.id])).rows[0].state,'CONFIRMED_DEV');
 });

 await check('optional features stay outside the booking critical path',async()=>{
  const columns=(await x.db.pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='rental_bookings' ORDER BY 1")).rows.map(r=>r.column_name);
  for(const optional of ['avatar_id','media_id','ops_exception_id','field_acceptance_id','notification_id'])assert.ok(!columns.includes(optional),optional);
  assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM pg_constraint c JOIN pg_class p ON p.oid=c.confrelid WHERE c.conrelid='rental_bookings'::regclass AND c.contype='f' AND p.relname IN ('avatar_visuals','ops_exceptions','field_acceptance_records','real_data_acceptance','booking_notification_outbox','content_media_objects')")).rows[0].n,0);
 });

 console.log(JSON.stringify({status:'PASS',cases:count,productionActivations:0,secretsAccepted:0,realCustomer:0,hostedDb:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:(e as Error).message.slice(0,500)}));}
finally{await ops?.close();await x.close();}
if(failed)process.exit(1);
