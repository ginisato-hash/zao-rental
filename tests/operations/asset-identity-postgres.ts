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

// QR item identification (TD: a model-page redirect is not identification). The item QR is one ledger_assets id; locate() must
// return the item's own model/size/status/station/loan, refuse another station / no permission / malformed input, and never write.
const x=await flowFixture();let custody:Awaited<ReturnType<typeof provisionCustodyRole>>|undefined,ops:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined,stage='setup',count=0,failed=false;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const WRITES=`SELECT (SELECT count(*)::int FROM rental_loan_items) l,(SELECT count(*)::int FROM rental_receipts) r,(SELECT count(*)::int FROM rental_return_candidates) c,(SELECT count(*)::int FROM ledger_history) h,(SELECT string_agg(a.id||a.status||a.store_id||a.version,',' ORDER BY a.id) FROM ledger_assets a) a`;
try{
 custody=await provisionCustodyRole(x.db.pool,x.db.identity);ops=await provisionOperationsRole(x.db.pool,x.db.identity);
 const svc=new CustodyService(custody.custodyPool,x.roles.authPool,x.signed.identity),inv=new InventoryRead(new OperationsContext(ops.operationsPool,x.roles.authPool,x.signed.identity));
 const idle=(await x.db.pool.query("SELECT a.id,a.store_id,a.status,v.size,m.code,m.name FROM ledger_assets a JOIN ledger_variants v ON v.id=a.variant_id JOIN ledger_models m ON m.id=v.model_id WHERE a.variant_id=$1 AND a.store_id='MOUNTAIN_BASE' ORDER BY a.id LIMIT 1",[variants.ski])).rows[0];
 await check('an idle item resolves to its own id, model, size, status and station, with no loan',async()=>{
  const r=await inv.locate(idle.id);assert.equal(r.assetId,idle.id);assert.equal(r.modelCode,idle.code);assert.equal(r.modelName,idle.name);assert.equal(r.size,idle.size);assert.equal(r.store,'MOUNTAIN_BASE');assert.equal(r.status,idle.status);assert.equal(r.loan,null);
 });
 const d=await x.draft('2035-01-03',undefined,{reason:'SYNTHETIC asset identity test'});await x.service.startPayment(d.booking.id,randomUUID());await x.clock('2035-01-03T10:00:00+09:00');
 const view=await svc.checkoutView(d.booking.id);
 await svc.prepare(randomUUID(),{bookingId:d.booking.id,expectedBookingVersion:view.bookingVersion,expectedHoldVersion:view.holdVersion,selections:view.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:syntheticPreparation(view)});
 const out=await svc.checkout(randomUUID(),{bookingId:d.booking.id,expectedPreparationVersion:1});
 const ski=out.loans.find(l=>l.family==='SKI')!;
 await check('an item on loan shows the loan and its short booking number only; a different item is not mistaken for it',async()=>{
  const r=await inv.locate(ski.asset_id as string);assert.equal(r.loan?.state,'OUT');assert.equal(r.loan?.pickupStore,'MOUNTAIN_BASE');assert.equal(r.loan?.bookingRef,d.booking.id.slice(0,8).toUpperCase());
  assert.equal(JSON.stringify(r).toLowerCase().includes('@'),false,'no customer data in the identity');
  const other=await inv.locate(idle.id===ski.asset_id?(await x.db.pool.query("SELECT id FROM ledger_assets WHERE id<>$1 LIMIT 1",[ski.asset_id])).rows[0].id:idle.id);assert.equal(other.loan,null,'another item carries no loan');
 });
 await check('reading the same QR repeatedly is read-only: no loan, receipt, candidate, history or item change',async()=>{
  const before=(await x.db.pool.query(WRITES)).rows[0];for(let i=0;i<5;i++){await inv.locate(idle.id);await inv.locate(ski.asset_id as string);}
  assert.deepEqual((await x.db.pool.query(WRITES)).rows[0],before);
 });
 await check('another station, no permission and malformed input never identify an item',async()=>{
  await writeAccount(x.roles.authPool,x.bp,undefined,{email:'ident-onsen@example.invalid',password:x.password,displayName:'SYNTHETIC Ident Onsen',active:true,role:'STAFF',scope:'ASSIGNED',storeIds:['ONSEN_BASE'],permissions:{INVENTORY_VIEW:true}});
  await writeAccount(x.roles.authPool,x.bp,undefined,{email:'ident-none@example.invalid',password:x.password,displayName:'SYNTHETIC Ident None',active:true,role:'VIEWER',scope:'ALL',storeIds:[],permissions:{INVENTORY_VIEW:false,BOOKING_VIEW:true}});
  const onsen=new InventoryRead(new OperationsContext(ops!.operationsPool,x.roles.authPool,(await x.login('ident-onsen@example.invalid')).identity));
  await assert.rejects(onsen.locate(idle.id),{code:'NOT_FOUND',status:404});
  await assert.rejects(onsen.locate(ski.asset_id as string),{code:'NOT_FOUND',status:404});
  const none=new InventoryRead(new OperationsContext(ops!.operationsPool,x.roles.authPool,(await x.login('ident-none@example.invalid')).identity));
  await assert.rejects(none.locate(idle.id),{code:'NOT_FOUND',status:404},'no INVENTORY_VIEW is indistinguishable from an unknown item');
  for(const bad of ['','not-a-uuid','https://evil.example/'+idle.id,'javascript:alert(1)','zao-rental:reservation:'+idle.id,idle.id+'-left',idle.id+"'; DROP TABLE ledger_assets;--",null,undefined,42])await assert.rejects(inv.locate(bad),{code:'INVALID_INPUT',status:422});
  await assert.rejects(inv.locate(randomUUID()),{code:'NOT_FOUND',status:404});
  await assert.rejects(inv.locate(d.booking.id),{code:'NOT_FOUND',status:404},'a booking id is not an item');
 });
 console.log(JSON.stringify({status:'PASS',cases:count,externalCalls:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'ASSERTION',message:(e as Error).message?.slice(0,500)}));}
finally{await ops?.close();await custody?.close();await x.close();}
if(failed)process.exitCode=1;
