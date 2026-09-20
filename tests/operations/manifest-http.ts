import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {operationsHandler} from '../../apps/web/src/lib/operations-http';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {resolveStaff} from '../../packages/auth/src/staff-auth';
import {writeAccount} from '../../packages/auth/src/accounts';
// UX5C-R02: tests/operations/manifest.ts calls ManifestService directly and never proves
// the actual GET /api/operations/manifest route (query allowlist, HTTP status mapping,
// session-stamp handling, response headers) behaves as documented. This calls the real
// operationsHandler against a synthetic Request, real PostgreSQL and a real better-auth
// session — no live HTTP server/port, matching the same in-process pattern
// tests/flow/fixture.ts's own login() already uses for authHandler.
let failed=false,stage='fixture',count=0;const x=await flowFixture();
let role:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 role=await provisionOperationsRole(x.db.pool,x.db.identity);
 const state=(headers:Headers)=>resolveStaff(x.auth,x.roles.authPool,headers);
 const handler=operationsHandler(state,id=>new OperationsContext(role!.operationsPool,x.roles.authPool,id),x.origin);
 async function account(email:string,scope:'ALL'|'ASSIGNED',storeIds:string[],permissions:Record<string,boolean>){
  await writeAccount(x.roles.authPool,x.bp,undefined,{email,password:x.password,displayName:'SYNTHETIC '+email.split('@')[0],active:true,role:'STAFF',scope,storeIds,permissions});
  return x.login(email);
 }
 const full=await account('manifest-http-full@example.invalid','ALL',[],{BOOKING_VIEW:true,RENTAL_CHECKOUT:true,RENTAL_RETURN:true,OPERATIONS_VIEW:true});
 const noPerm=await account('manifest-http-none@example.invalid','ASSIGNED',['MOUNTAIN_BASE'],{});
 const wrongStore=await account('manifest-http-onsen@example.invalid','ASSIGNED',['ONSEN_BASE'],{BOOKING_VIEW:true});
 const get=(query:string,cookie?:string,extraHeaders?:Record<string,string>)=>handler(new Request(x.origin+'/api/operations/manifest'+query,{headers:{...(cookie?{cookie}:{}),...extraHeaders}}));
 const post=(cookie?:string,body?:unknown)=>handler(new Request(x.origin+'/api/operations/manifest',{method:'POST',headers:{...(cookie?{cookie}:{}),origin:x.origin,'content-type':'application/json'},body:JSON.stringify(body??{requestKey:randomUUID(),input:{}})}));

 await check('authorized GET /api/operations/manifest succeeds with private/no-store headers',async()=>{
  const res=await get('?store=MOUNTAIN_BASE',full.cookie);
  assert.equal(res.status,200);
  assert.equal(res.headers.get('cache-control'),'private, no-store');
  assert.equal(res.headers.get('vary'),'Cookie');
  const body=await res.json() as {store:string;rows:unknown[]};
  assert.equal(body.store,'MOUNTAIN_BASE');
  assert.ok(Array.isArray(body.rows));
 });

 await check('anonymous request -> 401',async()=>{
  const res=await get('?store=MOUNTAIN_BASE');
  assert.equal(res.status,401);
 });

 await check('missing permission -> 403',async()=>{
  const res=await get('?store=MOUNTAIN_BASE',noPerm.cookie);
  assert.equal(res.status,403);
 });

 await check('wrong store -> 403',async()=>{
  const res=await get('?store=MOUNTAIN_BASE',wrongStore.cookie);
  assert.equal(res.status,403);
 });

 await check('unknown query key -> 422',async()=>{
  const res=await get('?store=MOUNTAIN_BASE&bogus=1',full.cookie);
  assert.equal(res.status,422);
 });

 // UX5C-R03: regex shape alone accepts these; only the round-trip calendar validator catches
 // an impossible-but-well-shaped date before it ever reaches Branch SQL.
 await check('impossible calendar date (2035-02-31) -> 422',async()=>{
  const res=await get('?store=MOUNTAIN_BASE&date=2035-02-31',full.cookie);
  assert.equal(res.status,422);
 });
 await check('impossible calendar date (2035-02-29, non-leap year) -> 422',async()=>{
  const res=await get('?store=MOUNTAIN_BASE&date=2035-02-29',full.cookie);
  assert.equal(res.status,422);
 });

 await check('invalid pageSize -> 422',async()=>{
  const res=await get('?store=MOUNTAIN_BASE&pageSize=0',full.cookie);
  assert.equal(res.status,422);
 });

 await check('invalid cursor -> 422',async()=>{
  const res=await get('?store=MOUNTAIN_BASE&cursor=not-base64-json',full.cookie);
  assert.equal(res.status,422);
 });

 await check('cursor context mismatch -> 422 through HTTP',async()=>{
  const cursor=Buffer.from(JSON.stringify({v:1,store:'MOUNTAIN_BASE',date:'2000-01-01',section:'all',lastKey:'B:00000000-0000-0000-0000-000000000000'})).toString('base64url');
  const res=await get(`?store=MOUNTAIN_BASE&cursor=${cursor}`,full.cookie);
  assert.equal(res.status,422);
 });

 await check('session-stamp mismatch -> 409',async()=>{
  const res=await get('?store=MOUNTAIN_BASE',full.cookie,{'x-zao-session':'0'.repeat(64)});
  assert.equal(res.status,409);
 });

 await check('POST /manifest is not a mutation surface',async()=>{
  const res=await post(full.cookie);
  assert.equal(res.status,404);
 });

 console.log(JSON.stringify({status:'PASS',cases:count}));
}catch(e){
 failed=true;
 console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:e instanceof assert.AssertionError?e.message:'SAFE_DETAILS_ONLY'}));
 console.error((e as Error).stack?.split('\n').filter(l=>l.includes('/tests/operations/manifest-http')).join('\n'));
}finally{await role?.close();await x.close();}
if(failed)process.exit(1);
