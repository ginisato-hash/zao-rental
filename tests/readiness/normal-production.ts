import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {Readable} from 'node:stream';
import {publicMediaHandler} from '../../apps/web/src/lib/public-media-http';
import {seedPublicContent} from '../public/content-seed';
import {registerWear} from '../wear/fixture';
import {LedgerService} from '../../packages/core/src/catalog/ledger-service';
import {WearService} from '../../packages/core/src/wear/service';
import {ledgerPrincipal} from '../../packages/auth/src/staff-auth';
import {verifyLedgerWrite} from '../../packages/auth/src/ledger-write-authority';
import {reconcileLedgerProtection} from '../../packages/core/src/catalog/reconcile-protection';
import {normalProductionFixture} from './normal-production-fixture';
import {composeProductionRuntime,productionConfigurationDigest,type ProductionRuntime} from '../../packages/core/src/guest/production-runtime';
import {productionConfiguration,ProductionStartupError} from '../../packages/auth/src/production-config';
import {verifyProductionDatabase} from '../../packages/db/src/production-connection';
import {guestHandler} from '../../apps/web/src/lib/guest-http';
import {bookingAccessHandler} from '../../apps/web/src/lib/booking-access-http';
import {readinessResponse,readinessDetails} from '../../apps/web/src/lib/readiness-http';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {QuoteService} from '../../packages/core/src/pricing/quote-service';
import {BookingService} from '../../packages/core/src/payment/booking-service';
import {simulation} from '../flow/fixture';
import {skiSet} from '../inventory/fixture';
import {guestCookie} from '../../packages/core/src/guest/context';
const x=await normalProductionFixture();let runtime:ProductionRuntime|undefined,failed=false,stage='startup',count=0;
const check=async(name:string,fn:()=>Promise<void>)=>{stage=name;await fn();count++;console.log('PASS '+name);};
try{
 const input=x.input();
 await check('actual database role and database identity, not caller labels, reject owner/wrong DB/role',async()=>{
  const config=productionConfiguration(input.configuration);await assert.rejects(verifyProductionDatabase(x.db.pool,config,'auth'),{stage:'DB_CONFIG'});
  await assert.rejects(verifyProductionDatabase(x.roles.authPool,{...config,database:{...config.database,name:'wrong_database'}},'auth'),{stage:'DB_CONFIG'});
  await assert.rejects(verifyProductionDatabase(x.roles.holdPool,config,'auth'),{stage:'DB_CONFIG'});
 });
 await check('failed startup closes earlier authenticated pools and never publishes runtime',async()=>{const created:Pool[]=[];await assert.rejects(composeProductionRuntime({...input,connect:async(c,s,v)=>{const p=await input.connect!(c,s,v);created.push(p);if(created.length===2){await p.end();throw Error('SYNTHETIC_DB_FAILURE');}return p;}}),{stage:'DB_CONFIG'});assert.equal(created.length,2);assert.ok(created.every(p=>p.ended));});

 await check('Production payment port validates real in-memory credential material and rejects Sandbox/missing credentials without a dispatch',async()=>{
  let providerCalls=0;const original=productionConfiguration(input.configuration),payment={provider:'SQUARE' as const,environment:'PRODUCTION' as const,merchantId:'synthetic-m15-merchant',locations:{MOUNTAIN_BASE:'synthetic-mountain',ONSEN_BASE:'synthetic-onsen'}},config=productionConfiguration({...original,flags:{...original.flags,payment:true},payment});
  const binding={provider:'SQUARE' as const,environment:'PRODUCTION' as const,merchantId:payment.merchantId,credentials:async()=>({environment:'PRODUCTION' as const,merchantId:payment.merchantId,token:randomBytes(24).toString('hex'),revoked:false as const}),gateway:{kind:'SQUARE_PRODUCTION' as const,create:async()=>{providerCalls++;throw Error('SYNTHETIC_TRANSPORT_ONLY');},lookup:async()=>{providerCalls++;return null;}}};
  const options={...input,configuration:config,approvedConfigurationSha256:productionConfigurationDigest(config),payment:binding};
  for(const patch of [undefined,{...binding,credentials:async()=>({...await binding.credentials(),token:''})},{...binding,credentials:async()=>({...await binding.credentials(),environment:'SANDBOX'})},{...binding,gateway:{...binding.gateway,kind:'SQUARE_SANDBOX'}}])await assert.rejects(composeProductionRuntime({...options,payment:patch as typeof binding}),{stage:'PAYMENT'});
  const p=await composeProductionRuntime(options);try{assert.equal(p.payment,binding.gateway);assert.equal(p.safeStatus().PAYMENT_ADAPTER,'CONFIGURED_ACTIVATION_PENDING');assert.equal(providerCalls,0);}finally{await p.close();}
 });

 await check('F1 payment OFF never retains or invokes a supplied unvalidated Sandbox gateway/credential resolver',async()=>{
  let calls=0;const disabled=await composeProductionRuntime({...input,payment:{provider:'SQUARE',environment:'PRODUCTION',merchantId:'wrong',credentials:async()=>{calls++;throw Error('MUST_NOT_RESOLVE_DISABLED_CREDENTIAL');},gateway:{kind:'SQUARE_SANDBOX',create:async()=>{calls++;throw Error();},lookup:async()=>{calls++;return null;}}}});try{assert.equal(disabled.payment,null);assert.equal(disabled.safeStatus().PAYMENT_ADAPTER,'OFF');assert.equal(calls,0);}finally{await disabled.close();}
 });
 await check('F2 media-only composition serves current released private bytes without guest/staff, and revocation or failure denies',async()=>{
  const ledger=new LedgerService(x.roles.ledgerPool,ledgerPrincipal(x.principal),(c,s,a)=>verifyLedgerWrite(c,x.roles.authPool,x.signed.identity,s,a),(r,id,v)=>reconcileLedgerProtection(x.roles.transferPool,x.roles.authPool,x.signed.identity,r,id,v)),wear=new WearService(x.flow.flowPool,x.roles.authPool,x.signed.identity),stock=await registerWear(ledger,wear),seed=await seedPublicContent(x.db.pool,x.actor,{id:stock.models.SKI!,variantIds:[stock.variants['SKI-150 cm']!],season:'2026/27'});
  const state=structuredClone(seed.state),release=randomUUID();state.catalog.current=release;state.catalog.releases.push({id:release,entries:Object.values(state.catalog.draftIds)} as typeof state.catalog.releases[number]);await x.db.pool.query('UPDATE content_workspace SET value=$1',[JSON.stringify(state)]);await x.db.pool.query("UPDATE content_model_previews SET state='PREVIEW_APPROVED' WHERE slug='synthetic-ski'");
  const variant=seed.media.variants[0]!,digest=variant.src.split('/')[2]!,bytes=(await x.db.pool.query('SELECT bytes FROM content_media_objects WHERE sha256=$1',[digest])).rows[0].bytes as Buffer;let calls=0,fail=false,revokeDuringRead=false;const connected:string[]=[];
  const options=x.input({booking:false,guestRecovery:false,staffOperations:false,media:true});const media=await composeProductionRuntime({...options,connect:async(c,s,v)=>{connected.push(s);return options.connect!(c,s,v);},media:{environment:'PRODUCTION',permission:'OBJECT_READ',credentials:async()=>({accountId:'a'.repeat(32),bucket:'synthetic-m15-private',accessKeyId:randomBytes(12).toString('hex'),secretAccessKey:randomBytes(32).toString('hex'),expiresAt:new Date('2099-01-01T00:00:00Z'),revoked:false}),requestHandler:{handle:async()=>{calls++;if(fail)throw Error('SYNTHETIC_READ_FAILURE');if(revokeDuringRead)await x.db.pool.query("UPDATE content_model_previews SET rights_verified=false WHERE slug='synthetic-ski'");return {response:{statusCode:200,headers:{'content-type':variant.type,'x-amz-meta-sha256':digest},body:Readable.from(bytes)}};}}}});
  try{assert.deepEqual(connected,['content_read']);assert.equal(media.guest,null);assert.equal(media.staff,null);assert.equal(media.public,null);assert.ok(media.contentReadPool);const route=publicMediaHandler({pool:media.contentReadPool,readBytes:media.readDerivative}),request=()=>new Request(options.deployment.origin+variant.src);const ok=await route(request());assert.equal(ok.status,200);assert.deepEqual(Buffer.from(await ok.arrayBuffer()),bytes);assert.equal(calls,1);
   fail=true;assert.equal((await route(request())).status,404);fail=false;revokeDuringRead=true;assert.equal((await route(request())).status,404);const used=calls;assert.equal((await route(request())).status,404);assert.equal(calls,used);assert.equal((await publicMediaHandler(null)(request())).status,404);
  }finally{await media.close();}
 });
 runtime=await composeProductionRuntime(input);const r=runtime,origin=r.configuration.deployment.origin;
 await check('least-privilege normal runtime boots with Avatar/media OFF, separate access/recovery keys and safe readiness',async()=>{assert.equal(r.avatar,null);assert.ok(r.guest&&r.access&&r.recovery&&r.staff);assert.equal(r.safeStatus().NOTIFICATION,'UNCONNECTED');assert.deepEqual(await readinessResponse({ready:true,stage:'READY'}).json(),{status:'READY'});const anonymous={status:'anonymous' as const,principal:null,stamp:null};assert.equal(readinessDetails({ready:true,stage:'READY'},anonymous,r.safeStatus()).status,401);assert.equal(readinessDetails({ready:true,stage:'READY'},{status:'authorized',principal:{...x.principal,permissions:['BOOKING_VIEW']},stamp:'synthetic'},r.safeStatus()).status,403);const out=await readinessDetails({ready:false,stage:'DB_CONFIG'},{status:'authorized',principal:{...x.principal,permissions:['STAFF_MANAGE']},stamp:'synthetic'},{...r.safeStatus(),DB:'SYNTHETIC_RAW_SECRET',password:'SYNTHETIC_RAW_SECRET'}).text();assert.ok(!out.includes('SYNTHETIC_RAW_SECRET'));assert.equal((await readinessResponse({ready:false,stage:'DB_CONFIG'}).json()).stage,undefined);});
 const c=await r.guest!.security.service.create(),actor=await r.guest!.contexts.resolve(c.token),service=r.service(actor);
 let bookingId='',token='';
 await check('canonical HOLD/quote/fixture payment then composed payment-state/access reads survive Avatar OFF',async()=>{
  assert.ok((await service.get()).id);const h=new HoldService(x.roles.holdPool,actor),q=new QuoteService(x.roles.pricingPool,actor),b=new BookingService(x.flow.flowPool,x.guestRole.guestPool,actor,x.fake,simulation),conditions=skiSet('2035-02-05'),held=await h.command('create',randomUUID(),conditions),quote=(await q.create(randomUUID(),{conditions,holdId:held.holdId,couponCode:null,wantAdvance:false})).quote;
  const booking=await b.create(randomUUID(),quote.id,{displayName:'SYNTHETIC M15',email:'synthetic-m15@example.invalid',termsAccepted:true});bookingId=booking.id;await b.startPayment(booking.id,randomUUID());
  await x.db.pool.query('UPDATE guest_drafts SET booking_id=$2 WHERE context_id=$1',[actor.contextId,booking.id]);
  const v=await service.get();assert.equal(v.booking?.state,'CONFIRMED_DEV');assert.equal(v.booking.payments[0]!.state,'COMPLETED');const issued=await r.access!.issue(actor,booking.id,randomUUID());token=issued.token;assert.equal((await r.access!.read(token)).id,booking.id);assert.equal(x.fake.calls.length,1);
 });

 await check('F6: rental_bookings_mode_state_check — real DB CHECK constraint rejects every illegal mode/state crossing and accepts every legal one, against this real committed booking row (not a synthetic fixture)',async()=>{
  // The existing rental_booking_guard trigger only permits state/confirmed_at/version to change
  // on UPDATE (any other diff — including mode — is refused as "immutable booking contract"), so
  // proving the mode_state CHECK constraint itself (not that trigger) requires disabling it for
  // this one probe, on this one already-real, already-FK-satisfied row, then restoring both the
  // trigger and the row's original mode/state exactly before any later check relies on either.
  const original=(await x.db.pool.query('SELECT mode,state,confirmed_at FROM rental_bookings WHERE id=$1',[bookingId])).rows[0] as {mode:string;state:string;confirmed_at:string};
  // rental_booking_guard (BEFORE, blocks any column but state/confirmed_at/version changing) and
  // rental_bookings_audit (AFTER, requires the app-set `zao.actor` session parameter this raw
  // admin probe never sets) both need to be out of the way for a direct mode/state UPDATE —
  // neither is the thing under test here, and both are restored, with the row's original
  // mode/state, before this check returns.
  await x.db.pool.query('ALTER TABLE rental_bookings DISABLE TRIGGER rental_booking_guard, DISABLE TRIGGER rental_bookings_audit');
  try{
   const rejected=[
    ['SIMULATED_DEV','CONFIRMED'],['SQUARE_SANDBOX','CONFIRMED'],
    ['SQUARE_PRODUCTION','CONFIRMED_DEV'],['SQUARE_PRODUCTION','COMPLETED_DEV'],
   ] as const;
   for(const [mode,state] of rejected){
    await assert.rejects(x.db.pool.query('UPDATE rental_bookings SET mode=$2,state=$3 WHERE id=$1',[bookingId,mode,state]),{code:'23514',constraint:'rental_bookings_mode_state_check'},`${mode}+${state} must be rejected`);
   }
   const accepted=[
    ['SIMULATED_DEV','CONFIRMED_DEV'],['SQUARE_SANDBOX','COMPLETED_DEV'],['SQUARE_PRODUCTION','CONFIRMED'],
   ] as const;
   for(const [mode,state] of accepted){
    await x.db.pool.query('UPDATE rental_bookings SET mode=$2,state=$3 WHERE id=$1',[bookingId,mode,state]);
    const row=(await x.db.pool.query('SELECT mode,state FROM rental_bookings WHERE id=$1',[bookingId])).rows[0];
    assert.deepEqual(row,{mode,state},`${mode}+${state} must be accepted`);
   }
  }finally{
   await x.db.pool.query('UPDATE rental_bookings SET mode=$2,state=$3,confirmed_at=$4 WHERE id=$1',[bookingId,original.mode,original.state,original.confirmed_at]);
   await x.db.pool.query('ALTER TABLE rental_bookings ENABLE TRIGGER rental_booking_guard, ENABLE TRIGGER rental_bookings_audit');
  }
  const restored=(await x.db.pool.query('SELECT mode,state FROM rental_bookings WHERE id=$1',[bookingId])).rows[0];
  assert.deepEqual(restored,{mode:original.mode,state:original.state});
 });
 await check('F6: rental_notifications real-email/CAPTURED widening is absent from this schema — the table still only accepts the synthetic-only shape',async()=>{
  await assert.rejects(x.db.pool.query("INSERT INTO rental_notifications(id,booking_id,destination,state) VALUES(gen_random_uuid(),$1,'real-person@example.com','CAPTURED')",[bookingId]),{code:'23514'});
 });
 const before=(await x.db.pool.query('SELECT to_jsonb(b) b,to_jsonb(h) h FROM rental_bookings b JOIN inventory_holds h ON h.id=b.hold_id WHERE b.id=$1',[bookingId])).rows[0];
 await check('Production HTTP gate refuses simulation/create; existing read/QR survives missing delivery and spoofed ingress',async()=>{
  const old=process.env.NODE_ENV;try{Reflect.set(process.env,'NODE_ENV','production');const api=guestHandler(r.guest!.contexts,r.service,origin,false,r.guest!.security),headers={origin,cookie:guestCookie(c.token,true),'content-type':'application/json'};
   assert.equal((await api(new Request(origin+'/api/guest/draft',{headers}))).status,200);assert.equal((await api(new Request(origin+'/api/guest/checkout',{method:'POST',headers,body:'{}'}))).status,503);
   const access=bookingAccessHandler(r.access!,r.guest!.contexts,origin,req=>r.guest!.security.service.guard(r.guest!.security.peer(req)),r.recovery!);assert.equal((await access(new Request(origin+'/api/booking-access/recovery/prepare',{method:'POST',headers,body:JSON.stringify({bookingId,requestId:randomUUID()})}))).status,200);
   assert.equal((await r.access!.read(token)).id,bookingId);assert.deepEqual((await x.db.pool.query('SELECT to_jsonb(b) b,to_jsonb(h) h FROM rental_bookings b JOIN inventory_holds h ON h.id=b.hold_id WHERE b.id=$1',[bookingId])).rows[0],before);
  }finally{if(old===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Reflect.set(process.env,'NODE_ENV',old);}
 });
 await check('R2 fixture timeout/revocation is isolated from booking/access and never performs an external fetch',async()=>{
  let calls=0,revoked=false;const media={environment:'PRODUCTION' as const,permission:'OBJECT_READ' as const,credentials:async()=>({accountId:'a'.repeat(32),bucket:'synthetic-m15-private',accessKeyId:randomBytes(12).toString('hex'),secretAccessKey:randomBytes(32).toString('hex'),expiresAt:new Date('2099-01-01T00:00:00Z'),revoked}),requestHandler:{handle:async()=>{calls++;throw Error('SYNTHETIC_MEDIA_TIMEOUT');}}};
  const m=await composeProductionRuntime({...x.input({media:true,avatar:true}),media});try{await assert.rejects(m.readDerivative('a'.repeat(64)));assert.equal(calls,1);revoked=true;await assert.rejects(m.readDerivative('b'.repeat(64)));assert.equal(calls,1);assert.equal((await m.service(actor).get()).booking?.state,'CONFIRMED_DEV');assert.equal((await m.access!.read(token)).id,bookingId);assert.deepEqual((await x.db.pool.query('SELECT to_jsonb(b) b,to_jsonb(h) h FROM rental_bookings b JOIN inventory_holds h ON h.id=b.hold_id WHERE b.id=$1',[bookingId])).rows[0],before);}finally{await m.close();}
 });
 await check('disabled recovery has no service and shared or missing root keys fail before database connection',async()=>{const s=await composeProductionRuntime(x.input({guestRecovery:false}));try{assert.equal(s.recovery,null);}finally{await s.close();}await assert.rejects(composeProductionRuntime({...input,secrets:{...input.secrets,recoveryKey:input.secrets.accessKey}}),ProductionStartupError);});
 console.log('M15 normal production composition '+count+' real-PG cases PASS; all credentials/metadata synthetic; external0.');
}catch(e){failed=true;console.error('M15_PRODUCTION_FAILED '+stage+' '+(e instanceof ProductionStartupError?e.stage:(e as {code?:string}).code??(e as Error).name));console.error((e as Error).stack?.split('\n').filter(l=>l.includes('/tests/readiness/')).join('\n'));}finally{await runtime?.close();await x.close();console.log('Owned M15 pools/cluster stopped.');}if(failed)process.exit(1);
