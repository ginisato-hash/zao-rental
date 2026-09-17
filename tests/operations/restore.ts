import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFile,rm,mkdir} from 'node:fs/promises';
import {flowFixture} from '../flow/fixture';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {provisionNotificationRole} from '../../scripts/notification-roles';
import {provisionBookingAccessRole} from '../../scripts/booking-access-role';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {OperationsConsole} from '../../packages/core/src/operations/console-service';
import {FinancialOperations} from '../../packages/core/src/operations/financial';
import {BookingNotificationWorker} from '../../packages/core/src/notification/worker';
import {BookingRecovery} from '../../packages/core/src/guest/booking-recovery';
import {LoopbackDeliveryAdapter} from '../notification/loopback';
import {exportOwnedDatabase,restoreIntoFreshDatabase,verifyEnvelope,criticalFingerprint,validateRestored,RESTORE_REQUIRED,NOT_RESTORED,BACKUP_LABEL} from '../../scripts/local-restore';
import {requestFor,fid} from '../inventory/fixture';
let failed=false,stage='fixture',count=0;const x=await flowFixture();
let ops:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined,notify:Awaited<ReturnType<typeof provisionNotificationRole>>|undefined,access:Awaited<ReturnType<typeof provisionBookingAccessRole>>|undefined;
let restored:Awaited<ReturnType<typeof restoreIntoFreshDatabase>>|undefined;
const backupPath='.local/backup-drill/m17-logical-backup.json';
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 ops=await provisionOperationsRole(x.db.pool,x.db.identity);notify=await provisionNotificationRole(x.db.pool,x.db.identity);access=await provisionBookingAccessRole(x.db.pool,x.db.identity);
 await x.db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) SELECT $1,p,true FROM unnest(ARRAY['OPERATIONS_VIEW','OPERATIONS_ACKNOWLEDGE','REFUND_OVERRIDE']) p",[x.actor]);
 Object.assign(x.principal,(await loadStaff(x.roles.authPool,x.actor))!);
 const ctx=new OperationsContext(ops.operationsPool,x.roles.authPool,x.signed.identity),console_=new OperationsConsole(ctx);

 stage='synthetic business state';
 // Confirmed booking with a completed payment, plus an ambiguous one.
 const confirmed=await x.draft(undefined,requestFor('2035-03-03'));await x.service.startPayment(confirmed.booking.id,randomUUID());
 const ambiguous=await x.draft(undefined,requestFor('2035-03-04'));x.fake.failAfterSave=true;await x.service.startPayment(ambiguous.booking.id,randomUUID());x.fake.failAfterSave=false;
 // Durable confirmation delivery, an accepted refund request and a delayed transfer.
 const recovery=new BookingRecovery(access.accessPool,randomBytes(32),'restore-fixture-v1',undefined,5000,true);
 const worker=new BookingNotificationWorker(notify.notificationPool,x.origin,recovery,new LoopbackDeliveryAdapter());
 const delivery=(await worker.enqueueConfirmed(confirmed.booking.id))!;assert.equal((await worker.dispatch(delivery)).state,'ACCEPTED');
 const payment=(await x.db.pool.query('SELECT id FROM rental_payment_attempts WHERE booking_id=$1',[confirmed.booking.id])).rows[0];
 await new FinancialOperations(ctx).requestRefund(randomUUID(),{bookingId:confirmed.booking.id,paymentId:payment.id,actingStore:'MOUNTAIN_BASE',category:'CUSTOMER_EXCEPTION',reason:'SYNTHETIC restore fixture',amountJpy:100});
 const batch=randomUUID(),c=await x.db.pool.connect();
 try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','SYNTHETIC restore fixture',true)",[x.actor]);
  await c.query("INSERT INTO transfer_batches(id,source_store,destination_store,scheduled_date,planned_ready_at,needed_by,basis) VALUES($1,'MOUNTAIN_BASE','ONSEN_BASE','2034-12-30','2034-12-30T17:00:00+09:00','2034-12-31T08:30:00+09:00','SYNTHETIC restore transfer')",[batch]);
  await c.query('INSERT INTO transfer_pieces(id,batch_id,line_key,ordinal,asset_id) VALUES($1,$2,$3,1,$4)',[randomUUID(),batch,randomUUID(),fid(1201)]);
  await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 // Observed operational exceptions, one of them acknowledged.
 const page=await console_.list({store:'MOUNTAIN_BASE',type:null,severity:null,ageHours:0,status:'UNACKNOWLEDGED',beforeTime:null,beforeId:null});
 assert.ok(page.exceptions.length>0);await console_.acknowledge(randomUUID(),{id:page.exceptions[0]!.id,store:'MOUNTAIN_BASE',reason:'TRIAGED'});

 const before=await criticalFingerprint(x.db.pool);
 const envelope=await exportOwnedDatabase(x.db.pool,x.db.identity);

 await check('logical export classifies every table and carries no credential or proof',async()=>{
  assert.equal(envelope.label,BACKUP_LABEL);assert.ok(verifyEnvelope(envelope));
  const names=envelope.tables.map(t=>t.name);
  assert.deepEqual(names,[...RESTORE_REQUIRED] as string[]);
  for(const excluded of Object.keys(NOT_RESTORED))assert.ok(!(names as string[]).includes(excluded),excluded);
  const serialized=JSON.stringify(envelope.tables);
  for(const forbidden of ['auth_account','auth_session','booking_access.recoveries','lease_token'])assert.ok(!serialized.includes('"'+forbidden+'"'),forbidden);
  // Confirmation deliveries are durable; recovery deliveries depend on revoked proofs.
  const outbox=envelope.tables.find(t=>t.name==='public.booking_notification_outbox')!.rows as {event_type:string}[];
  assert.ok(outbox.length>0&&outbox.every(r=>r.event_type!=='BOOKING_RECOVERY'));
  await mkdir('.local/backup-drill',{recursive:true});await writeFile(backupPath,JSON.stringify(envelope),{mode:0o600});
 });

 await check('a tampered or drifted envelope is refused before any restore write',async()=>{
  assert.throws(()=>verifyEnvelope({...envelope,sha256:'0'.repeat(64)}),/BACKUP_INTEGRITY_REFUSED/);
  assert.throws(()=>verifyEnvelope({...envelope,label:'PRODUCTION'}),/BACKUP_INTEGRITY_REFUSED/);
  assert.throws(()=>verifyEnvelope({...envelope,migrations:envelope.migrations.slice(0,-1)}),/BACKUP_INTEGRITY_REFUSED/);
  await assert.rejects(restoreIntoFreshDatabase(x.db.pool,x.db.identity,{...envelope,sha256:'0'.repeat(64)}),/BACKUP_INTEGRITY_REFUSED/);
  await assert.rejects(exportOwnedDatabase(x.db.pool,{namespace:'postgres',database:'postgres'}),/UNOWNED_SOURCE_REFUSED/);
 });

 await check('restore rebuilds a fresh database through canonical migrations only',async()=>{
  restored=await restoreIntoFreshDatabase(x.db.pool,x.db.identity,envelope);
  assert.notEqual(restored.database,x.db.identity.database);
  const registry=(await restored.pool.query('SELECT id,checksum FROM foundation_migrations ORDER BY id')).rows;
  assert.deepEqual(registry,envelope.migrations);
 });

 await check('every restored relationship, constraint and sequence is proved explicitly',async()=>{
  const report=await validateRestored(restored!.pool);
  assert.ok(report.foreignKeys>50,'foreign keys '+report.foreignKeys);
  assert.ok(report.sequences>0);
 });

 await check('critical business and audit rows survive the restore verbatim',async()=>{
  assert.deepEqual(await criticalFingerprint(restored!.pool),before);
 });

 await check('no session, credential or recovery proof comes back',async()=>{
  for(const [table,expectation] of [['auth_account',0],['auth_session',0],['auth_verification',0]] as const)assert.equal(Number((await restored!.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n),expectation,table);
  assert.equal(Number((await restored!.pool.query('SELECT count(*)::int n FROM booking_access.recoveries')).rows[0].n),0);
  assert.ok(Number((await restored!.pool.query('SELECT count(*)::int n FROM auth_user')).rows[0].n)>0);
  assert.ok(Number((await restored!.pool.query('SELECT count(*)::int n FROM staff_members')).rows[0].n)>0);
 });

 await check('the source database is untouched and the raw backup file is removed',async()=>{
  assert.deepEqual(await criticalFingerprint(x.db.pool),before);
  await rm(backupPath,{force:true});
  console.log(JSON.stringify({receipt:'M1.7_LOCAL_LOGICAL_RESTORE',label:BACKUP_LABEL,sourceIdentity:envelope.sourceIdentity,restoredIdentity:restored!.database,backupSha256:envelope.sha256,migrations:envelope.migrations.length,restoredTables:envelope.tables.length,excludedTables:Object.keys(NOT_RESTORED).length,productionPitrProven:false,providerBackup:0}));
 });

 console.log(JSON.stringify({status:'PASS',cases:count,hostedDb:0,providerBackup:0,productionRestoreClaimed:false}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:(e as Error).message.slice(0,500)}));}
finally{await rm(backupPath,{force:true});await restored?.stop();await access?.close();await notify?.close();await ops?.close();await x.close();}
if(failed)process.exit(1);
