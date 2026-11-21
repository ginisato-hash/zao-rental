import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {writeAccount} from '../../packages/auth/src/accounts';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {CustomersService} from '../../packages/core/src/operations/customers-service';
import {syntheticContact} from '../../packages/contracts/src/rental-flow';

// Issue #47 consolidated order §5: minimal customer identity. Synthetic local PostgreSQL only.
const x=await flowFixture();let ops:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined,stage='setup',count=0,failed=false;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const reason={reason:'SYNTHETIC customer identity test'};
try{
 ops=await provisionOperationsRole(x.db.pool,x.db.identity);
 const svc=new CustomersService(new OperationsContext(ops.operationsPool,x.roles.authPool,x.signed.identity));
 const confirmed=async(day:string)=>{const d=await x.draft(day,undefined,reason);await x.service.startPayment(d.booking.id,randomUUID());return d.booking.id;};
 const legacy=async(day:string)=>{await x.db.pool.query('ALTER TABLE rental_bookings DISABLE TRIGGER customer_capture_booking');try{return await confirmed(day);}finally{await x.db.pool.query('ALTER TABLE rental_bookings ENABLE TRIGGER customer_capture_booking');}};
 const link=async(id:string)=>(await x.db.pool.query('SELECT customer_id FROM customer_booking_links WHERE booking_id=$1',[id])).rows[0]?.customer_id as string|undefined;
 const tableCounts=async()=>(await x.db.pool.query('SELECT (SELECT count(*) FROM customer_profiles)::int p,(SELECT count(*) FROM customer_booking_links)::int l,(SELECT count(*) FROM customer_link_requests)::int r')).rows[0];
 const a=await confirmed('2035-04-01'),b=await confirmed('2035-04-02');
 await check('each new booking gets its own profile in the creation transaction; equal name/email never merge',async()=>{
  const pa=await link(a),pb=await link(b);assert.ok(pa&&pb);assert.notEqual(pa,pb,'same synthetic name/email, different people until a person links them');
  assert.throws(()=>syntheticContact({displayName:'SYNTHETIC Guest',email:'synthetic-guest@example.invalid',termsAccepted:true,customerProfileId:pa}),{code:'INVALID_INPUT'},'guest-shaped input cannot name a customer');
 });
 const l1=await legacy('2035-04-03'),l2=await legacy('2035-04-04'),l3=await legacy('2035-04-05');
 await check('legacy bookings appear as one customer each under a stable key; reading writes nothing',async()=>{
  const before=await tableCounts();const list=await svc.list({});
  for(const id of [l1,l2,l3])assert.ok(list.rows.some(r=>r.key==='legacy:'+id&&r.bookings===1&&r.legacy));
  const d=await svc.detail('legacy:'+l1);assert.equal(d.orders.length,1);assert.equal(d.orders[0]!.id,l1);
  assert.deepEqual(await tableCounts(),before,'GET is read-only');
 });
 await check('linking two legacy bookings creates one profile for both; replay returns the same result; a changed input conflicts',async()=>{
  const bookingBefore=(await x.db.pool.query('SELECT to_jsonb(b) v FROM rental_bookings b WHERE id=$1',[l2])).rows[0].v;
  const key=randomUUID(),first=await svc.link(key,{bookingId:l2,target:'legacy:'+l1}),again=await svc.link(key,{bookingId:l2,target:'legacy:'+l1});
  assert.deepEqual(first,again);assert.equal(await link(l1),first.customerId);assert.equal(await link(l2),first.customerId);
  await assert.rejects(svc.link(key,{bookingId:l3,target:'legacy:'+l1}),{code:'CONFLICT'},'same key, different input');
  await assert.rejects(svc.link(randomUUID(),{bookingId:l2,target:'legacy:'+l3}),{code:'CONFLICT'},'already linked bookings are not reassigned');
  const resolved=await svc.detail('legacy:'+l1);assert.equal(resolved.key,first.customerId);assert.deepEqual(resolved.orders.map(o=>o.id).sort(),[l1,l2].sort());
  assert.deepEqual((await x.db.pool.query('SELECT to_jsonb(b) v FROM rental_bookings b WHERE id=$1',[l2])).rows[0].v,bookingBefore,'booking contact/terms/price untouched');
 });
 await check('two concurrent links of one legacy booking to two real, individually valid targets: exactly one wins, the other conflicts',async()=>{
  const targetA=(await link(l1))!,l5=await legacy('2035-04-07');   // A: an existing profile; B: another visible legacy booking
  const before=(await x.db.pool.query('SELECT to_jsonb(b) v FROM rental_bookings b WHERE id=$1',[l3])).rows[0].v;
  const results=await Promise.allSettled([svc.link(randomUUID(),{bookingId:l3,target:targetA}),svc.link(randomUUID(),{bookingId:l3,target:'legacy:'+l5})]);
  const won=results.filter(r=>r.status==='fulfilled'),lost=results.filter(r=>r.status==='rejected') as PromiseRejectedResult[];
  assert.equal(won.length,1);assert.equal(lost.length,1);assert.equal((lost[0]!.reason as {code?:string}).code,'CONFLICT');
  const winner=(won[0] as PromiseFulfilledResult<{customerId:string}>).value.customerId;assert.equal(await link(l3),winner);
  if(winner===targetA)assert.equal(await link(l5),undefined,'the losing legacy target was not half-linked');
  assert.deepEqual((await x.db.pool.query('SELECT to_jsonb(b) v FROM rental_bookings b WHERE id=$1',[l3])).rows[0].v,before,'booking row unchanged');
 });
 await check('another station sees none of it: list excludes, detail is not found, linking is refused',async()=>{
  await writeAccount(x.roles.authPool,x.bp,undefined,{email:'cust-onsen@example.invalid',password:x.password,displayName:'SYNTHETIC Cust Onsen',active:true,role:'MANAGER',scope:'ASSIGNED',storeIds:['ONSEN_BASE'],permissions:{BOOKING_CREATE:true}});
  const onsen=new CustomersService(new OperationsContext(ops!.operationsPool,x.roles.authPool,(await x.login('cust-onsen@example.invalid')).identity));
  const list=await onsen.list({}),p1=await link(l1);assert.ok(!list.rows.some(r=>r.key==='legacy:'+l1||r.key===p1));
  await assert.rejects(onsen.detail((await link(l1))!),{code:'NOT_FOUND'});
  const l4=await legacy('2035-04-06');await assert.rejects(onsen.link(randomUUID(),{bookingId:l4,target:'legacy:'+l1}),{code:'FORBIDDEN'});
  await assert.rejects(svc.link(randomUUID(),{bookingId:l4,target:'legacy:'+l4}),{code:'INVALID_INPUT'});
 });
 await check('CAL-01 class: a station revoked while customers are read never returns that station’s customers',async()=>{
  const station=(await x.db.pool.query("SELECT conditions->>'pickupStore' s FROM rental_bookings WHERE id=$1",[a])).rows[0].s as string,other=station==='MOUNTAIN_BASE'?'ONSEN_BASE':'MOUNTAIN_BASE';
  await writeAccount(x.roles.authPool,x.bp,undefined,{email:'cust-both@example.invalid',password:x.password,displayName:'SYNTHETIC Cust Both',active:true,role:'MANAGER',scope:'ASSIGNED',storeIds:[station as 'ONSEN_BASE',other as 'ONSEN_BASE'],permissions:{}});
  const both=(await x.login('cust-both@example.invalid')).identity,key=(await link(a))!;
  let calls=0;const revoke=(subject:string,station:string)=>x.db.pool.query('DELETE FROM staff_store_access WHERE staff_id=$1 AND store_id=$2',[subject,station]);
  const racing=(identity:{subject:string;sessionId:string},station:string)=>{calls=0;return new (class extends OperationsContext{override async authorize(...a:Parameters<OperationsContext['authorize']>){const r=await super.authorize(...a);if(++calls===1)await revoke(identity.subject,station);return r;}})(ops!.operationsPool,x.roles.authPool,identity);};
  const plain=()=>new CustomersService(new OperationsContext(ops!.operationsPool,x.roles.authPool,both));
  assert.ok((await plain().list({})).rows.some(r=>r.key===key),'baseline: listed with both stations');
  for(const [name,read] of [['list',(svc:InstanceType<typeof CustomersService>)=>svc.list({})],['detail',(svc:InstanceType<typeof CustomersService>)=>svc.detail(key)]] as const){
   await x.db.pool.query('INSERT INTO staff_store_access(staff_id,store_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[both.subject,station]);
   let code:string|null=null,out:unknown=null;try{out=await read(new CustomersService(racing(both,station)));}catch(e){code=(e as {code?:string}).code??'ERROR';}
   const leaked=name==='list'?Boolean((out as {rows?:{key:string}[]}|null)?.rows?.some(r=>r.key===key)):Boolean(out);
   assert.ok(code==='AUTHORIZATION_CHANGED'||code==='NOT_FOUND'||!leaked,name+': no customer from the revoked station: '+JSON.stringify({code,leaked}));
  }
  assert.equal((await plain().list({})).rows.some(r=>r.key===key),false);await assert.rejects(plain().detail(key),{code:'NOT_FOUND'});
 });
 console.log(JSON.stringify({status:'PASS',cases:count,externalCalls:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'ASSERTION',message:(e as Error).message?.slice(0,500),at:(e as Error).stack?.split('\n').filter(l=>/customers|context\.ts/.test(l)).slice(0,3).join(' | ')}));}
finally{await ops?.close();await x.close();}
if(failed)process.exitCode=1;
