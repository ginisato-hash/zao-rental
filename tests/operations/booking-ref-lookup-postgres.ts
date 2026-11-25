import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {writeAccount} from '../../packages/auth/src/accounts';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {BookingRefLookup,CANDIDATE_MAX} from '../../packages/core/src/operations/booking-ref-lookup';
import {operationsHandler} from '../../apps/web/src/lib/operations-http';
import {resolveStaff} from '../../packages/auth/src/staff-auth';

// P0-QR: lookup of a booking by the short number shown on screen. Synthetic local PostgreSQL only; read-only.
// Proves: unique match, several matches returned as candidates (never auto-picked), no match, station scope without disclosure,
// permission, input validation, no write, and the real HTTP route (query allow-list, JSON shape).
const x=await flowFixture();let ops:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined,stage='setup',count=0,failed=false;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const reserve={reason:'SYNTHETIC qr lookup test'};
try{
 ops=await provisionOperationsRole(x.db.pool,x.db.identity);
 const mk=(email:string,o:object)=>writeAccount(x.roles.authPool,x.bp,undefined,{email,password:x.password,displayName:'SYNTHETIC '+email,active:true,...o} as never);
 await mk('qr-onsen@example.invalid',{role:'MANAGER',scope:'ASSIGNED',storeIds:['ONSEN_BASE'],permissions:{}});
 await mk('qr-noview@example.invalid',{role:'STAFF',scope:'ASSIGNED',storeIds:['MOUNTAIN_BASE'],permissions:{BOOKING_VIEW:false}});
 const lookup=(identity:OperationsContext['identity'])=>new BookingRefLookup(new OperationsContext(ops!.operationsPool,x.roles.authPool,identity));
 const admin=lookup(x.signed.identity),onsen=lookup((await x.login('qr-onsen@example.invalid')).identity),noview=await x.login('qr-noview@example.invalid');
 const a=await x.draft('2035-01-03',undefined,reserve),b=await x.draft('2035-01-05',undefined,reserve),c=await x.draft('2035-01-08',undefined,reserve);
 const ids=[a,b,c].map(v=>v.booking.id as string);const store=a.conditions.pickupStore as string;
 const fp=async()=>(await x.db.pool.query("SELECT string_agg(to_jsonb(r)::text,',' ORDER BY id) f FROM rental_bookings r")).rows[0].f as string;
 const before=await fp();

 await check('a displayed short number (with #, any case, spaces) finds exactly that booking',async()=>{
  const ref=ids[0]!.slice(0,8).toUpperCase();
  for(const raw of ['#'+ref,ref.toLowerCase(),' # '+ref.slice(0,4)+' '+ref.slice(4)+' ','#'+ref.slice(0,6)]){
   const r=await admin.find(raw);assert.equal(r.truncated,false);assert.deepEqual(r.matches.map(m=>m.id),[ids[0]],raw);assert.equal(r.matches[0]!.ref,ref);
  }
  const m=(await admin.find('#'+ref)).matches[0]!;assert.ok(m.startDate&&m.pickupStore&&m.status);assert.ok(!('email' in m),'candidate rows carry no email/price');
 });
 await check('no match is an empty list, not an error',async()=>{
  const free=(await x.db.pool.query("SELECT upper(left(g::text,8)) r FROM (SELECT gen_random_uuid() g) q")).rows[0].r as string;
  assert.deepEqual((await admin.find('#'+free)).matches,[]);
 });
 await check('several bookings sharing the number come back as candidates, none chosen',async()=>{
  // Force a shared prefix (a real collision is astronomically rare): rewrite b/c ids so they share a's first 8 characters.
  const base=ids[0]!.slice(0,8),twin=(n:number)=>base+'-0000-4000-8000-00000000000'+n;
  await x.db.pool.query('BEGIN');await x.db.pool.query("SET LOCAL session_replication_role=replica");
  await x.db.pool.query('UPDATE rental_bookings SET id=$2 WHERE id=$1',[ids[1],twin(1)]);await x.db.pool.query('UPDATE rental_bookings SET id=$2 WHERE id=$1',[ids[2],twin(2)]);await x.db.pool.query('COMMIT');
  const r=await admin.find('#'+base.toUpperCase());assert.equal(r.matches.length,3);assert.equal(r.truncated,false);
  assert.deepEqual(r.matches.map(m=>m.id).sort(),[ids[0]!,twin(1),twin(2)].sort());
  assert.ok(r.matches.length<=CANDIDATE_MAX);
 });
 await check('invalid input is refused before any query',async()=>{
  for(const raw of ['','#','12345','#XYZ12345','123456789',undefined,null,'00000000-0000-4000-8000-000000002201','https://example.com'])await assert.rejects(admin.find(raw),{code:'INVALID_INPUT'},String(raw));
 });
 await check('station scope: another station sees nothing, and cannot tell the booking exists',async()=>{
  const ref=ids[0]!.slice(0,8);
  if(store!=='ONSEN_BASE'){const r=await onsen.find(ref);assert.deepEqual(r,{ref:ref.toUpperCase(),matches:[],truncated:false});}
  const free=(await onsen.find(randomUUID().slice(0,8)));assert.deepEqual(free.matches,[]);
 });
 await check('permission: without BOOKING_VIEW the lookup is FORBIDDEN',async()=>{
  await assert.rejects(lookup(noview.identity).find(ids[0]!.slice(0,8)),{code:'FORBIDDEN'});
 });
 await check('real HTTP route: JSON shape, query allow-list, no session, no write',async()=>{
  const handler=operationsHandler(h=>resolveStaff(x.auth,x.roles.authPool,h),id=>new OperationsContext(ops!.operationsPool,x.roles.authPool,id),x.origin);
  const ref=ids[0]!.slice(0,8).toUpperCase(),url=(q:string)=>x.origin+'/api/operations/orders/lookup?'+q;
  const ok=await handler(new Request(url('ref=%23'+ref),{headers:{cookie:(await x.login('flow-actor@example.invalid')).cookie}}));assert.equal(ok.status,200);
  const body=await ok.json() as {ref:string;matches:{id:string}[]};assert.equal(body.ref,ref);assert.equal(body.matches.length,3);
  const cookie=(await x.login('flow-actor@example.invalid')).cookie;
  assert.equal((await handler(new Request(url('ref='+ref+'&x=1'),{headers:{cookie}}))).status,422);
  assert.equal((await handler(new Request(url('ref=zz'),{headers:{cookie}}))).status,422);
  assert.equal((await handler(new Request(url('ref='+ref)))).status,401);
  assert.equal((await handler(new Request(url('ref='+ref),{headers:{cookie:noview.cookie}}))).status,403);
  assert.equal((await handler(new Request(url('ref='+ref),{method:'POST',headers:{cookie,origin:x.origin}}))).status>=400,true);
 });
 await check('lookups change nothing',async()=>{
  const now=await fp();assert.ok(now!==before,'(sanity: the id rewrite above changed rows)');
  const once=await fp();await admin.find(ids[0]!.slice(0,8));assert.equal(await fp(),once);
 });
 console.log(JSON.stringify({status:'PASS',cases:count,externalCalls:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'ASSERTION',message:(e as Error).message?.slice(0,500),at:(e as Error).stack?.split('\n').slice(0,6).join(' | ')}));}
finally{await ops?.close();await x.close();}
if(failed)process.exitCode=1;
