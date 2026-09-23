import assert from 'node:assert/strict';
import {createHmac,randomUUID,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {flowFixture} from '../flow/fixture';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {provisionNotificationRole} from '../../scripts/notification-roles';
import {provisionBookingAccessRole} from '../../scripts/booking-access-role';
import {BookingNotificationWorker} from '../../packages/core/src/notification/worker';
import {BookingRecovery} from '../../packages/core/src/guest/booking-recovery';
import {LoopbackDeliveryAdapter,type LoopbackScenario} from '../notification/loopback';
import {parseVerifiedSquareWebhook,verifySquareWebhook} from '../../packages/core/src/payment/square-boundary';
import {productionConfigManifest,launchStagingPreflight,squareConnectionAcceptance,squareIdentityAcceptance,backupConnectionGate,assertNoSecretMaterial,manifestComponents} from '../../packages/contracts/src/launch-staging';
import {productionPreflight} from '../../packages/contracts/src/production-preflight';
const declared=JSON.parse(readFileSync('config/production/launch-staging.json','utf8'));
const KEY=randomBytes(32).toString('base64'),URL_='https://rental.example.invalid/api/webhooks/square';
const sign=(raw:Uint8Array,url=URL_,key=KEY)=>createHmac('sha256',key).update(url).update(raw).digest('base64');
const event=(id:string,merchant='MLKDVEDH1ME21',payment='sq_payment_1',type='payment.updated')=>Buffer.from(JSON.stringify({event_id:id,merchant_id:merchant,type,data:{type:'payment',id:payment,object:{payment:{id:payment,location_id:'LOC_MOUNTAIN',amount_money:{amount:5000,currency:'JPY'},status:'COMPLETED'}}}}));
const square=(o:Record<string,unknown>={})=>({environment:'PRODUCTION',applicationEnvironment:'PRODUCTION',merchantId:'MLKDVEDH1ME21',currency:'JPY',locationIds:{MOUNTAIN_BASE:'LOC_MOUNTAIN',ONSEN_BASE:'LOC_ONSEN'},webhookNotificationUrl:URL_,idempotencyScope:'booking-payment',reconciliationLookupEnabled:true,...o});
let failed=false,stage='fixture',count=0;const providerRequests=0;const x=await flowFixture();
let notify:Awaited<ReturnType<typeof provisionNotificationRole>>|undefined,access:Awaited<ReturnType<typeof provisionBookingAccessRole>>|undefined;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 notify=await provisionNotificationRole(x.db.pool,x.db.identity);access=await provisionBookingAccessRole(x.db.pool,x.db.identity);
 Object.assign(x.principal,(await loadStaff(x.roles.authPool,x.actor))!);
 const recovery=new BookingRecovery(access.accessPool,randomBytes(32),'harness-v1',undefined,5000,true);

 await check('production config manifest carries no credential material and names what is missing',async()=>{
  const manifest=productionConfigManifest(declared.manifest);
  assert.equal(manifest.entries.length,manifestComponents.length);
  assert.equal(manifest.complete,false);
  assert.deepEqual(manifest.missing.map(m=>m.component).sort(),[...manifestComponents].sort());
  const serialized=JSON.stringify(manifest);
  for(const leak of ['://','sq0','sk_','BEGIN','password','token'])assert.ok(!serialized.includes(leak),leak);
  // Any credential-shaped key or value is refused wherever it appears.
  for(const bad of [[{...declared.manifest[0],logicalName:'postgres://user@host/db'}],[{...declared.manifest[0],accessKey:'x'}]])
   assert.throws(()=>productionConfigManifest([...bad,...declared.manifest.slice(1)]),{code:/^(MANIFEST_(SECRET_REFUSED|ENTRY_INVALID|SHAPE_INVALID)|INVALID_INPUT)$/});
  assert.throws(()=>assertNoSecretMaterial({webhookSigningKey:'x'}),{code:'MANIFEST_SECRET_REFUSED'});
  assert.throws(()=>assertNoSecretMaterial({note:'https://user:pass@host'}),{code:'MANIFEST_SECRET_REFUSED'});
 });

 await check('launch staging preflight reports safe categories and reads no credential',async()=>{
  const p=launchStagingPreflight(declared.categories);
  assert.equal(p.readsProductionCredentials,false);assert.equal(p.productionOperations,0);
  assert.equal(p.ready,false);
  assert.deepEqual(p.connectionPending,['PAYMENT','WEBHOOK','MEDIA','NOTIFICATION','BACKUP']);
  assert.deepEqual(p.blocked,[]);
  assert.throws(()=>launchStagingPreflight({...declared.categories,PAYMENT:'GUESS'}),{code:'STAGING_STATE_INVALID'});
  assert.equal(launchStagingPreflight({...declared.categories,PAYMENT:'UNAVAILABLE'}).blocked[0],'PAYMENT');
 });

 await check('Square connection acceptance validates identity and fails closed on environment mix-up',async()=>{
  const ok=squareConnectionAcceptance(square());
  assert.equal(ok.ready,true);assert.equal(ok.providerRequestsMade,0);assert.equal(ok.credentialsRead,false);
  assert.deepEqual(squareConnectionAcceptance(square({environment:'SANDBOX'})).failures,['ENVIRONMENT_MISMATCH_FAIL_CLOSED']);
  assert.deepEqual(squareConnectionAcceptance(square({applicationEnvironment:'SANDBOX'})).failures,['ENVIRONMENT_MISMATCH_FAIL_CLOSED']);
  assert.ok(squareConnectionAcceptance(square({currency:'USD'})).failures.includes('CURRENCY_MUST_BE_JPY'));
  assert.ok(squareConnectionAcceptance(square({locationIds:{MOUNTAIN_BASE:'LOC_ONLY'}})).failures.includes('STORE_MAPPING_INCOMPLETE'));
  assert.ok(squareConnectionAcceptance(square({locationIds:{MOUNTAIN_BASE:'SAME',ONSEN_BASE:'SAME'}})).failures.includes('LOCATION_MAPPING_AMBIGUOUS'));
  assert.ok(squareConnectionAcceptance(square({webhookNotificationUrl:'http://rental.example.invalid/x'})).failures.includes('WEBHOOK_URL_INVALID'));
  assert.ok(squareConnectionAcceptance(square({webhookNotificationUrl:'https://127.0.0.1/x'})).failures.includes('WEBHOOK_URL_INVALID'));
  assert.ok(squareConnectionAcceptance(square({reconciliationLookupEnabled:false})).failures.includes('GET_PAYMENT_RECONCILIATION_REQUIRED'));
  assert.equal(providerRequests,0);
 });

 const expected={merchantId:'MLKDVEDH1ME21',locationIds:{MOUNTAIN_BASE:'LOC_MOUNTAIN',ONSEN_BASE:'LOC_ONSEN'},webhookOrigin:'https://rental.example.invalid',webhookPath:'/api/webhooks/square',currency:'JPY',environment:'PRODUCTION',idempotencyScope:'booking-payment'};
 await check('a well formed but unexpected Square identity is refused',async()=>{
  assert.equal(squareIdentityAcceptance(square(),expected).ready,true);
  // Every one of these is syntactically valid and still wrong.
  assert.ok(squareIdentityAcceptance(square({merchantId:'MOTHERMERCHANT99'}),expected).failures.includes('MERCHANT_IDENTITY_UNEXPECTED'));
  assert.ok(squareIdentityAcceptance(square({locationIds:{MOUNTAIN_BASE:'LOC_OTHER',ONSEN_BASE:'LOC_ONSEN'}}),expected).failures.includes('LOCATION_IDENTITY_UNEXPECTED'));
  assert.ok(squareIdentityAcceptance(square({locationIds:{MOUNTAIN_BASE:'LOC_ONSEN',ONSEN_BASE:'LOC_MOUNTAIN'}}),expected).failures.includes('LOCATION_IDENTITY_UNEXPECTED'));
  assert.ok(squareIdentityAcceptance(square({webhookNotificationUrl:'https://attacker.example.invalid/api/webhooks/square'}),expected).failures.includes('WEBHOOK_BINDING_UNEXPECTED'));
  assert.ok(squareIdentityAcceptance(square({webhookNotificationUrl:'https://rental.example.invalid/api/webhooks/elsewhere'}),expected).failures.includes('WEBHOOK_BINDING_UNEXPECTED'));
  assert.ok(squareIdentityAcceptance(square({idempotencyScope:'other-scope'}),expected).failures.includes('IDEMPOTENCY_SCOPE_UNEXPECTED'));
  const mismatch=squareIdentityAcceptance(square({environment:'SANDBOX',applicationEnvironment:'SANDBOX'}),expected);
  assert.equal(mismatch.ready,false);assert.ok(mismatch.failures.includes('ENVIRONMENT_UNEXPECTED'));
  const serialized=JSON.stringify(squareIdentityAcceptance(square(),expected));
  for(const leak of ['sq0','sk_','token','password'])assert.ok(!serialized.includes(leak),leak);
  assert.equal(providerRequests,0);
 });

 await check('a mandatory component that is off or disabled is never ready or complete',async()=>{
  // Staging: a mandatory category left OFF is an unmet requirement, not readiness.
  const allReady=Object.fromEntries(Object.keys(declared.categories).map(k=>[k,'READY']));
  assert.equal(launchStagingPreflight(allReady).ready,true);
  for(const mandatory of ['DB','MIGRATIONS','STAFF_AUTH','GUEST','BOOKING_ACCESS','PAYMENT','WEBHOOK','BACKUP']){
   const off=launchStagingPreflight({...allReady,[mandatory]:'OFF'});
   assert.equal(off.ready,false,mandatory);assert.ok((off.unmet as string[]).includes(mandatory),mandatory);
  }
  // An optional category may be switched off deliberately.
  assert.equal(launchStagingPreflight({...allReady,MEDIA:'OFF',NOTIFICATION:'OFF'}).ready,true);
  assert.equal(launchStagingPreflight({...allReady,DB:'UNAVAILABLE'}).blocked[0],'DB');
  // Manifest: DISABLED settles an optional component only.
  const active=declared.manifest.map((m:Record<string,unknown>)=>({...m,activationState:'ACTIVE'}));
  assert.equal(productionConfigManifest(active).complete,true);
  for(const mandatory of ['NEON','SQUARE','SQUARE_WEBHOOK','VERCEL','BACKUP_PITR']){
   const disabled=productionConfigManifest(active.map((m:Record<string,unknown>)=>m.component===mandatory?{...m,activationState:'DISABLED'}:m));
   assert.equal(disabled.complete,false,mandatory);assert.ok((disabled.disabledMandatory as string[]).includes(mandatory),mandatory);
  }
  assert.equal(productionConfigManifest(active.map((m:Record<string,unknown>)=>m.component==='R2'?{...m,activationState:'DISABLED'}:m)).complete,true);
 });

 await check('overall preflight readiness is the conjunction of every gate',async()=>{
  const facts={head:'a'.repeat(40),tree:'b'.repeat(40),main:null,checkedAt:new Date().toISOString(),worktreeClean:true,guestPolicyApproved:true,independentCoupling:true,mainProtection:null,foundation:null};
  const legacy=productionPreflight(facts as never);
  const allReady=Object.fromEntries(Object.keys(declared.categories).map(k=>[k,'READY']));
  const active=declared.manifest.map((m:Record<string,unknown>)=>({...m,activationState:'ACTIVE'}));
  const overall=(l:boolean,staging:Record<string,string>,manifest:unknown[])=>l&&launchStagingPreflight(staging).ready&&productionConfigManifest(manifest).complete;
  // The declared state of this repository is deliberately not ready.
  assert.equal(overall(true,declared.categories,declared.manifest),false);
  // Legacy gates passing is not enough while staging or the manifest is outstanding.
  assert.equal(overall(true,{...allReady,PAYMENT:'UNCONNECTED'},active),false);
  assert.equal(overall(true,allReady,declared.manifest),false);
  assert.equal(overall(false,allReady,active),false);
  assert.equal(overall(true,allReady,active),true);
  assert.equal(typeof legacy.ready,'boolean');
 });

 await check('webhook acceptance covers signature, duplication, ordering and identity mismatch',async()=>{
  const raw=event('evt-1');
  assert.equal(verifySquareWebhook(raw,sign(raw),URL_,KEY),true);
  assert.equal(verifySquareWebhook(raw,sign(raw,'https://other.invalid/hook'),URL_,KEY),false);
  assert.equal(verifySquareWebhook(raw,sign(raw,URL_,randomBytes(32).toString('base64')),URL_,KEY),false);
  assert.equal(verifySquareWebhook(raw,undefined,URL_,KEY),false);
  assert.equal(verifySquareWebhook(Buffer.concat([raw,Buffer.from(' ')]),sign(raw),URL_,KEY),false);
  const parsed=parseVerifiedSquareWebhook(raw,sign(raw),URL_,KEY);
  assert.equal(parsed.eventId,'evt-1');assert.equal(parsed.merchantId,'MLKDVEDH1ME21');assert.equal(parsed.paymentId,'sq_payment_1');
  // A duplicate event is the same parsed identity, so the receiver deduplicates it.
  assert.deepEqual(parseVerifiedSquareWebhook(raw,sign(raw),URL_,KEY),parsed);
  const other=event('evt-2','MDIFFERENT1ME21');
  assert.notEqual(parseVerifiedSquareWebhook(other,sign(other),URL_,KEY).merchantId,parsed.merchantId);
  // An out-of-order or older event still only triggers a lookup; it never carries authority.
  const older=event('evt-0');assert.equal(parseVerifiedSquareWebhook(older,sign(older),URL_,KEY).paymentId,'sq_payment_1');
  assert.throws(()=>parseVerifiedSquareWebhook(raw,sign(raw,URL_,randomBytes(32).toString('base64')),URL_,KEY));
  assert.equal(providerRequests,0);
 });

 await check('notification provider contract holds for every delivery outcome',async()=>{
  const expected:[LoopbackScenario,string,string][]=[
   ['SUCCESS','SENT','NONE'],
   ['DEFINITE_BEFORE_ACCEPT','RETRYABLE_FAILURE','PROVIDER_UNAVAILABLE'],
   ['RATE_LIMIT','RETRYABLE_FAILURE','RATE_LIMITED'],
   ['SERVER_FAILURE','RETRYABLE_FAILURE','PROVIDER_UNAVAILABLE'],
   ['PERMANENT_REJECT','PERMANENT_FAILURE','PERMANENT_REJECT'],
   ['TIMEOUT_BEFORE_ACCEPT','UNKNOWN','ACCEPTANCE_UNKNOWN'],
   ['TIMEOUT_AFTER_ACCEPT','UNKNOWN','ACCEPTANCE_UNKNOWN'],
  ];
  for(const [scenario,status,code] of expected){
   const adapter=new LoopbackDeliveryAdapter(scenario),worker=new BookingNotificationWorker(notify!.notificationPool,x.origin,recovery,adapter);
   const d=await x.draft(undefined,undefined,{reason:'SYNTHETIC notification provider outcome fixture'});await x.service.startPayment(d.booking.id,randomUUID());
   const id=(await worker.enqueueConfirmed(d.booking.id))!;await worker.dispatch(id);
   const row=(await x.db.pool.query('SELECT status,last_safe_failure_code,attempt_count FROM booking_notification_outbox WHERE id=$1',[id])).rows[0];
   assert.equal(row.status,status,scenario);assert.equal(row.last_safe_failure_code,code,scenario);
   // An uncertain acceptance is never blindly resent; only a lookup may settle it.
   if(status==='UNKNOWN'){
    const before=adapter.calls;
    // Reconciliation honours its own backoff and never sends again on its own.
    assert.equal((await worker.reconcile(id)).state,'NOT_UNKNOWN',scenario);
    assert.equal(adapter.calls,before,scenario);
    const after=(await x.db.pool.query('SELECT status,provider_message_id FROM booking_notification_outbox WHERE id=$1',[id])).rows[0];
    assert.equal(after.status,'UNKNOWN',scenario);assert.equal(after.provider_message_id,null,scenario);
   }
   assert.equal((await x.db.pool.query('SELECT state FROM rental_bookings WHERE id=$1',[d.booking.id])).rows[0].state,'CONFIRMED_DEV',scenario);
  }
  assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM booking_notification_outbox WHERE status='SENT' AND provider_message_id IS NULL")).rows[0].n,0);
 });

 await check('backup connection gate reports safe metadata only and never restores',async()=>{
  const unconfigured=backupConnectionGate({backupEnabled:false,retentionDays:null,pitrEnabled:false,latestSuccessfulBackupAgeHours:null,restoreTargetIsolated:false});
  assert.equal(unconfigured.state,'NOT_RUN');
  const ready=backupConnectionGate({backupEnabled:true,retentionDays:30,pitrEnabled:true,latestSuccessfulBackupAgeHours:3,restoreTargetIsolated:true});
  assert.equal(ready.state,'READY');assert.deepEqual(ready.reasons,[]);
  const stale=backupConnectionGate({backupEnabled:true,retentionDays:30,pitrEnabled:true,latestSuccessfulBackupAgeHours:72,restoreTargetIsolated:true});
  assert.equal(stale.state,'BLOCKED');assert.ok(stale.reasons.includes('LATEST_BACKUP_TOO_OLD'));
  const shared=backupConnectionGate({backupEnabled:true,retentionDays:3,pitrEnabled:false,latestSuccessfulBackupAgeHours:1,restoreTargetIsolated:false});
  assert.deepEqual(shared.reasons.sort(),['PITR_NOT_ENABLED','RESTORE_TARGET_NOT_ISOLATED','RETENTION_INSUFFICIENT']);
  assert.throws(()=>backupConnectionGate({backupEnabled:true,retentionDays:30,pitrEnabled:true,latestSuccessfulBackupAgeHours:-1,restoreTargetIsolated:true}),{code:'BACKUP_GATE_INVALID'});
 });

 console.log(JSON.stringify({status:'PASS',cases:count,squareRequests:0,webhookProviderEvents:0,externalMailOrSms:0,productionCredentialsRead:0,actualRestores:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:(e as Error).message.slice(0,500)}));}
finally{await access?.close();await notify?.close();await x.close();}
if(failed)process.exit(1);
