import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import {flowFixture} from '../flow/fixture';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {AmendmentService} from '../../packages/core/src/operations/amendment-service';
import {TransferService} from '../../packages/core/src/transfer/transfer-service';
import {CustodyService} from '../../packages/core/src/rental/custody-service';
import {WearService} from '../../packages/core/src/wear/service';
import {LedgerService} from '../../packages/core/src/catalog/ledger-service';
import {registerWear} from '../wear/fixture';
import {skiSet,requestFor,variants,fid} from '../inventory/fixture';
const x=await flowFixture();let role:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined,failed=false,stage='setup',count=0;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
try{
 role=await provisionOperationsRole(x.db.pool,x.db.identity);await x.db.pool.query("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,'RENTAL_AMEND',true)",[x.actor]);
 const svc=new AmendmentService(new OperationsContext(role.operationsPool,x.roles.authPool,x.signed.identity)),custody=new CustodyService(role.operationsPool,x.roles.authPool,x.signed.identity),wear=new WearService(x.flow.flowPool,x.roles.authPool,x.signed.identity);
 const ledger=new LedgerService(x.db.pool,{subject:x.actor,role:'ADMIN',storeIds:['MOUNTAIN_BASE','ONSEN_BASE']},async()=>{},async()=>{}),garments=await (async()=>{stage='register wear';return registerWear(ledger,wear);})();
 stage='booking fixture';Object.assign(x.principal,(await loadStaff(x.db.pool,x.actor))!);const d=await x.draft(undefined,skiSet('2035-02-05'));await x.service.startPayment(d.booking.id,randomUUID());
 const fingerprint=async()=>(await x.db.pool.query(`SELECT jsonb_build_object('hold',(SELECT to_jsonb(h) FROM inventory_holds h WHERE id=$1),'loans',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY id),'[]') FROM rental_loan_items l WHERE booking_id=$2),'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM rental_receipts r),'charges',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM ops_charge_requests c)) v`,[d.holdId,d.booking.id])).rows[0].v;
 await check('extension shortage protects the next booking and original facts',async()=>{
  const next=await x.holds.command('create',randomUUID(),requestFor('2035-02-06'));
  const before=await fingerprint(),v=await svc.view(d.booking.id),conditions=structuredClone(v.conditions);conditions.period={...conditions.period,endDate:'2035-02-06',slot:'MULTIDAY'};
  await assert.rejects(svc.quote(randomUUID(),{bookingId:d.booking.id,expectedHoldVersion:v.holdVersion,conditions,reason:'SYNTHETIC shortage'}));assert.deepEqual(await fingerprint(),before);await x.holds.command('cancel',randomUUID(),undefined,next.holdId);
 });
 await check('wrong-store and overdue in-transit replacement are denied without changing booking or stock location',async()=>{
  const source={notes:'SYNTHETIC unavailable replacement',sourceKind:'SYNTHETIC',sourceDocument:'tests/operations/exchange.ts',sourceLocator:'wrong-store'};
  const wrong=await ledger.create('variants',{...source,modelId:fid(1001),family:'SKI',age:'ADULT',tier:'REGULAR',size:'190 cm'}),moving=await ledger.create('variants',{...source,sourceLocator:'moving',modelId:fid(1001),family:'SKI',age:'ADULT',tier:'REGULAR',size:'170 cm'});
  await ledger.create('assets',{...source,variantId:wrong.id,family:'SKI',storeId:'ONSEN_BASE',status:'AVAILABLE',bslStatus:'NOT_APPLICABLE',bslMm:null,bslEvidence:''});const asset=await ledger.create('assets',{...source,sourceLocator:'moving-asset',variantId:moving.id,family:'SKI',storeId:'ONSEN_BASE',status:'AVAILABLE',bslStatus:'NOT_APPLICABLE',bslMm:null,bslEvidence:''});
  const transfers=new TransferService(x.roles.transferPool,x.principal,x.now),batch=(await transfers.command('create',randomUUID(),{sourceStore:'ONSEN_BASE',destinationStore:'MOUNTAIN_BASE',scheduledDate:'2035-01-02',plannedReadyAt:'2035-01-02T19:00:00+09:00',neededBy:'2035-01-03T08:30:00+09:00',basis:'SYNTHETIC explicit readiness',lines:[{assetId:asset.id}]})).batch;await x.clock('2035-01-02T17:00:00+09:00');await transfers.command('dispatch',randomUUID(),{},batch.id);await x.clock('2035-02-05T10:00:00+09:00');
  const before=await fingerprint(),v=await svc.view(d.booking.id);for(const variant of [wrong.id,moving.id]){const conditions=structuredClone(v.conditions);conditions.members[0]!.items[0]!.variantIds=[variant];await assert.rejects(svc.quote(randomUUID(),{bookingId:d.booking.id,expectedHoldVersion:v.holdVersion,conditions,reason:'SYNTHETIC denied replacement'}));}assert.deepEqual(await fingerprint(),before);assert.equal((await ledger.get('assets',asset.id)).storeId,'ONSEN_BASE');assert.equal((await transfers.get(batch.id)).pieces[0]!.state,'IN_TRANSIT');
 });
 await x.clock('2035-02-05T10:00:00+09:00');
 await check('prepared length replacement preserves confirmed booking and checks out amended allocation',async()=>{
  const v=await custody.checkoutView(d.booking.id),p=await custody.prepare(randomUUID(),{bookingId:d.booking.id,expectedBookingVersion:v.bookingVersion,expectedHoldVersion:v.holdVersion,selections:v.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:'SYNTHETIC fit'});
  const current=await svc.view(d.booking.id),conditions=structuredClone(current.conditions);conditions.members[0]!.items[0]!.variantIds=[variants.skiAlt];
  const q=await svc.quote(randomUUID(),{bookingId:d.booking.id,expectedHoldVersion:current.holdVersion,conditions,reason:'SYNTHETIC prepared length'});
  await assert.rejects(svc.accept(randomUUID(),{quoteId:q.id,reason:'SYNTHETIC fit required',fitEvidence:''}),{code:'EXCHANGE_FIT_EVIDENCE_REQUIRED'});
  await svc.accept(randomUUID(),{quoteId:q.id,reason:'SYNTHETIC prepared length',fitEvidence:'SYNTHETIC refit'});
  const out=await custody.checkout(randomUUID(),{bookingId:d.booking.id,expectedPreparationVersion:p.preparation.version});assert.equal(out.loans.find(l=>l.family==='SKI')!.asset_id,fid(1202));
 });
 await check('OUT boot size exchange records factual receipt and replacement with unknown BSL retained',async()=>{
  const source={notes:'SYNTHETIC boot',sourceKind:'SYNTHETIC',sourceDocument:'tests/operations/exchange.ts',sourceLocator:'replacement-boot'};
  const v=await ledger.create('variants',{...source,modelId:fid(1002),family:'SKI_BOOT',age:'ADULT',tier:'REGULAR',size:'27.5 cm'}),a=await ledger.create('assets',{...source,variantId:v.id,family:'SKI_BOOT',storeId:'MOUNTAIN_BASE',status:'AVAILABLE',bslStatus:'UNVERIFIED',bslMm:null,bslEvidence:''});
  const current=await svc.view(d.booking.id),conditions=structuredClone(current.conditions);conditions.members[0]!.items.find(i=>i.family==='SKI_BOOT')!.variantIds=[v.id];
  const q=await svc.quote(randomUUID(),{bookingId:d.booking.id,expectedHoldVersion:current.holdVersion,conditions,reason:'SYNTHETIC boot size'});await svc.accept(randomUUID(),{quoteId:q.id,reason:'SYNTHETIC boot exchange',fitEvidence:'SYNTHETIC measured refit'});
  const rows=(await x.db.pool.query("SELECT asset_id,state FROM rental_loan_items WHERE booking_id=$1 AND family='SKI_BOOT'",[d.booking.id])).rows;assert.equal(rows.find(r=>r.state==='OUT')!.asset_id,a.id);assert.equal(rows.length,2);assert.equal((await ledger.get('assets',a.id)).bslMm,null);
 });
 await check('ski to board exchange is atomic even if replacement insertion fails after receipts',async()=>{
  const current=await svc.view(d.booking.id),conditions=structuredClone(current.conditions);conditions.members[0]!.product='SNOWBOARD_SET';conditions.members[0]!.items=[{family:'SNOWBOARD',variantIds:[variants.board]},{family:'SNOWBOARD_BOOT',variantIds:[variants.boardBoot]}];
  const q=await svc.quote(randomUUID(),{bookingId:d.booking.id,expectedHoldVersion:current.holdVersion,conditions,reason:'SYNTHETIC sport change'}),input={quoteId:q.id,reason:'SYNTHETIC sport exchange',fitEvidence:'SYNTHETIC board fit'},before=await fingerprint();
  await x.db.pool.query("CREATE FUNCTION synthetic_replacement_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.family='SNOWBOARD' THEN RAISE EXCEPTION 'SYNTHETIC_REPLACEMENT_FAILURE' USING ERRCODE='23514';END IF;RETURN NEW;END$$;CREATE TRIGGER synthetic_replacement_failure BEFORE INSERT ON rental_loan_items FOR EACH ROW EXECUTE FUNCTION synthetic_replacement_failure()");
  await assert.rejects(svc.accept(randomUUID(),input));assert.deepEqual(await fingerprint(),before);
  await x.db.pool.query('DROP TRIGGER synthetic_replacement_failure ON rental_loan_items;DROP FUNCTION synthetic_replacement_failure()');
  await svc.accept(randomUUID(),input);const out=(await x.db.pool.query("SELECT family FROM rental_loan_items WHERE booking_id=$1 AND state='OUT' ORDER BY family",[d.booking.id])).rows;assert.deepEqual(out.map(r=>r.family),['SNOWBOARD','SNOWBOARD_BOOT']);
 });
 await check('wear size exchange preserves total quantity, old receipt remains unavailable for same-day reuse',async()=>{
  const conditions={...requestFor('2035-02-05'),contractVersion:'INTEGRATED_V1_2' as const,members:[{key:'wear-a',product:'WEAR_SET' as const,age:'ADULT' as const,tier:'STANDARD' as const,wearSport:'SKI' as const,items:[{family:'WEAR_JACKET' as const,variantIds:[garments.variants['WEAR_JACKET-M']!]},{family:'WEAR_PANTS' as const,variantIds:[garments.variants['WEAR_PANTS-M']!]}]}]};
  const b=await x.draft(undefined,conditions);const paid=await x.service.startPayment(b.booking.id,randomUUID());await wear.checkout(randomUUID(),{bookingId:b.booking.id,expectedBookingVersion:paid.version,store:'MOUNTAIN_BASE',reason:'SYNTHETIC checkout'});
  const before=(await x.db.pool.query('SELECT sum(total)::int n FROM wear_pools')).rows[0].n,current=await svc.view(b.booking.id),next=structuredClone(current.conditions);next.members[0]!.items[0]!.variantIds=[garments.variants['WEAR_JACKET-L']!];
  const q=await svc.quote(randomUUID(),{bookingId:b.booking.id,expectedHoldVersion:current.holdVersion,conditions:next,reason:'SYNTHETIC jacket size'});await svc.accept(randomUUID(),{quoteId:q.id,reason:'SYNTHETIC jacket exchange',fitEvidence:'SYNTHETIC fit'});
  assert.equal((await x.db.pool.query('SELECT sum(total)::int n FROM wear_pools')).rows[0].n,before);assert.equal((await x.db.pool.query('SELECT count(*)::int n FROM wear_loans WHERE booking_id=$1 AND returned<quantity',[b.booking.id])).rows[0].n,2);assert.equal((await x.db.pool.query('SELECT sum(returned_pending)::int n FROM wear_pools')).rows[0].n,1);
 });
 await check('revoked maintained session cannot amend or use custody executor',async()=>{
  await x.db.pool.query('DELETE FROM auth_session WHERE id=$1',[x.signed.identity.sessionId]);await assert.rejects(svc.view(d.booking.id));await assert.rejects(role!.operationsPool.query('SELECT ops_checkout_amendment($1)',[randomUUID()]));
 });
 console.log(JSON.stringify({status:'PASS',cases:count,providerCalls:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'ASSERTION',detail:e instanceof assert.AssertionError?e.message:'SAFE_DETAILS_ONLY',location:(e as Error).stack?.split('\n').filter(l=>l.includes('/packages/')||l.includes('/tests/')).join('\n')}));}finally{await role?.close();await x.close();}if(failed)process.exit(1);
