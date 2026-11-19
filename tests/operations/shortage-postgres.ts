import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {flowFixture} from '../flow/fixture';
import {syntheticPreparation} from '../custody/preparation-fixture';
import {CustodyService} from '../../packages/core/src/rental/custody-service';
import {provisionCustodyRole} from '../../scripts/custody-roles';
import {provisionOperationsRole} from '../../scripts/operations-roles';
import {writeAccount} from '../../packages/auth/src/accounts';
import {OperationsContext} from '../../packages/core/src/operations/context';
import {OrdersService} from '../../packages/core/src/operations/orders-service';
import {evaluateShortage,remainingDemand,type ShortageCandidate} from '../../packages/core/src/operations/shortage';

// With shortage (Issue #47 #7008569703 §5.3, TD FB #7010252887 §5): a read-only judgement from the existing mixed
// allocation authority, with Orders tab and Dashboard counts describing the same set. Synthetic local PostgreSQL only.
// Real cause used here: the previous renter has not returned the only unit (overdue custody), so the next orders that were
// promised that unit cannot be covered at their station — the planner's INSUFFICIENT; when a matching unit exists only at
// the other station, the same order becomes TRANSFER_PLAN_REQUIRED instead.
const x=await flowFixture();let ops:Awaited<ReturnType<typeof provisionOperationsRole>>|undefined,custody:Awaited<ReturnType<typeof provisionCustodyRole>>|undefined,stage='setup',count=0,failed=false;
async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();count++;console.log('PASS '+name);}
const bufferOverride={reason:'SYNTHETIC shortage read test'};
// Everything the read must never write: HOLDs, claims (physical, wear, provisional), bookings, replans, ledger history.
const fingerprint=async()=>{const parts=[];for(const sql of ['SELECT id,state,version,payment_state,allocation_stage,transfer_attention FROM inventory_holds ORDER BY id','SELECT hold_id,requirement_key,day,asset_id,pole_id,active FROM inventory_claims ORDER BY 1,2,3,4,5','SELECT hold_id,requirement_key,day,active FROM wear_claims ORDER BY 1,2,3','SELECT hold_id,requirement_key,day,state FROM provisional_capacity_claims ORDER BY 1,2,3','SELECT id,state,version FROM rental_bookings ORDER BY id','SELECT count(*) FROM inventory_replans','SELECT count(*) FROM ledger_history','SELECT count(*) FROM transfer_pieces'])parts.push((await x.db.pool.query(sql)).rows);return createHash('sha256').update(JSON.stringify(parts)).digest('hex');};
try{
 ops=await provisionOperationsRole(x.db.pool,x.db.identity);custody=await provisionCustodyRole(x.db.pool,x.db.identity);
 const orders=new OrdersService(new OperationsContext(ops.operationsPool,x.roles.authPool,x.signed.identity)),svc=new CustodyService(custody.custodyPool,x.roles.authPool,x.signed.identity);
 const first=await x.draft('2035-01-10',undefined,bufferOverride);await x.service.startPayment(first.booking.id,randomUUID());
 const a=await x.draft('2035-01-11',undefined,bufferOverride);await x.service.startPayment(a.booking.id,randomUUID());
 const b=await x.draft('2035-01-12',undefined,bufferOverride);await x.service.startPayment(b.booking.id,randomUUID());
 const draft=await x.draft('2035-01-13',undefined,bufferOverride);
 const store=first.conditions.pickupStore,other=store==='MOUNTAIN_BASE'?'ONSEN_BASE':'MOUNTAIN_BASE';

 await check('normal stock: no order is reported short, and the read writes nothing',async()=>{
  await x.clock('2035-01-09T09:00:00+09:00');const before=await fingerprint();
  const r=await orders.list({stores:[store],tab:'shortage'});assert.equal(r.total,0);assert.equal(r.counts.shortage,0);assert.equal(r.counts.shortageIndeterminate,0);
  const d=await orders.dashboard({store,range:'next7'});assert.equal(d.shortageOut,0);assert.equal(d.shortageOutIndeterminate,0);
  assert.equal(await fingerprint(),before,'no HOLD/claim/booking/replan write');
  // Other tabs are unchanged and carry no shortage judgement.
  const all=await orders.list({stores:[store]});assert.equal(all.counts.shortage,null);assert.ok(all.rows.every(o=>o.shortage===undefined));
 });
 // The first renter picks up on 01-10 and does not return by the due time.
 await x.clock('2035-01-10T10:00:00+09:00');
 const view=await svc.checkoutView(first.booking.id);
 await svc.prepare(randomUUID(),{bookingId:first.booking.id,expectedBookingVersion:view.bookingVersion,expectedHoldVersion:view.holdVersion,selections:view.items.map(i=>({requirementKey:i.requirement_key,assetId:i.asset_id,poleId:i.pole_id})),fitEvidence:syntheticPreparation(view)});
 await svc.checkout(randomUUID(),{bookingId:first.booking.id,expectedPreparationVersion:1});

 await check('before the due time the item out on rent is not a shortage for the later orders',async()=>{
  const r=await orders.list({stores:[store],tab:'shortage'});assert.equal(r.total,0,JSON.stringify(r.rows.map(o=>[o.id.slice(0,8),o.shortage])));
 });
 await check('overdue return: later orders promised that unit are INSUFFICIENT; the late order itself and drafts are never listed',async()=>{
  await x.clock('2035-01-11T08:00:00+09:00');const before=await fingerprint();
  const r=await orders.list({stores:[store],tab:'shortage'});
  assert.deepEqual(r.rows.map(o=>o.id),[a.booking.id,b.booking.id],'ordered by pickup date');assert.ok(r.rows.every(o=>o.shortage==='INSUFFICIENT'),JSON.stringify(r.rows.map(o=>o.shortage)));
  assert.ok(!r.rows.some(o=>o.id===draft.booking.id||o.id===first.booking.id));assert.equal(r.counts.shortage,2);assert.equal(r.total,2);
  assert.equal(await fingerprint(),before,'judging a shortage never writes or re-allocates');
  // Dashboard counts and the Orders tab describe the same set for the same station, direction and dates.
  const d=await orders.dashboard({store,range:'today'}),t=await orders.list({stores:[store],tab:'shortage',direction:'out',from:d.from,to:d.to});
  assert.equal(d.shortageOut,1);assert.equal(t.total,d.shortageOut);assert.deepEqual(t.rows.map(o=>o.id),[a.booking.id]);
  const w=await orders.dashboard({store,range:'next7'}),tw=await orders.list({stores:[store],tab:'shortage',direction:'out',from:w.from,to:w.to});
  assert.equal(w.shortageOut,2);assert.equal(tw.total,w.shortageOut);
  // Paging slices the evaluated set: two pages of one cover both, with the same total.
  const p1=await orders.list({stores:[store],tab:'shortage',pageSize:1,page:1}),p2=await orders.list({stores:[store],tab:'shortage',pageSize:1,page:2});
  assert.equal(p1.total,2);assert.equal(p2.total,2);assert.deepEqual([...p1.rows,...p2.rows].map(o=>o.id),[a.booking.id,b.booking.id]);
  // Filters apply before the slice.
  assert.equal((await orders.list({stores:[store],tab:'shortage',search:b.booking.id.slice(0,8)})).total,1);
  assert.equal((await orders.list({stores:[store],tab:'shortage',status:'PICKED_UP'})).total,0);
 });
 await check('over budget is INDETERMINATE — listed and counted apart, never rounded to zero or "no shortage"',async()=>{
  const tight=new OrdersService(new OperationsContext(ops!.operationsPool,x.roles.authPool,x.signed.identity),undefined,{orders:1,millis:60000});
  const r=await tight.list({stores:[store],tab:'shortage'});assert.equal(r.total,2);assert.equal(r.counts.shortage,1);assert.equal(r.counts.shortageIndeterminate,1);
  assert.deepEqual(r.rows.map(o=>o.shortage),['INSUFFICIENT','INDETERMINATE']);
  const d=await tight.dashboard({store,range:'next7'});assert.equal(d.shortageOut,1);assert.equal(d.shortageOutIndeterminate,1);
 });
 await check('a matching unit registered only at the other station makes it TRANSFER_PLAN_REQUIRED, distinct from INSUFFICIENT',async()=>{
  const unit=(await x.db.pool.query('SELECT a.variant_id,a.family FROM rental_loan_items l JOIN ledger_assets a ON a.id=l.asset_id WHERE l.booking_id=$1 AND l.family=$2',[first.booking.id,'SKI'])).rows[0] as {variant_id:string;family:string};
  const c=await x.db.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.actor','synthetic-shortage-seed',true),set_config('zao.reason','SYNTHETIC shortage fixture',true)");
   await c.query(`INSERT INTO ledger_assets(id,variant_id,family,initial_store_id,store_id,status,bsl_status,bsl_evidence,notes,source_kind,source_document,source_locator) VALUES($1,$2,$3,$4,$4,'AVAILABLE','NOT_APPLICABLE','','','SYNTHETIC','tests/operations/shortage-postgres.ts','shortage-other-station')`,[randomUUID(),unit.variant_id,unit.family,other]);
   await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  const before=await fingerprint();
  const r=await orders.list({stores:[store],tab:'shortage'});const states=Object.fromEntries(r.rows.map(o=>[o.id,o.shortage]));
  assert.equal(states[a.booking.id],'TRANSFER_PLAN_REQUIRED',JSON.stringify(states));assert.equal(r.counts.shortage,r.rows.filter(o=>o.shortage!=='INDETERMINATE').length);
  assert.equal(await fingerprint(),before,'no transfer or claim is created by the read');
 });
 await check('remaining demand: handed-out items are not demanded again; an order with nothing left is never short',async()=>{
  const cond=a.conditions,gear=cond.members.flatMap(m=>m.items.filter(i=>!i.family.startsWith('WEAR_')).map(i=>m.key+':'+i.family)),wear=cond.members.flatMap(m=>m.items.filter(i=>i.family.startsWith('WEAR_')).map(i=>m.key+':'+i.family));
  assert.equal(remainingDemand(cond,gear,wear),null);
  const partial=remainingDemand(cond,gear.filter(k=>!k.endsWith(':SKI')),wear);assert.ok(partial);assert.deepEqual(partial!.members.flatMap(m=>m.items.map(i=>i.family)),['SKI']);
  // Without an ACTIVE HOLD there is nothing to judge (cancelled/expired orders are not a shortage).
  const c=await x.db.pool.connect();try{const none:ShortageCandidate={id:randomUUID(),hold_id:null,hold_state:null,buffer_override:null,cond,loaned:[],wear_loaned:[]};
   assert.equal((await evaluateShortage(c,[none],new Date())).size,0);}finally{c.release();}
 });
 await check('another station manager cannot read the shortage of a station outside its scope',async()=>{
  await writeAccount(x.roles.authPool,x.bp,undefined,{email:'shortage-other@example.invalid',password:x.password,displayName:'SYNTHETIC Shortage Other',active:true,role:'MANAGER',scope:'ASSIGNED',storeIds:[other as 'ONSEN_BASE'],permissions:{}});
  const o=new OrdersService(new OperationsContext(ops!.operationsPool,x.roles.authPool,(await x.login('shortage-other@example.invalid')).identity));
  await assert.rejects(o.list({stores:[store],tab:'shortage'}),{code:'FORBIDDEN'});await assert.rejects(o.dashboard({store}),{code:'FORBIDDEN'});
 });
 console.log(JSON.stringify({status:'PASS',cases:count,externalCalls:0}));
}catch(e){failed=true;console.error(JSON.stringify({status:'FAIL',stage,code:(e as {code?:string}).code??'ASSERTION',message:(e as Error).message?.slice(0,700),at:(e as Error).stack?.split('\n').filter(l=>/shortage|orders-service|allocation|context\.ts/.test(l)).slice(0,5).join(' | ')}));}
finally{await ops?.close();await custody?.close();await x.close();}
if(failed)process.exitCode=1;
