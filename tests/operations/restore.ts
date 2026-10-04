import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {writeFile,rm,mkdir,mkdtemp,readdir,readFile,copyFile,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import * as age from 'age-encryption';
import {encryptFileToFileStreaming} from '../../scripts/production-backup';
import {assertPgRestoreVersion,runPgRestore,runRestoreDrill,type DrillAdapters,type RestoreTarget} from '../../scripts/production-restore-drill';
import {resolvePg18Tools,run as runTool} from '../readiness/pg18-tools';
import {flowFixture} from '../flow/fixture';
import {loadStaff,ledgerPrincipal} from '../../packages/auth/src/staff-auth';
import {verifyLedgerWrite} from '../../packages/auth/src/ledger-write-authority';
import {LedgerService} from '../../packages/core/src/catalog/ledger-service';
import {reconcileLedgerProtection} from '../../packages/core/src/catalog/reconcile-protection';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {provisionNotificationRole} from '../../scripts/notification-roles';
import {provisionBookingAccessRole} from '../../scripts/booking-access-role';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {OperationsConsole} from '../../packages/core/src/operations/console-service';
import {FinancialOperations} from '../../packages/core/src/operations/financial';
import {InventoryOperations} from '../../packages/core/src/operations/inventory-service';
import {ProvisionalCapacitySourceOperations} from '../../packages/core/src/operations/provisional-capacity-source';
import {STOCK_IMPORT_HEADER_V3} from '../../packages/contracts/src/stock-import';
import {BookingNotificationWorker} from '../../packages/core/src/notification/worker';
import {BookingRecovery} from '../../packages/core/src/guest/booking-recovery';
import {LoopbackDeliveryAdapter} from '../notification/loopback';
import {exportOwnedDatabase,restoreIntoFreshDatabase,verifyEnvelope,criticalFingerprint,validateRestored,RESTORE_REQUIRED,NOT_RESTORED,BACKUP_LABEL} from '../../scripts/local-restore';
import {requestFor,fid} from '../inventory/fixture';
let failed=false,stage='fixture',count=0,realToolLeg='NOT_RUN';const x=await flowFixture();
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
 const confirmed=await x.draft(undefined,requestFor('2035-03-03'),{reason:'SYNTHETIC logical restore business fixture'});await x.service.startPayment(confirmed.booking.id,randomUUID());
 const ambiguous=await x.draft(undefined,requestFor('2035-03-04'),{reason:'SYNTHETIC logical restore business fixture'});x.fake.failAfterSave=true;await x.service.startPayment(ambiguous.booking.id,randomUUID());x.fake.failAfterSave=false;
 // Durable confirmation delivery, an accepted refund request and a delayed transfer.
 const recovery=new BookingRecovery(access.accessPool,randomBytes(32),'restore-fixture-v1',undefined,5000,true);
 const worker=new BookingNotificationWorker(notify.notificationPool,x.origin,recovery,new LoopbackDeliveryAdapter());
 const delivery=(await worker.enqueueConfirmed(confirmed.booking.id))!;assert.equal((await worker.dispatch(delivery)).state,'ACCEPTED');
 const payment=(await x.db.pool.query('SELECT id FROM rental_payment_attempts WHERE booking_id=$1',[confirmed.booking.id])).rows[0];
 await new FinancialOperations(ctx).requestRefund(randomUUID(),{bookingId:confirmed.booking.id,paymentId:payment.id,actingStore:'MOUNTAIN_BASE',category:'CUSTOMER_EXCEPTION',reason:'SYNTHETIC restore fixture',amountJpy:100});
 const cancelled=await x.draft(undefined,requestFor('2035-03-05'),{reason:'SYNTHETIC cancellation restore fixture'});await x.service.startPayment(cancelled.booking.id,randomUUID());
 const preview=await x.service.cancellationPreview(cancelled.booking.id);await x.service.cancel(cancelled.booking.id,randomUUID(),preview.previewHash);
 const refund=(await x.db.pool.query('SELECT id FROM booking_cancellation_refunds WHERE booking_id=$1',[cancelled.booking.id])).rows[0];
 await x.db.pool.query('SELECT cancellation_refund_claim($1)',[refund.id]);
 const batch=randomUUID(),c=await x.db.pool.connect();
 try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true),set_config('zao.reason','SYNTHETIC restore fixture',true)",[x.actor]);
  await c.query("INSERT INTO transfer_batches(id,source_store,destination_store,scheduled_date,planned_ready_at,needed_by,basis) VALUES($1,'MOUNTAIN_BASE','ONSEN_BASE','2034-12-30','2034-12-30T17:00:00+09:00','2034-12-31T08:30:00+09:00','SYNTHETIC restore transfer')",[batch]);
  await c.query('INSERT INTO transfer_pieces(id,batch_id,line_key,ordinal,asset_id) VALUES($1,$2,$3,1,$4)',[randomUUID(),batch,randomUUID(),fid(1201)]);
  await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 // Observed operational exceptions, one of them acknowledged.
 const page=await console_.list({store:'MOUNTAIN_BASE',type:null,severity:null,ageHours:0,status:'UNACKNOWLEDGED',beforeTime:null,beforeId:null});
 assert.ok(page.exceptions.length>0);await console_.acknowledge(randomUUID(),{id:page.exceptions[0]!.id,store:'MOUNTAIN_BASE',reason:'TRIAGED'});

 // A real normal import path gives the new durable receipt table nonempty restore proof.
 const ledger=new LedgerService(x.roles.ledgerPool,ledgerPrincipal(x.principal),(c,stores,global)=>verifyLedgerWrite(c,x.roles.authPool,x.signed.identity,stores,global),(resource,id,version)=>reconcileLedgerProtection(x.roles.transferPool,x.roles.authPool,x.signed.identity,resource,id,version));
 const provenance={sourceKind:'SYNTHETIC',sourceDocument:'SYNTHETIC restore catalog',sourceLocator:'restore',notes:''};
 const model=await ledger.create('models',{...provenance,code:'RESTORE-SKI',name:'SYNTHETIC restore ski',brand:'SYNTHETIC',family:'SKI',catalogSeason:'2026/27'});
 const variant=await ledger.create('variants',{...provenance,modelId:model.id,family:'SKI',age:'ADULT',tier:'REGULAR',size:'RESTORE-150'});
 const sku={id:variant.id,model_id:model.id,size:'RESTORE-150',name:'SYNTHETIC restore ski',brand:'SYNTHETIC'};
 const csv=STOCK_IMPORT_HEADER_V3.join(',')+'\n'+['SHOP_RECEIPT','ADD',sku.model_id,'2026/27',sku.id,'',1,'ASSET_PAIR',randomUUID(),'MOUNTAIN_BASE','SYNTHETIC restore receipt','row-restore','SKI',sku.size,'REGULAR','','AVAILABLE',sku.brand,sku.name,''].join(',')+'\n';
 const source=await new ProvisionalCapacitySourceOperations(ctx).register(randomUUID(),{sourceSha256:createHash('sha256').update(csv).digest('hex'),originalFilename:'SYNTHETIC restore receipt',buckets:[{family:'SKI',age:'ADULT',sourceSize:sku.size,bookingSize:sku.size,quantity:20,provenance:'SYNTHETIC restore source'}]});
 const inventory=new InventoryOperations(ctx),staged=await inventory.stageImport(randomUUID(),{csv,sheet:'SYNTHETIC restore receipt',provisionalSourceId:source.sourceId});
 assert.equal(staged.ready,true,JSON.stringify(staged.unresolved));await inventory.commitImport(randomUUID(),{id:staged.id,stageSha256:staged.stageSha256,reason:'SYNTHETIC restore receipt'});
 assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM provisional_capacity_receipts WHERE commit_id=$1',[staged.id])).rows[0].n,1);

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
  for(const table of ['provisional_capacity_sources','provisional_capacity_buckets','provisional_capacity_adjustments','provisional_capacity_materializations','provisional_capacity_receipts','provisional_capacity_claims','inventory_buffer_override_log','inventory_pole_exemptions','booking_cancellation_policies','booking_cancellations','booking_cancellation_refunds']){
   const sql=`SELECT to_jsonb(t) v FROM ${table} t ORDER BY to_jsonb(t)::text`;
   assert.deepEqual((await restored!.pool.query(sql)).rows,(await x.db.pool.query(sql)).rows,table);
  }
  for(const db of [x.db.pool,restored!.pool])assert.equal((await db.query('SELECT provisional_capacity_effective_quantity(id) n FROM provisional_capacity_buckets WHERE source_id=$1',[source.sourceId])).rows[0].n,19,'restored receipt still deducts received supply');
  const uncertain=(await restored!.pool.query('SELECT state,dispatched_at FROM booking_cancellation_refunds WHERE id=$1',[refund.id])).rows[0];assert.equal(uncertain.state,'UNKNOWN');assert.ok(uncertain.dispatched_at);
 });

 await check('no session, credential or recovery proof comes back',async()=>{
  for(const [table,expectation] of [['auth_account',0],['auth_session',0],['auth_verification',0]] as const)assert.equal(Number((await restored!.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n),expectation,table);
  assert.equal(Number((await restored!.pool.query('SELECT count(*)::int n FROM booking_access.recoveries')).rows[0].n),0);
  assert.equal(Number((await restored!.pool.query('SELECT count(*)::int n FROM booking_access.cancellation_actions')).rows[0].n),0);
  assert.ok(Number((await restored!.pool.query('SELECT count(*)::int n FROM auth_user')).rows[0].n)>0);
  assert.ok(Number((await restored!.pool.query('SELECT count(*)::int n FROM staff_members')).rows[0].n)>0);
 });

 await check('the source database is untouched and the raw backup file is removed',async()=>{
  assert.deepEqual(await criticalFingerprint(x.db.pool),before);
  await rm(backupPath,{force:true});
  console.log(JSON.stringify({receipt:'M1.7_LOCAL_LOGICAL_RESTORE',label:BACKUP_LABEL,sourceIdentity:envelope.sourceIdentity,restoredIdentity:restored!.database,backupSha256:envelope.sha256,migrations:envelope.migrations.length,restoredTables:envelope.tables.length,excludedTables:Object.keys(NOT_RESTORED).length,productionPitrProven:false,providerBackup:0}));
 });

 await check('real pg_dump, age encryption, real pg_restore into an isolated empty owned database reproduce the same non-empty state; failures leave no plaintext',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'restore-real-'));
  try{
   const {tools,reason}=await resolvePg18Tools(dir);
   if(!tools){
    if(process.env.CI==='true')throw new Error('RESTORE_REAL_TOOLS_UNAVAILABLE_IN_CI: '+reason);
    realToolLeg='SKIPPED';console.log('SKIP real pg_dump/pg_restore leg: '+reason+'. NOT counted as PASS; disallowed whenever CI=true.');return;
   }
   const password=String((x.db.pool.options as {password?:string}).password),pgEnv={PGHOST:'127.0.0.1',PGPORT:String(x.db.identity.dbPort),PGDATABASE:x.db.identity.database,PGUSER:x.db.identity.user,PGPASSWORD:password,PGSSLMODE:'disable'};
   const dump=join(dir,'source.dump'),cipher=join(dir,'source.dump.age');
   const dumped=await runTool(join(tools.binDir,'pg_dump'),['-Fc','--no-owner','--no-acl','-f',dump],pgEnv);assert.equal(dumped.code,0,'pg_dump failed: '+dumped.stderr);
   const identity=await age.generateIdentity(),recipient=await age.identityToRecipient(identity),other=await age.generateIdentity();
   const enc=await encryptFileToFileStreaming(dump,cipher,recipient);await rm(dump);
   const pgRestorePath=join(tools.binDir,'pg_restore'),newTarget=async():Promise<RestoreTarget>=>{const database='zr_'+randomBytes(6).toString('hex');await x.db.pool.query(`CREATE DATABASE ${database}`);return {host:'127.0.0.1',port:x.db.identity.dbPort,user:x.db.identity.user,password,database};};
   const calls={fetch:0,restore:0},work=join(dir,'work');await mkdir(work);
   const adapters=(source:string):DrillAdapters=>({fetchCiphertext:async(_k,out)=>{calls.fetch++;await copyFile(source,out);return {bytes:(await lstat(out)).size};},restore:async(dumpPath,t)=>{calls.restore++;await runPgRestore({pgRestorePath,dumpPath,target:t});},
    openTarget:t=>new Pool({host:t.host,port:t.port,user:t.user,password:t.password,database:t.database,max:4}),toolVersion:()=>assertPgRestoreVersion(pgRestorePath),now:()=>new Date()});
   const key='hourly/2026/10/04/2026-10-04T05-17-00-000Z.dump.age',base={dataClass:'SYNTHETIC' as const,key,scheduledAt:'2026-10-04T05:17:00.000Z',identity,workParent:work};
   const input=(target:RestoreTarget,extra:Record<string,unknown>={})=>({...base,expected:{sha256:enc.sha256},target,...extra}) as Parameters<typeof runRestoreDrill>[1];
   // 1. Wrong key and tampered ciphertext stop before pg_restore; nothing is left behind.
   const wrongTarget=await newTarget();
   await assert.rejects(runRestoreDrill(adapters(cipher),input(wrongTarget,{identity:other})),/RESTORE_WRONG_KEY_REJECTED/);
   const bytes=await readFile(cipher);bytes[bytes.length-100]=bytes[bytes.length-100]!^0xff;const tampered=join(dir,'tampered.age');await writeFile(tampered,bytes);
   await assert.rejects(runRestoreDrill(adapters(tampered),input(wrongTarget)),/RESTORE_CIPHERTEXT_INVALID/);
   assert.equal(calls.restore,0);assert.deepEqual(await readdir(work),[]);
   // 2. A correctly decrypted but unreadable archive fails in the real pg_restore, rolls back, and leaves no plaintext.
   const garbage=randomBytes(4096),garbagePlain=join(dir,'garbage.bin'),garbageCipher=join(dir,'garbage.age');await writeFile(garbagePlain,garbage);const garbageEnc=await encryptFileToFileStreaming(garbagePlain,garbageCipher,recipient);
   await assert.rejects(runRestoreDrill(adapters(garbageCipher),input(wrongTarget,{expected:{sha256:garbageEnc.sha256}})),/RESTORE_PG_RESTORE_FAILED/);
   assert.deepEqual(await readdir(work),[]);const probe=new Pool({host:'127.0.0.1',port:wrongTarget.port,user:wrongTarget.user,password,database:wrongTarget.database,max:1});
   try{assert.equal(Number((await probe.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname NOT IN ('pg_catalog','information_schema') AND s.nspname !~ '^pg_toast'")).rows[0].n),0);}finally{await probe.end();}
   // 3. The source (non-empty) database is never accepted as a restore target.
   const before=calls.fetch;await assert.rejects(runRestoreDrill(adapters(cipher),input({host:'127.0.0.1',port:x.db.identity.dbPort,user:x.db.identity.user,password,database:x.db.identity.database})),/RESTORE_TARGET_NOT_EMPTY_REJECTED/);assert.equal(calls.fetch,before);
   // 4. The real round trip.
   const target=await newTarget(),result=await runRestoreDrill(adapters(cipher),input(target));
   assert.equal(result.status,'DRILL_PASS');assert.equal(result.plaintextSha256,enc.sha256);assert.match(result.toolVersion,/^pg_restore \(PostgreSQL\) 18\./);assert.equal(result.productionRpoRtoApproved,false);
   assert.deepEqual(result.verification.critical,await criticalFingerprint(x.db.pool));
   assert.ok(result.verification.foreignKeys>50&&result.verification.sequences>0&&result.verification.migrations===envelope.migrations.length);
   const restoredPool=new Pool({host:'127.0.0.1',port:target.port,user:target.user,password,database:target.database,max:2});
   try{
    for(const table of RESTORE_REQUIRED){const sql=`SELECT to_jsonb(t) v FROM ${table} t ORDER BY to_jsonb(t)::text`;assert.deepEqual((await restoredPool.query(sql)).rows,(await x.db.pool.query(sql)).rows,table);}
    for(const db of [x.db.pool,restoredPool])assert.equal((await db.query('SELECT provisional_capacity_effective_quantity(id) n FROM provisional_capacity_buckets WHERE source_id=$1',[source.sourceId])).rows[0].n,19,'real restore keeps the received receipt deduction');
    assert.equal(Number((await restoredPool.query('SELECT count(*)::int n FROM provisional_capacity_receipts')).rows[0].n),Number((await x.db.pool.query('SELECT count(*)::int n FROM provisional_capacity_receipts')).rows[0].n));
   }finally{await restoredPool.end();}
   assert.deepEqual(await readdir(work),[]);
   realToolLeg='PASS via '+tools.label;
  }finally{await rm(dir,{recursive:true,force:true});}
 });

 console.log(JSON.stringify({status:'PASS',cases:count,hostedDb:0,providerBackup:0,realPgToolLeg:realToolLeg,productionRestoreClaimed:false}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:(e as Error).message.slice(0,500)}));}
finally{await rm(backupPath,{force:true});await restored?.stop();await access?.close();await notify?.close();await ops?.close();await x.close();}
if(failed)process.exit(1);
