// SIZE-EDGE (Issue 47 A) real-PostgreSQL acceptance. Synthetic data only; no provider, payment or mail.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {fid,variants,inputFor} from './fixture';
import {requestFor} from '../inventory/fixture';
import {RecommendationService} from '../../packages/core/src/recommendation/recommendation-service';
import {RECOMMENDATION_RULE} from '../../packages/contracts/src/recommendation';
import {RECOMMENDATION_RULE_V1} from '../../packages/contracts/src/size-edge';
import type {RecommendationInput} from '../../packages/contracts/src/recommendation';
let failed=false,stage='setup',count=0;const x=await flowFixture();
const reason={reason:'SYNTHETIC size-edge acceptance'};
const svc=()=>new RecommendationService(x.roles.recommendationPool,x.principal,x.holds,x.quotes);
const selection=(directions:Record<string,string>)=>({directions,wantAdvance:false,couponCode:null,acceptedModelPolicy:true});
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const claims=async()=>Number((await x.db.pool.query('SELECT count(*) AS n FROM inventory_claims')).rows[0].n);
function ski(date:string,heightCm:number,footCm=25.5,key='ski-a'):RecommendationInput{const m=inputFor(date).members[0]!;return {...inputFor(date),members:[{...m,key,heightCm,footCm}]};}
function board(date:string,heightCm:number,footCm=25.5,key='board-b'):RecommendationInput{const m=inputFor(date).members[1]!;return {...inputFor(date),members:[{...m,key,heightCm,footCm}]};}
async function seedExtra(){
 // Real numeric catalog extremes: poles up to 140 cm so a tall guest's pole is an edge candidate, not a >30 cm gap.
 const c=await x.db.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor','synthetic-size-edge-seed',true),set_config('zao.reason','SYNTHETIC size-edge fixture',true)");
  await c.query(`INSERT INTO ledger_variants(id,model_id,family,age,tier,size,notes,source_kind,source_document,source_locator) VALUES($1,$2,'POLE','ADULT','REGULAR','140 cm','','SYNTHETIC','tests/recommendation/size-edge.ts','pole-140')`,[fid(7501),fid(1003)]);
  await c.query(`INSERT INTO ledger_poles(id,variant_id,store_id,quantity,status,notes,source_kind,source_document,source_locator) VALUES($1,$2,'MOUNTAIN_BASE',5,'AVAILABLE','','SYNTHETIC','tests/recommendation/size-edge.ts','pole-140')`,[fid(7502),fid(7501)]);
  await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
try{
 await seedExtra();
 await check('regression: a normal input keeps V1 candidates, order, SHORTER/LONGER and price; no fit field on candidates',async()=>{
  const v=await svc().preview(randomUUID(),inputFor('2035-04-01'),null,true);assert.equal(v.preview.rule_version,RECOMMENDATION_RULE);
  for(const o of v.preview.offered){assert.deepEqual([o.candidates.RECOMMENDED?.lengthCm,o.candidates.SHORTER?.lengthCm,o.candidates.LONGER?.lengthCm],[150,145,155]);assert.equal(o.fit?.kind,'NORMAL');assert.ok(Object.values(o.candidates).every(c=>!c||!('fit' in c)));assert.equal(o.manualFit,undefined);assert.equal(o.price!.totalJpy,7500);}
 });
 await check('ski above the handled range -> real largest size as EDGE_ABOVE, raw values untouched, hold+quote follow the server selection',async()=>{
  const v=await svc().preview(randomUUID(),ski('2035-04-02',215),null,true),o=v.preview.offered[0]!;
  assert.equal(v.preview.input.members[0]!.heightCm,215);assert.equal(o.targetCm,195);assert.equal(o.minCm,180);assert.equal(o.maxCm,210);
  assert.equal(o.candidates.RECOMMENDED!.lengthCm,166);assert.equal(o.candidates.RECOMMENDED!.fit!.kind,'EDGE_ABOVE');assert.equal(o.candidates.LONGER,null);assert.equal(o.fit!.kind,'EDGE_ABOVE');
  assert.ok(o.candidates.SHORTER&&o.candidates.SHORTER.lengthCm<166);assert.ok(o.price&&o.price.totalJpy);
  const part=o.candidates.RECOMMENDED!.fit!.parts.find(p=>p.family==='SKI')!;assert.deepEqual([part.diffCm,part.handledHiCm],[-29,166]);
  const done=await svc().select(v.preview.id,randomUUID(),selection({'ski-a':'RECOMMENDED'}),reason);
  assert.equal(done.selection!.stage,'COMPLETE');assert.equal(done.selection!.selection.fit!['ski-a']!.fit.kind,'EDGE_ABOVE');assert.equal(done.selection!.selection.fit!['ski-a']!.direction,'RECOMMENDED');
  assert.equal(done.hold!.conditions.members[0]!.items.find(i=>i.family==='SKI')!.variantIds[0],fid(7105));
  assert.deepEqual((await svc().get(v.preview.id)).selection!.selection.fit,done.selection!.selection.fit);
 });
 await check('ski below the handled range -> smallest size as EDGE_BELOW',async()=>{
  const o=(await svc().preview(randomUUID(),ski('2035-04-03',130),null,true)).preview.offered[0]!;
  assert.equal(o.targetCm,110);assert.equal(o.candidates.RECOMMENDED!.lengthCm,134);assert.equal(o.candidates.RECOMMENDED!.fit!.kind,'EDGE_BELOW');assert.equal(o.candidates.SHORTER,null);
 });
 await check('edge size sold out -> next nearest real size is NEAREST_AVAILABLE; the sold-out edge is never offered',async()=>{
  const date='2035-04-04';assert.equal((await x.holds.command('create',randomUUID(),requestFor(date,[fid(7105)]),undefined,undefined,reason)).result,'CREATED');
  const o=(await svc().preview(randomUUID(),ski(date,215),null,true)).preview.offered[0]!;
  assert.equal(o.candidates.RECOMMENDED!.lengthCm,165);assert.equal(o.candidates.RECOMMENDED!.fit!.kind,'NEAREST_AVAILABLE');assert.equal(o.candidates.LONGER,null);
  assert.ok(![o.candidates.RECOMMENDED,o.candidates.SHORTER,o.candidates.LONGER].some(c=>c?.lengthCm===166));
 });
 await check('stock shortage INSIDE the normal window is not turned into an edge candidate',async()=>{
  const date='2035-04-05',ids=(await x.db.pool.query("SELECT id,size FROM ledger_variants WHERE family='SKI' AND age='ADULT' AND tier='REGULAR'")).rows as {id:string;size:string}[];
  for(const r of ids){const n=Number.parseInt(r.size);if(n>=135&&n<=165){const h=await x.holds.command('create',randomUUID(),requestFor(date,[r.id]),undefined,undefined,reason);assert.equal(h.result,'CREATED');}}
  const o=(await svc().preview(randomUUID(),ski(date,170),null,true)).preview.offered[0]!;
  assert.equal(o.reason,'INSUFFICIENT');assert.equal(o.candidates.RECOMMENDED,null);assert.equal(o.manualFit,undefined);assert.equal(o.fit!.kind,'NORMAL');
 });
 await check('beyond the auto-fit limit -> MANUAL_FIT_REQUIRED, nothing selectable, no hold/claim/quote',async()=>{
  const before=await claims(),v=await svc().preview(randomUUID(),ski('2035-04-06',225),null,true),o=v.preview.offered[0]!;
  assert.equal(o.reason,'MANUAL_FIT_REQUIRED');assert.equal(o.fit!.kind,'MANUAL_FIT_REQUIRED');assert.equal(o.manualFit!.fit.kind,'MANUAL_FIT_REQUIRED');assert.equal(o.manualFit!.lengthCm,166);
  assert.deepEqual(o.candidates,{RECOMMENDED:null,SHORTER:null,LONGER:null});assert.equal(o.price,null);
  await assert.rejects(svc().select(v.preview.id,randomUUID(),selection({'ski-a':'RECOMMENDED'}),reason),{code:'CANDIDATE_NOT_OFFERED'});
  assert.equal(await claims(),before);assert.equal((await svc().get(v.preview.id)).selection,null);
 });
 await check('boot out of range: nearest real shell is an edge candidate on the boot part; board stays normal',async()=>{
  const o=(await svc().preview(randomUUID(),board('2035-04-07',170,24),null,true)).preview.offered[0]!,c=o.candidates.RECOMMENDED!;
  assert.equal(c.lengthCm,150);const bp=c.fit!.parts.find(p=>p.family==='SNOWBOARD_BOOT')!;assert.deepEqual([c.fit!.kind,bp.kind,bp.diffCm],['EDGE_BELOW','EDGE_BELOW',1.5]);
  assert.equal(c.fit!.parts.find(p=>p.family==='SNOWBOARD')!.kind,'NORMAL');assert.equal(o.bootCm,25);
  const big=(await svc().preview(randomUUID(),board('2035-04-07',170,28.5),null,true)).preview.offered[0]!.candidates.RECOMMENDED!;
  assert.equal(big.fit!.parts.find(p=>p.family==='SNOWBOARD_BOOT')!.kind,'EDGE_ABOVE');
 });
 await check('catalog missing is its own reason (no KIDS boots) and is not converted to a candidate',async()=>{
  const m={...inputFor('2035-04-08').members[1]!,adultAtStart:false};const o=(await svc().preview(randomUUID(),{...inputFor('2035-04-08'),members:[m]},null,true)).preview.offered[0]!;
  assert.equal(o.reason,'NO_CATALOG_BOOT');assert.equal(o.candidates.RECOMMENDED,null);
 });
 await check('transfer-plan-required is never converted to FEASIBLE by the edge route',async()=>{
  const i=ski('2035-04-09',215);i.pickupStore=i.returnStore='ONSEN_BASE';const o=(await svc().preview(randomUUID(),i,null,true)).preview.offered[0]!;
  assert.equal(o.reason,'TRANSFER_PLAN_REQUIRED');assert.equal(o.candidates.RECOMMENDED,null);
 });
 await check('two guests at the edge: last 166 is not double-counted; the alternative is real and selectable',async()=>{
  const date='2035-04-10',m=ski(date,215).members[0]!,i={...ski(date,215),members:[m,{...m,key:'ski-b'}]};
  const v=await svc().preview(randomUUID(),i,null,true);assert.ok(v.preview.offered.every(o=>o.candidates.RECOMMENDED?.lengthCm===166));
  const before=await claims(),fail=await svc().select(v.preview.id,randomUUID(),selection({'ski-a':'RECOMMENDED','ski-b':'RECOMMENDED'}),reason);
  assert.equal(fail.selection!.stage,'HOLD_FAILED');assert.equal(fail.selection!.outcome,'INSUFFICIENT');assert.equal(await claims(),before);
  const next=await svc().preview(randomUUID(),i,null,true),ok=await svc().select(next.preview.id,randomUUID(),selection({'ski-a':'RECOMMENDED','ski-b':'SHORTER'}),reason);
  assert.equal(ok.selection!.stage,'COMPLETE');assert.equal(ok.selection!.selection.fit!['ski-b']!.fit.kind,'NEAREST_AVAILABLE');
 });
 await check('forged payloads: fit/variant/price fields, unoffered direction and a replayed key with another selection are all rejected',async()=>{
  const v=await svc().preview(randomUUID(),ski('2035-04-11',215),null,true),key=randomUUID();
  for(const extra of [{fit:{'ski-a':{direction:'RECOMMENDED',fit:{kind:'NORMAL'}}}},{variantIds:[variants.ski]},{totalJpy:1}])await assert.rejects(svc().select(v.preview.id,randomUUID(),{...selection({'ski-a':'RECOMMENDED'}),...extra},reason));
  await assert.rejects(svc().select(v.preview.id,randomUUID(),selection({'ski-a':'LONGER'}),reason),{code:'CANDIDATE_NOT_OFFERED'});
  await assert.rejects(svc().select(v.preview.id,randomUUID(),selection({'ski-a':'SHORTER','extra':'RECOMMENDED'}),reason),{code:'INVALID_SELECTION'});
  const done=await svc().select(v.preview.id,key,selection({'ski-a':'RECOMMENDED'}),reason);assert.equal(done.selection!.stage,'COMPLETE');
  assert.equal((await svc().select(v.preview.id,key,selection({'ski-a':'RECOMMENDED'}),reason)).quote!.id,done.quote!.id);
  await assert.rejects(svc().select(v.preview.id,randomUUID(),selection({'ski-a':'SHORTER'}),reason),{code:'SELECTION_ALREADY_FIXED'});
 });
 await check('idempotent preview replay returns the same preview; a V1 preview stays readable/selectable and is never back-filled with fit',async()=>{
  const key=randomUUID(),i=ski('2035-04-12',215),a=await svc().preview(key,i,null,true),b=await svc().preview(key,i,null,true);assert.equal(a.preview.id,b.preview.id);
  const legacy=randomUUID(),c=await x.db.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor',$1,true)",[x.principal.subject]);
   const strip=JSON.parse(JSON.stringify(a.preview.offered),(k,v)=>k==='fit'||k==='manualFit'?undefined:v);
   await c.query('INSERT INTO recommendation_previews(id,owner_id,request_key,fingerprint,rule_version,model_policy,input,offered,reservation_id) SELECT $1,owner_id,$2,fingerprint,$3,model_policy,input,$5::jsonb,reservation_id FROM recommendation_previews WHERE id=$4',[legacy,randomUUID(),RECOMMENDATION_RULE_V1,a.preview.id,JSON.stringify(strip)]);
   await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  const old=await svc().get(legacy);assert.equal(old.preview.rule_version,RECOMMENDATION_RULE_V1);
  const done=await svc().select(legacy,randomUUID(),selection({'ski-a':'RECOMMENDED'}),reason);assert.equal(done.selection!.stage,'COMPLETE');assert.equal(done.selection!.selection.fit,undefined);
 });
 await check('staff handoff join: the booking quote reaches the saved fit evidence through the existing selection link',async()=>{
  const v=await svc().preview(randomUUID(),ski('2035-04-13',215),null,true),done=await svc().select(v.preview.id,randomUUID(),selection({'ski-a':'RECOMMENDED'}),reason);
  const row=(await x.db.pool.query('SELECT s.selection FROM recommendation_selections s WHERE s.quote_id=$1',[done.quote!.id])).rows[0];assert.equal(row.selection.fit['ski-a'].fit.kind,'EDGE_ABOVE');assert.equal(row.selection.fit['ski-a'].fit.ruleVersion,RECOMMENDATION_RULE);
 });
}catch(e){failed=true;console.error('SIZE_EDGE_FAILED',stage);console.error(e);process.exitCode=1;}
finally{await x.close();}
if(!failed)console.log('SIZE-EDGE real PostgreSQL: '+count+' passed. Synthetic data only; no live provider, payment or mail.');
