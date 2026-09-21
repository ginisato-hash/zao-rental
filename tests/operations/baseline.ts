import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type {Pool} from 'pg';
import {flowFixture} from '../flow/fixture';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {OperationsConsole} from '../../packages/core/src/operations/console-service';
import {observeOperationalFailure} from '../../packages/core/src/operations/ops-signal';
import {NotificationOperations} from '../../packages/core/src/notification/staff-service';
import {variants,fid} from '../inventory/fixture';
// Synthetic scale rehearsal only. These numbers describe this machine and this fixture;
// they are not a service level objective and no production guarantee is derived from them.
const SETS_PER_STORE=250,SAMPLES=12;
let failed=false,stage='fixture',count=0;const x=await flowFixture();let ops:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const quantile=(values:number[],q:number)=>{const s=[...values].sort((a,b)=>a-b);return Math.round(s[Math.min(s.length-1,Math.floor(q*s.length))]!*100)/100;};
async function measure(label:string,run:()=>Promise<unknown>){const samples:number[]=[];for(let i=0;i<SAMPLES;i++){const t=performance.now();await run();samples.push(performance.now()-t);}return {api:label,samples:SAMPLES,p50Ms:quantile(samples,0.5),p95Ms:quantile(samples,0.95)};}
function counted(pool:Pool){let queries=0;const original=pool.query.bind(pool);(pool as unknown as {query:unknown}).query=(...args:unknown[])=>{queries++;return (original as (...a:unknown[])=>unknown)(...args);};return {count:()=>queries,restore(){(pool as unknown as {query:unknown}).query=original;}};}
try{
 ops=await provisionOperationsRole(x.db.pool,x.db.identity);
 const ctx=new OperationsContext(ops.operationsPool,x.roles.authPool,x.signed.identity),console_=new OperationsConsole(ctx);
 await x.db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) SELECT $1,p,true FROM unnest(ARRAY['OPERATIONS_VIEW','OPERATIONS_ACKNOWLEDGE']) p",[x.actor]);
 Object.assign(x.principal,(await loadStaff(x.roles.authPool,x.actor))!);

 stage='synthetic scale fixture';
 const c=await x.db.pool.connect();
 try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor','synthetic-m17-baseline',true),set_config('zao.reason','SYNTHETIC M1.7 scale rehearsal',true)");
  for(const [storeIndex,store] of (['MOUNTAIN_BASE','ONSEN_BASE'] as const).entries())
   for(const [familyIndex,[family,variant,bsl]] of ([['SKI',variants.ski,'NOT_APPLICABLE'],['SKI_BOOT',variants.boot,'UNVERIFIED']] as const).entries())
    await c.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator)
     SELECT ('00000000-0000-4000-8000-'||lpad((900000+$5::int*100000+$6::int*10000+n)::text,12,'0'))::uuid,$1,$2,$3,$3,'AVAILABLE',$4,'','SYNTHETIC scale rehearsal, not observed inventory','SYNTHETIC','tests/operations/baseline.ts','BASELINE-'||$2||'-'||$3||'-'||n
     FROM generate_series(1,$7::int) n`,[variant,family,store,bsl,storeIndex,familyIndex,SETS_PER_STORE]);
  await c.query('UPDATE ledger_poles SET quantity=$1,version=version+1 WHERE id=$2',[SETS_PER_STORE,fid(1301)]);
  await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}

 await check('synthetic scale inventory is explicitly separated from observed inventory',async()=>{
  const rows=(await x.db.pool.query("SELECT count(*)::int n FROM ledger_assets WHERE source_locator LIKE 'BASELINE-%'")).rows[0].n;
  assert.equal(rows,SETS_PER_STORE*4);
  assert.equal((await x.db.pool.query("SELECT count(*)::int n FROM ledger_assets WHERE source_locator LIKE 'BASELINE-%' AND source_kind<>'SYNTHETIC'")).rows[0].n,0);
  const stores=(await x.db.pool.query("SELECT store_id,count(*)::int n FROM ledger_assets WHERE source_locator LIKE 'BASELINE-%' GROUP BY 1 ORDER BY 1")).rows;
  assert.deepEqual(stores.map(r=>r.n),[SETS_PER_STORE*2,SETS_PER_STORE*2]);
 });

 stage='representative bookings';
 for(let i=0;i<6;i++){const d=await x.draft('2035-04-'+String(i+1).padStart(2,'0'));await x.service.startPayment(d.booking.id,randomUUID());}
 for(let i=0;i<220;i++)await observeOperationalFailure(ops.operationsPool,'DB_UNAVAILABLE','MOUNTAIN_BASE');

 const filter=(o:Record<string,unknown>={})=>({store:'MOUNTAIN_BASE',type:null,severity:null,ageHours:0,status:'ALL',beforeTime:null,beforeId:null,...o});
 let report:{api:string;samples:number;p50Ms:number;p95Ms:number}[]=[];

 await check('operations console stays bounded and issues a constant number of queries',async()=>{
  const first=await console_.list(filter());
  assert.equal(first.exceptions.length,50);assert.ok(first.next);
  const probe=counted(ops!.operationsPool);let small=0;
  try{await console_.list(filter());small=probe.count();}finally{probe.restore();}
  for(let i=0;i<120;i++)await observeOperationalFailure(ops!.operationsPool,'PROVIDER_TIMEOUT','MOUNTAIN_BASE');
  const probe2=counted(ops!.operationsPool);let large=0;
  try{const page=await console_.list(filter());assert.equal(page.exceptions.length,50);large=probe2.count();}finally{probe2.restore();}
  // A per-row query would grow this with the exception count; a bounded page must not.
  assert.equal(large,small);
 });

 await check('representative read APIs report descriptive p50/p95 without a service guarantee',async()=>{
  const notifications=new NotificationOperations(ctx);
  report=[
   await measure('operations.exceptions.list',()=>console_.list(filter())),
   await measure('operations.exceptions.acknowledgedPage',()=>console_.list(filter({status:'ACKNOWLEDGED'}))),
   await measure('operations.notifications.list',()=>notifications.list('MOUNTAIN_BASE')),
   await measure('bookings.list',()=>x.service.list()),
  ];
  for(const r of report){assert.ok(r.p50Ms>=0&&Number.isFinite(r.p95Ms));assert.ok(r.p95Ms<5000,r.api+' p95 '+r.p95Ms);}
 });

 console.log(JSON.stringify({status:'PASS',cases:count,syntheticSets:SETS_PER_STORE*2,stores:2,syntheticAssets:SETS_PER_STORE*4,measurements:report,productionGuarantee:false,serviceLevelObjective:null,hostedDb:0,realInventory:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??(e as Error).name,detail:(e as Error).message.slice(0,500)}));}
finally{await ops?.close();await x.close();}
if(failed)process.exit(1);
