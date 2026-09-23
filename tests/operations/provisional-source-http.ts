import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {operationsHandler} from '../../apps/web/src/lib/operations-http';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {resolveStaff} from '../../packages/auth/src/staff-auth';
import {writeAccount} from '../../packages/auth/src/accounts';
// POST /api/operations/provisional-capacity-source through the real maintained staff route:
// real better-auth sessions, real OperationsContext and disposable PostgreSQL. It registers a
// synthetic provisional source only in this owned local cluster, never Production.
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
 const editor=await account('provisional-http-editor@example.invalid','ALL',[],{INVENTORY_VIEW:true,INVENTORY_EDIT:true});
 const storeEditor=await account('provisional-http-store@example.invalid','ASSIGNED',['MOUNTAIN_BASE'],{INVENTORY_VIEW:true,INVENTORY_EDIT:true});
 const viewer=await account('provisional-http-viewer@example.invalid','ALL',[],{INVENTORY_VIEW:true});
 const payload=(quantity=3)=>({sourceSha256:randomBytes(32).toString('hex'),originalFilename:'SYNTHETIC provisional source.xlsx',buckets:[{family:'SKI',age:'ADULT',sourceSize:'150 cm',bookingSize:'150 cm',quantity,provenance:'SYNTHETIC provisional-http fixture'}]});
 const post=(cookie:string|undefined,body:unknown,origin=x.origin)=>handler(new Request(x.origin+'/api/operations/provisional-capacity-source',{method:'POST',headers:{...(cookie?{cookie}:{}),origin,'content-type':'application/json'},body:JSON.stringify(body)}));
 const sources=async()=>(await x.db.pool.query('SELECT count(*)::int n FROM provisional_capacity_sources')).rows[0].n as number;

 await check('INVENTORY_EDIT with scope ALL registers through the maintained staff route',async()=>{
  const before=await sources(),res=await post(editor.cookie,{requestKey:randomUUID(),input:payload()});
  assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'private, no-store');
  const body=await res.json() as {sourceId:string;buckets:number;totalQuantity:number};assert.match(body.sourceId,/^[0-9a-f-]{36}$/);assert.equal(body.buckets,1);assert.equal(body.totalQuantity,3);
  assert.equal(await sources(),before+1);
 });
 await check('store-limited editor, viewer, anonymous/guest cookie and cross-origin POST are rejected without registration',async()=>{
  const before=await sources();
  assert.equal((await post(storeEditor.cookie,{requestKey:randomUUID(),input:payload()})).status,403);
  assert.equal((await post(viewer.cookie,{requestKey:randomUUID(),input:payload()})).status,403);
  assert.equal((await post(undefined,{requestKey:randomUUID(),input:payload()})).status,401);
  assert.equal((await post('zao_guest_context=synthetic-guest-token',{requestKey:randomUUID(),input:payload()})).status,401);
  assert.equal((await post(editor.cookie,{requestKey:randomUUID(),input:payload()},'https://attacker.invalid')).status,403);
  assert.equal(await sources(),before);
 });
 await check('same request key replays idempotently; a different payload under the same key is a mismatch',async()=>{
  const key=randomUUID(),input=payload(),first=await post(editor.cookie,{requestKey:key,input}),before=await sources();
  assert.equal(first.status,200);const replay=await post(editor.cookie,{requestKey:key,input});assert.equal(replay.status,200);
  assert.deepEqual(await replay.json(),await first.json());assert.equal(await sources(),before);
  const mismatch=await post(editor.cookie,{requestKey:key,input:payload(4)});assert.equal(mismatch.status,409);assert.deepEqual(await mismatch.json(),{error:'IDEMPOTENCY_MISMATCH'});
  assert.equal(await sources(),before);
 });
 await check('invalid payloads are rejected before any registration',async()=>{
  const before=await sources();
  for(const input of [{...payload(),sourceSha256:'nothex'},{...payload(),buckets:[]},{...payload(),buckets:[{...payload().buckets[0],family:'POLE'}]},{...payload(),buckets:[{...payload().buckets[0],quantity:0}]}])
   assert.equal((await post(editor.cookie,{requestKey:randomUUID(),input})).status,422);
  assert.equal(await sources(),before);
 });
 console.log(JSON.stringify({status:'PASS',cases:count,productionRegistrations:0}));
}catch(e){
 failed=true;
 console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:e instanceof assert.AssertionError?e.message:'SAFE_DETAILS_ONLY'}));
 console.error((e as Error).stack?.split('\n').filter(l=>l.includes('/tests/operations/provisional-source-http')).join('\n'));
}finally{await role?.close();await x.close();}
if(failed)process.exit(1);
