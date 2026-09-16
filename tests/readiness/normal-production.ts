import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
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
 const before=(await x.db.pool.query('SELECT to_jsonb(b) b,to_jsonb(h) h FROM rental_bookings b JOIN inventory_holds h ON h.id=b.hold_id WHERE b.id=$1',[bookingId])).rows[0];
 await check('Production HTTP gate refuses simulation/create; existing read/QR survives missing delivery and spoofed ingress',async()=>{
  const old=process.env.NODE_ENV;try{Reflect.set(process.env,'NODE_ENV','production');const api=guestHandler(r.guest!.contexts,r.service,origin,false,r.guest!.security),headers={origin,cookie:guestCookie(c.token,true),'content-type':'application/json'};
   assert.equal((await api(new Request(origin+'/api/guest/draft',{headers}))).status,200);assert.equal((await api(new Request(origin+'/api/guest/checkout',{method:'POST',headers,body:'{}'}))).status,503);
   const access=bookingAccessHandler(r.access!,r.guest!.contexts,origin,req=>r.guest!.security.service.guard(r.guest!.security.peer(req)),r.recovery!);assert.equal((await access(new Request(origin+'/api/booking-access/recovery/prepare',{method:'POST',headers,body:JSON.stringify({bookingId,requestId:randomUUID()})}))).status,503);
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
