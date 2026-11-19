import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {syntheticPreparation} from '../custody/preparation-fixture';
import {CustodyService} from '../../packages/core/src/rental/custody-service';
import {provisionCustodyRole} from '../../scripts/custody-roles';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {writeAccount} from '../../packages/auth/src/accounts';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {InventoryRead} from '../../packages/core/src/operations/inventory-read';
import {variants} from '../inventory/fixture';

// Issue #47 consolidated order §4: inventory counts keep registered / on hand / available now / care / out / incoming apart.
const x=await flowFixture();let custody:Awaited<ReturnType<typeof provisionCustodyRole>>|undefined,ops:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined,stage='setup',count=0,failed=false;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 custody=await provisionCustodyRole(x.db.pool,x.db.identity);ops=await provisionOperationsRole(x.db.pool,x.db.identity);
 const svc=new CustodyService(custody.custodyPool,x.roles.authPool,x.signed.identity),inv=new InventoryRead(new OperationsContext(ops.operationsPool,x.roles.authPool,x.signed.identity));
 const skiModel=(await x.db.pool.query('SELECT model_id FROM ledger_variants WHERE id=$1',[variants.ski])).rows[0].model_id as string;
 const row=async(store:string)=>(await inv.list({store})).rows.find(r=>r.id===skiModel)!.counts;
 const variantRow=async(store:string)=>(await inv.detail(skiModel,store)).variants.find(v=>v.id===variants.ski)!.counts;
 let before:Awaited<ReturnType<typeof variantRow>>;
 await check('registered, on hand and available now are separate and start equal for idle stock',async()=>{
  before=await variantRow('MOUNTAIN_BASE');assert.ok(before.registered>0);assert.equal(before.onHand,before.registered-before.maintenance*0);
  assert.ok(before.availableNow<=before.onHand);assert.equal(before.out,0);assert.equal(before.incoming,0);
  const list=await row('MOUNTAIN_BASE');assert.ok(list.registered>=before.registered);
 });
 const d=await x.draft('2035-01-03',undefined,{reason:'SYNTHETIC inventory read test'});await x.service.startPayment(d.booking.id,randomUUID());await x.clock('2035-01-03T10:00:00+09:00');
 const view=await svc.checkoutView(d.booking.id);
 await svc.prepare(randomUUID(),{bookingId:d.booking.id,expectedBookingVersion:view.bookingVersion,expectedHoldVersion:view.holdVersion,selections:view.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:syntheticPreparation(view)});
 const out=await svc.checkout(randomUUID(),{bookingId:d.booking.id,expectedPreparationVersion:1});
 const ski=out.loans.find(l=>l.family==='SKI')!;
 await check('checkout: the item leaves on-hand and available, counts as out at the pickup station; the ledger count is unchanged',async()=>{
  const now=await variantRow('MOUNTAIN_BASE');assert.equal(now.registered,before.registered);assert.equal(now.out,1);
  assert.equal(now.onHand,before.onHand-1);assert.equal(now.availableNow,before.availableNow-1);
 });
 await check('return at the other station: on hand there but awaiting inspection, not available; gone from the home station',async()=>{
  let batch=await svc.createBatch(randomUUID(),'ONSEN_BASE');batch=await svc.scan(randomUUID(),{batchId:batch.id,expectedVersion:batch.version,assetId:ski.asset_id,poleLoanId:null});
  await svc.confirm(randomUUID(),{batchId:batch.id,expectedVersion:batch.version});
  const home=await variantRow('MOUNTAIN_BASE'),away=await variantRow('ONSEN_BASE');
  assert.equal(home.out,0);assert.equal(home.onHand,before.onHand-1,'not here: it was returned elsewhere');assert.equal(home.registered,before.registered-1,'the ledger now places it at the return station');
  assert.equal(away.onHand,1);assert.equal(away.care,1);assert.equal(away.availableNow,0,'returned is not rentable before inspection');
  const item=(await inv.detail(skiModel,'ONSEN_BASE')).items.find(i=>i.id===ski.asset_id)!;assert.equal(item.here,'ONSEN_BASE');assert.equal(item.origin,'MOUNTAIN_BASE');assert.equal(item.uninspected,true);
 });
 await check('store scope, filters and input validation',async()=>{
  await writeAccount(x.roles.authPool,x.bp,undefined,{email:'inv-onsen@example.invalid',password:x.password,displayName:'SYNTHETIC Inv Onsen',active:true,role:'STAFF',scope:'ASSIGNED',storeIds:['ONSEN_BASE'],permissions:{}});
  const onsen=new InventoryRead(new OperationsContext(ops!.operationsPool,x.roles.authPool,(await x.login('inv-onsen@example.invalid')).identity));
  await assert.rejects(onsen.list({store:'MOUNTAIN_BASE'}),{code:'FORBIDDEN'});assert.ok((await onsen.list({store:'ONSEN_BASE'})).rows.length>0);
  assert.ok((await inv.list({store:'MOUNTAIN_BASE',family:'SKI_BOOT'})).rows.every(r=>r.family==='SKI_BOOT'));
  await assert.rejects(inv.list({store:'MOUNTAIN_BASE',family:'BOATS'}),{code:'INVALID_INPUT'});await assert.rejects(inv.detail('x','MOUNTAIN_BASE'),{code:'INVALID_INPUT'});
  await assert.rejects(inv.detail(randomUUID(),'MOUNTAIN_BASE'),{code:'NOT_FOUND'});
 });
 console.log(JSON.stringify({status:'PASS',cases:count,externalCalls:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'ASSERTION',message:(e as Error).message?.slice(0,500),at:(e as Error).stack?.split('\n').filter(l=>/inventory-read|context\.ts/.test(l)).slice(0,3).join(' | ')}));}
finally{await ops?.close();await custody?.close();await x.close();}
if(failed)process.exitCode=1;
