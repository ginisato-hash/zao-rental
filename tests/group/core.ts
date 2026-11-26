import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {Pool} from 'pg';
import {groupFixture,skiMember,PERIOD} from './fixture';
import {HoldService} from '../../packages/core/src/inventory/hold-service';
import {skiSet} from '../inventory/fixture';
import {loadStaff} from '../../packages/auth/src/staff-auth';
import type {Adjustment} from '../../packages/contracts/src/group-order';

// Isolated real PostgreSQL, synthetic data only. Stock: 150 ski pairs, 150 boots, 150 poles => public cap floor(150*0.95)=142.
let stage='setup',failed=false,count=0;const x=await groupFixture(150);const q=(s:string,p:unknown[]=[])=>x.db.pool.query(s,p);
async function check(name:string,f:()=>Promise<void>){stage=name;await f();count++;console.log('PASS '+name);}
const rejects=(p:Promise<unknown>,code:string)=>assert.rejects(p,(e:unknown)=>(e as {code?:string}).code===code||(console.error('expected',code,'got',(e as Error).message,(e as {detail?:unknown}).detail),false));
const groupClaims=async()=>Number((await q("SELECT count(*) n FROM inventory_claims c JOIN inventory_holds h ON h.id=c.hold_id WHERE c.active AND h.allocation_stage='GROUP_RESERVED'")).rows[0].n);
const residual=async()=>({orders:Number((await q('SELECT count(*) n FROM group_orders')).rows[0].n),parts:Number((await q('SELECT count(*) n FROM group_order_parts')).rows[0].n),holds:Number((await q("SELECT count(*) n FROM inventory_holds WHERE allocation_stage='GROUP_RESERVED'")).rows[0].n),claims:await groupClaims(),outbox:Number((await q('SELECT count(*) n FROM group_notification_outbox')).rows[0].n),events:Number((await q("SELECT count(*) n FROM group_events WHERE event_type='GROUP_REVIEW_HELD'")).rows[0].n)});
const snapOf=async()=>JSON.stringify(await Promise.all(['rental_bookings','rental_payment_attempts','rental_provider_events','rental_notifications','booking_notification_outbox','payment_projection_events'].map(async t=>(await q("SELECT to_regclass($1) r",[t])).rows[0].r?Number((await q(`SELECT count(*) n FROM ${t}`)).rows[0].n):-1)));
const outbox=async(id:string,type?:string)=>(await q('SELECT * FROM group_notification_outbox WHERE group_id=$1'+(type?' AND event_type=$2':''),type?[id,type]:[id])).rows;
const release=(groupId:string,rev:number,reason='SYNTHETIC release')=>x.svc.release(x.admin,groupId,{requestKey:randomUUID(),expectedRevision:rev,reason});
const normalHold=async(day:string)=>{const owner=await x.holds.command('create',randomUUID(),{...skiSet(day)},undefined,undefined);return owner;};
try{
 const token=await x.entrance();

 await check('entrance: permanent, hash only, ADMIN only, no per-group approval; independent groups from one URL; no cross-group access',async()=>{
  await rejects(x.svc.rotateEntrance(x.manager,'SYNTHETIC not allowed'),'FORBIDDEN');
  assert.equal(await x.svc.entranceOpen(token),true);assert.equal(await x.svc.entranceOpen('x'.repeat(43)),false);
  const stored=(await q('SELECT token_sha256 FROM group_entrance')).rows[0].token_sha256;assert.ok(!stored.includes(token)&&/^[a-f0-9]{64}$/.test(stored));
  const a=await x.start(token,'SYNTHETIC A'),b=await x.start(token,'SYNTHETIC B');assert.notEqual(a.groupId,b.groupId);
  assert.equal(Number((await q('SELECT count(*) n FROM group_orders')).rows[0].n),2);
  assert.equal(Number((await q("SELECT count(*) n FROM inventory_holds WHERE allocation_stage='GROUP_RESERVED'")).rows[0].n),0,'entrance/start/draft consume no stock');
  await x.svc.saveMembers(a.owner,a.groupId,a.revision,[skiMember('a1')]);
  await rejects(x.svc.get({...a.owner,groupId:b.groupId},b.groupId),'NOT_FOUND');await rejects(x.svc.get({kind:'OWNER',groupId:b.groupId,secret:a.owner.secret},b.groupId),'NOT_FOUND');
  await rejects(x.svc.saveMembers({...a.owner,groupId:b.groupId},b.groupId,b.revision,[skiMember('x')]),'NOT_FOUND');
  const view=await x.svc.get(a.owner,a.groupId);assert.equal((view.group as {contactEmail?:string}).contactEmail,undefined,'owner view carries no staff-only fields');
  // unknown / disabled entrance reveals nothing and creates nothing
  await rejects(x.svc.startApplication('y'.repeat(43),randomUUID(),'z'.repeat(43),{groupLabel:'x',contactName:'x',contactEmail:'a@example.invalid',locale:'ja',pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',contractVersion:'INTEGRATED_V1_4',period:PERIOD}),'ENTRANCE_UNAVAILABLE');
  await x.svc.setEntranceEnabled(x.admin,false,'SYNTHETIC incident stop');
  await rejects(x.start(token,'SYNTHETIC C'),'ENTRANCE_UNAVAILABLE');assert.equal((await x.svc.get(a.owner,a.groupId)).group.status,'DRAFT','existing group unaffected by entrance stop');
  await x.svc.setEntranceEnabled(x.admin,true,'SYNTHETIC resume');const c=await x.start(token,'SYNTHETIC C');assert.ok(c.groupId);
  // replay of the same start key returns the same group
  const s=a.owner.secret,k=randomUUID(),inp={groupLabel:'R',contactName:'R',contactEmail:'r@example.invalid',locale:'en' as const,pickupStore:'MOUNTAIN_BASE',returnStore:'MOUNTAIN_BASE',contractVersion:'INTEGRATED_V1_4' as const,period:PERIOD};
  const r1=await x.svc.startApplication(token,k,s+'0',inp),r2=await x.svc.startApplication(token,k,s+'0',inp);assert.equal(r1.groupId,r2.groupId);assert.equal(r2.replayed,true);
  await rejects(x.svc.startApplication(token,k,s+'0',{...inp,groupLabel:'different'}),'IDEMPOTENCY_MISMATCH');
 });

 await check('submit: whole group held in one tx as the explicit no-expiry protection kind; one REVIEW_HELD notification; idempotent replay',async()=>{
  const g=await x.held(token,3,'SYNTHETIC held');
  const h=(await q("SELECT h.* FROM inventory_holds h JOIN group_order_parts p ON p.hold_id=h.id WHERE p.group_id=$1",[g.groupId])).rows[0];
  assert.equal(h.allocation_stage,'GROUP_RESERVED');assert.equal(h.expires_at,null);assert.equal(h.payment_state,'NONE');assert.equal(h.state,'ACTIVE');assert.equal(h.confirmed_at,null);
  const ob=await outbox(g.groupId);assert.equal(ob.length,1);assert.equal(ob[0].event_type,'GROUP_REVIEW_HELD');assert.equal(ob[0].dedupe_key,`${g.groupId}:GROUP_REVIEW_HELD:${g.revision}`);
  const key=randomUUID();const again=await x.svc.submit(g.owner,g.groupId,{requestKey:key,expectedRevision:g.revision-1,quoteId:g.quote.quoteId}).catch(e=>e);assert.equal((again as {code:string}).code,'STALE_REVISION');
  // replay of the original key (stored result) is byte-identical and writes nothing new
  const rows=await q("SELECT request_key FROM group_requests WHERE actor_key=$1",['group:'+g.groupId]);const rk=rows.rows[0].request_key;
  const replay=await x.svc.submit(g.owner,g.groupId,{requestKey:rk,expectedRevision:g.revision-1,quoteId:g.quote.quoteId});assert.equal(replay.replayed,true);assert.equal(replay.status,'REVIEW_HELD');
  assert.equal((await outbox(g.groupId)).length,1);
  await rejects(x.svc.submit(g.owner,g.groupId,{requestKey:rk,expectedRevision:g.revision,quoteId:g.quote.quoteId}),'IDEMPOTENCY_MISMATCH');
  await release(g.groupId,g.revision);
 });

 await check('sizes 1/20/21/50/100 are each held completely (parts <=20) and 101 is refused; claims are exactly accounted',async()=>{
  for(const n of [1,20,21,50,100]){
   const before=await groupClaims();const g=await x.held(token,n,'SYNTHETIC size '+n);
   const parts=(await q('SELECT part_no,member_count,claim_count FROM group_order_parts WHERE group_id=$1 AND active ORDER BY part_no',[g.groupId])).rows;
   assert.equal(parts.length,Math.ceil(n/20));assert.equal(parts.reduce((s,p)=>s+p.member_count,0),n);assert.ok(parts.every(p=>p.member_count<=20));
   assert.equal((await groupClaims())-before,n*3,'SKI+BOOT+POLE per member for the single day');
   const members=(await q('SELECT count(*) n,count(part_no) p FROM group_members WHERE group_id=$1',[g.groupId])).rows[0];assert.equal(Number(members.n),n);assert.equal(Number(members.p),n);
   await release(g.groupId,g.revision);assert.equal(await groupClaims(),before);
  }
  const a=await x.start(token,'SYNTHETIC 101');await rejects(x.svc.saveMembers(a.owner,a.groupId,a.revision,Array.from({length:101},(_,i)=>skiMember('m'+i))),'GROUP_TOO_LARGE');
 });

 await check('ordinary booking regression: normal Square-path booking still confirms only through payment success; ordinary hold keeps 600s expiry',async()=>{
  const d=await x.draft('2035-03-05');const hold=(await q('SELECT expires_at,allocation_stage,payment_state FROM inventory_holds WHERE id=$1',[d.holdId])).rows[0];
  assert.equal(hold.allocation_stage,'PROVISIONAL');assert.equal(Math.round((hold.expires_at.getTime()-x.now().getTime())/1000),600);
  const paid=await x.service.startPayment(d.booking.id,randomUUID());assert.equal(paid.state,'CONFIRMED_DEV');assert.equal((await q('SELECT payment_state FROM inventory_holds WHERE id=$1',[d.holdId])).rows[0].payment_state,'SUCCESS');
 });

 await check('all-or-nothing: failure injected at part 3 leaves parent, parts, holds, claims, quote, notifications untouched',async()=>{
  const g=await x.quoted(token,60,'SYNTHETIC inject');const base=await residual();
  await q("CREATE FUNCTION group_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.part_no=3 THEN RAISE EXCEPTION 'INJECTED_FAILURE' USING ERRCODE='23514';END IF;RETURN NEW;END$$");
  await q('CREATE TRIGGER group_test_fail BEFORE INSERT ON group_order_parts FOR EACH ROW EXECUTE FUNCTION group_test_fail()');
  await assert.rejects(x.svc.submit(g.owner,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,quoteId:g.quote.quoteId}));
  await q('DROP TRIGGER group_test_fail ON group_order_parts');
  assert.deepEqual(await residual(),base);
  const view=await x.svc.get(g.owner,g.groupId);assert.equal(view.group.status,'QUOTED');assert.equal(view.parts.length,0);
  assert.equal(Number((await q('SELECT count(*) n FROM group_members WHERE group_id=$1 AND part_no IS NOT NULL',[g.groupId])).rows[0].n),0);
  // and it can be submitted afterwards (nothing was left half way)
  const ok=await x.svc.submit(g.owner,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,quoteId:g.quote.quoteId});assert.equal(ok.parts,3);await release(g.groupId,ok.revision);
 });

 await check('shortage: insufficient stock holds nothing; two big groups cannot both pass; last units go to exactly one, ordinary booking included',async()=>{
  const big=await x.held(token,90,'SYNTHETIC big');const base=await residual();
  const t=await x.quoted(token,60,'SYNTHETIC too many');await rejects(x.svc.submit(t.owner,t.groupId,{requestKey:randomUUID(),expectedRevision:t.revision,quoteId:t.quote.quoteId}),'INSUFFICIENT_STOCK');
  assert.deepEqual({...(await residual()),orders:base.orders+1},{...base,orders:base.orders+1});
  // 52 units remain under the 95% public cap: two groups of 52 race, exactly one wins
  const a=await x.quoted(token,52,'SYNTHETIC race A'),b=await x.quoted(token,52,'SYNTHETIC race B');
  const r=await Promise.allSettled([a,b].map(g=>x.svc.submit(g.owner,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,quoteId:g.quote.quoteId})));
  assert.equal(r.filter(v=>v.status==='fulfilled').length,1);assert.equal((r.find(v=>v.status==='rejected') as PromiseRejectedResult).reason.code,'INSUFFICIENT_STOCK');
  const winner=r[0]!.status==='fulfilled'?a:b;
  // the public capacity is now full: an ordinary booking cannot take a unit
  const plain=await normalHold('2035-02-10');assert.equal(plain.result,'INSUFFICIENT');
  await release(winner.groupId,(r.find(v=>v.status==='fulfilled') as PromiseFulfilledResult<{revision:number}>).value.revision);
  const freed=await normalHold('2035-02-10');assert.equal(freed.result,'CREATED','released stock returns to ordinary booking immediately');
  await x.holds.command('cancel',randomUUID(),undefined,freed.holdId,undefined);
  await release(big.groupId,big.revision);
 });

 await check('time: 14d/48h/96h and beyond, ordinary expiry/planning run, group protection continues; only ordinary HOLD expires after 600s',async()=>{
  const g=await x.held(token,5,'SYNTHETIC long hold');const plain=await normalHold('2035-02-20');assert.equal(plain.result,'CREATED');
  const before=await groupClaims();
  for(const t of ['2035-01-01T10:11:00+09:00','2035-01-03T10:00:00+09:00','2035-01-05T10:00:00+09:00','2035-01-16T10:00:00+09:00','2035-02-01T10:00:00+09:00']){
   await x.clock(t);const p=await normalHold('2035-02-21');assert.equal(p.result,'CREATED');await x.holds.command('cancel',randomUUID(),undefined,p.holdId,undefined);
   assert.equal(await groupClaims(),before,'group claims untouched at '+t);
  }
  const ordinary=(await q('SELECT state,expires_at FROM inventory_holds WHERE id=$1',[plain.holdId])).rows[0];assert.equal(ordinary.state,'EXPIRED');assert.ok(ordinary.expires_at);
  const h=(await q("SELECT state,allocation_stage,expires_at FROM inventory_holds h JOIN group_order_parts p ON p.hold_id=h.id WHERE p.group_id=$1",[g.groupId])).rows[0];assert.deepEqual([h.state,h.allocation_stage,h.expires_at],['ACTIVE','GROUP_RESERVED',null]);
  // usage date passed: only an attention flag, still protected, still operable
  await x.clock('2035-02-12T10:00:00+09:00');const list=await x.svc.list(x.admin,{});const row=list.find(r=>r.id===g.groupId)!;
  assert.equal(row.status,'REVIEW_HELD');assert.equal(row.occupiesInventory,true);assert.equal(row.startDatePassedDays,2);
  const view=await x.svc.get(x.admin,g.groupId);assert.deepEqual(view.group.attention,{kind:'START_DATE_PASSED',daysPastStart:2});assert.equal(await groupClaims(),before);
  await x.clock('2035-01-01T10:00:00+09:00');await release(g.groupId,g.revision);
 });

 await check('release: ADMIN only with reason; all claims freed in one tx; one notification; replay and double operation safe; terminal',async()=>{
  const g=await x.held(token,25,'SYNTHETIC to release');const before=await groupClaims();
  await rejects(x.svc.release(x.manager,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,reason:'x'}),'FORBIDDEN');
  await rejects(x.svc.release({kind:'STAFF',subject:'nobody',revision:1},g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,reason:'x'}),'FORBIDDEN');
  await rejects(x.svc.release(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,reason:' '}),'REASON_REQUIRED');
  await rejects(x.svc.release(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision-1,reason:'stale'}),'STALE_REVISION');
  assert.equal(await groupClaims(),before,'refused attempts changed nothing');
  const key=randomUUID(),input={requestKey:key,expectedRevision:g.revision,reason:'SYNTHETIC explicit release'};
  const [r1,r2]=await Promise.all([x.svc.release(x.admin,g.groupId,input),x.svc.release(x.admin,g.groupId,input)]);assert.equal(r1.status,'RELEASED');assert.equal(r2.status,'RELEASED');
  assert.equal(await groupClaims(),before-25*3);
  const states=(await q("SELECT h.state,(SELECT count(*) FROM inventory_claims c WHERE c.hold_id=h.id AND c.active) n FROM inventory_holds h JOIN group_order_parts p ON p.hold_id=h.id WHERE p.group_id=$1",[g.groupId])).rows;assert.ok(states.every(s=>s.state==='RELEASED'&&Number(s.n)===0));
  assert.equal((await outbox(g.groupId,'GROUP_RELEASED')).length,1);
  await rejects(release(g.groupId,r1.revision),'INVALID_STATE');assert.equal((await outbox(g.groupId,'GROUP_RELEASED')).length,1);
  await rejects(x.svc.release(x.admin,g.groupId,{...input,reason:'different payload same key'}),'IDEMPOTENCY_MISMATCH');
 });

 await check('confirm: GROUP_ADMIN_APPROVED, on-site and unpaid, no provider artefacts at all; message in the single confirmation notice',async()=>{
  const g=await x.held(token,4,'SYNTHETIC confirm');
  const unconsented=await x.quoted(token,2,'SYNTHETIC nc');await rejects(x.svc.confirm(x.admin,unconsented.groupId,{requestKey:randomUUID(),expectedRevision:unconsented.revision}),'INVALID_STATE');
  await rejects(x.svc.confirm(x.manager,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision}),'FORBIDDEN');
  const adj:Adjustment[]=[{target:'MEMBER',memberId:g.memberIds[0]!,method:'FIXED_JPY',value:500,reason:'SYNTHETIC member discount'},{target:'GROUP',method:'PERCENT_BPS',value:1000,reason:'SYNTHETIC group discount'}];
  const set=await x.svc.setAdjustments(x.admin,g.groupId,g.revision,adj);
  const preview=await x.svc.previewConfirmation(x.admin,g.groupId);assert.equal(preview.totalJpy,set.totalJpy);assert.equal(preview.paymentMethod,'PAY_ON_SITE');
  assert.equal(set.members.reduce((s,m)=>s+m.finalJpy,0),set.totalJpy);
  const adjRows=(await q('SELECT before_jpy,after_jpy,actor,reason FROM group_adjustments WHERE group_id=$1 ORDER BY occurred_at',[g.groupId])).rows;assert.equal(adjRows.length,2);assert.ok(adjRows.every(r=>Number(r.after_jpy)<Number(r.before_jpy)&&r.actor===x.admin.subject&&r.reason));
  const msg='<script>x</script>\nご案内: 当日は現地でお支払いください。';
  const snapBefore=await snapOf();
  const key=randomUUID(),res=await x.svc.confirm(x.admin,g.groupId,{requestKey:key,expectedRevision:set.revision,message:msg});
  assert.equal(res.status,'CONFIRMED');assert.equal(res.paymentMethod,'PAY_ON_SITE');assert.equal(res.settlement,'UNPAID');assert.equal(res.totalJpy,set.totalJpy);
  const row=(await q('SELECT * FROM group_orders WHERE id=$1',[g.groupId])).rows[0];assert.equal(row.confirmation_basis,'GROUP_ADMIN_APPROVED');assert.equal(row.payment_method,'PAY_ON_SITE');assert.equal(Number(row.confirmed_total_jpy),set.totalJpy);
  const fin=(await q("SELECT * FROM group_quotes WHERE id=$1",[row.confirmed_quote_id])).rows[0];assert.equal(fin.kind,'CONFIRMED');assert.equal(Number(fin.total_jpy),Number(fin.subtotal_jpy)-Number(fin.bundle_discount_jpy)-Number(fin.member_discount_jpy)-Number(fin.group_discount_jpy));assert.equal(Number(fin.advance_discount_jpy),0,'no prepayment 5%');
  // no fictional payment artefacts anywhere: every payment/booking table is unchanged by group confirmation
  const snap=async()=>JSON.stringify(await Promise.all(['rental_bookings','rental_payment_attempts','rental_provider_events','rental_notifications','booking_notification_outbox','payment_projection_events'].map(async t=>(await q("SELECT to_regclass($1) r",[t])).rows[0].r?Number((await q(`SELECT count(*) n FROM ${t}`)).rows[0].n):-1)));
  assert.equal(Number((await q('SELECT count(*) n FROM rental_bookings WHERE hold_id IN (SELECT hold_id FROM group_order_parts)')).rows[0].n),0);
  assert.equal(await snap(),snapBefore,'no booking/attempt/provider/notification row created by confirmation');
  const holds=(await q("SELECT h.payment_state,h.confirmed_at,h.allocation_stage FROM inventory_holds h JOIN group_order_parts p ON p.hold_id=h.id WHERE p.group_id=$1",[g.groupId])).rows;assert.ok(holds.every(h=>h.payment_state==='NONE'&&h.confirmed_at===null&&h.allocation_stage==='GROUP_RESERVED'));
  const ob=await outbox(g.groupId,'GROUP_CONFIRMED');assert.equal(ob.length,1);assert.equal(ob[0].admin_message,msg);assert.equal((await outbox(g.groupId)).length,2,'one review notice + one confirmation notice, nothing per part');
  const replay=await x.svc.confirm(x.admin,g.groupId,{requestKey:key,expectedRevision:set.revision,message:msg});assert.equal(replay.replayed,true);assert.equal((await outbox(g.groupId,'GROUP_CONFIRMED')).length,1);
  await rejects(release(g.groupId,res.revision),'INVALID_STATE');
  // settlement: only actual on-site receipts
  assert.equal((await x.svc.get(x.admin,g.groupId)).settlement.status,'UNPAID');
  await rejects(x.svc.recordReceipt(x.manager,g.groupId,{requestKey:randomUUID(),amountJpy:1000,method:'CASH',receivedAt:x.now().toISOString()}),'FORBIDDEN');
  const p1=await x.svc.recordReceipt(x.admin,g.groupId,{requestKey:randomUUID(),amountJpy:1000,method:'CASH',receivedAt:x.now().toISOString(),note:'SYNTHETIC deposit'});assert.equal(p1.settlement.status,'PARTIALLY_PAID');
  await rejects(x.svc.recordReceipt(x.admin,g.groupId,{requestKey:randomUUID(),amountJpy:res.totalJpy,method:'CASH',receivedAt:x.now().toISOString()}),'GROUP_OVERPAYMENT');
  const p2=await x.svc.recordReceipt(x.admin,g.groupId,{requestKey:randomUUID(),amountJpy:res.totalJpy-1000,method:'CARD_AT_COUNTER',receivedAt:x.now().toISOString()});assert.equal(p2.settlement.status,'PAID');
  const rev=await x.svc.reverseReceipt(x.admin,g.groupId,{requestKey:randomUUID(),paymentId:p2.paymentId,reason:'SYNTHETIC wrong amount keyed'});assert.equal(rev.settlement.status,'PARTIALLY_PAID');
  await rejects(x.svc.reverseReceipt(x.admin,g.groupId,{requestKey:randomUUID(),paymentId:p2.paymentId,reason:'twice'}),'GROUP_REVERSAL_INVALID');
  await assert.rejects(q('UPDATE group_payments SET amount_jpy=1'));await assert.rejects(q('DELETE FROM group_payments'));
  // formal cancellation: stock is freed, no refund is invented, received money is reported for manual handling
  const c=await x.svc.cancelConfirmed(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:res.revision,reason:'SYNTHETIC formal cancel'});
  assert.equal(c.status,'CANCELLED');assert.equal(c.refundJpy,0);assert.equal(c.receivedJpyNeedsManualRefund,1000);assert.equal((await outbox(g.groupId,'GROUP_CANCELLED')).length,1);
  assert.equal(Number((await q("SELECT count(*) n FROM inventory_claims c JOIN group_order_parts p ON p.hold_id=c.hold_id WHERE p.group_id=$1 AND c.active",[g.groupId])).rows[0].n),0);
  await rejects(x.svc.recordReceipt(x.admin,g.groupId,{requestKey:randomUUID(),amountJpy:1,method:'CASH',receivedAt:x.now().toISOString()}),'GROUP_NOT_CONFIRMED_FOR_PAYMENT');
  // unpaid cancellation: nothing to refund
  const u=await x.held(token,2,'SYNTHETIC unpaid cancel');const uc=await x.svc.confirm(x.admin,u.groupId,{requestKey:randomUUID(),expectedRevision:u.revision});
  const uk=await x.svc.cancelConfirmed(x.admin,u.groupId,{requestKey:randomUUID(),expectedRevision:uc.revision,reason:'SYNTHETIC'});assert.equal(uk.receivedJpyNeedsManualRefund,0);assert.equal(uk.refundJpy,0);
 });

 await check('confirmed protection: confirmed stock stays protected; zero total needs explicit no-charge confirmation; fit and consent gates',async()=>{
  const g=await x.held(token,3,'SYNTHETIC gates');
  await x.svc.setAdjustments(x.admin,g.groupId,g.revision,[{target:'GROUP',method:'PERCENT_BPS',value:10000,reason:'SYNTHETIC full discount'}]);
  const cur=(await x.svc.get(x.admin,g.groupId)).group.revision;
  await rejects(x.svc.confirm(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:cur}),'NO_CHARGE_CONFIRMATION_REQUIRED');
  await q("UPDATE group_members SET fit='{\"status\":\"MANUAL_FIT_REQUIRED\"}' WHERE id=$1 AND false",[g.memberIds[0]]).catch(()=>{});
  const done=await x.svc.confirm(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:cur,noChargeConfirmed:true});assert.equal(done.totalJpy,0);assert.equal(done.settlement,'NO_CHARGE');
  const before=await groupClaims();assert.ok(before>0);
  const plain=await normalHold('2035-02-10');assert.ok(['CREATED','INSUFFICIENT'].includes(plain.result));if(plain.holdId)await x.holds.command('cancel',randomUUID(),undefined,plain.holdId,undefined);
  assert.equal(await groupClaims(),before);await x.svc.cancelConfirmed(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:done.revision,reason:'SYNTHETIC'});
  // consent is required and bound to the latest estimate; customer cannot confirm for themselves
  const u=await x.start(token,'SYNTHETIC noconsent');const m=await x.svc.saveMembers(u.owner,u.groupId,u.revision,[skiMember('a')]);const qq=await x.svc.quote(u.owner,u.groupId,m.revision);
  await rejects(x.svc.submit(u.owner,u.groupId,{requestKey:randomUUID(),expectedRevision:qq.revision,quoteId:qq.quoteId}),'CONSENT_REQUIRED');
  await rejects(x.svc.consent(u.owner,u.groupId,{quoteId:qq.quoteId,digest:'0'.repeat(64),termsVersion:'t',termsSha256:'a'.repeat(64),explanationConfirmed:true}),'QUOTE_STALE');
  await rejects(x.svc.confirm(u.owner as never,u.groupId,{requestKey:randomUUID(),expectedRevision:qq.revision}),'FORBIDDEN');
  assert.equal(Number((await q('SELECT count(*) n FROM group_order_parts WHERE group_id=$1',[u.groupId])).rows[0].n),0);
 });

 await check('amend: approved change replaces the reservation atomically; failure keeps the old reservation; re-consent before confirming',async()=>{
  const g=await x.held(token,5,'SYNTHETIC amend');const oldHold=(await q('SELECT hold_id FROM group_order_parts WHERE group_id=$1 AND active',[g.groupId])).rows.map(r=>r.hold_id);const claims=await groupClaims();
  const req=await x.svc.requestFromCustomer(g.owner,g.groupId,{requestKey:randomUUID(),kind:'CHANGE',body:'SYNTHETIC: 3 more people'});assert.equal(req.statusUnchanged,'REVIEW_HELD');assert.equal(await groupClaims(),claims,'a customer request never releases anything');
  const dec=await x.svc.requestFromCustomer(g.owner,g.groupId,{requestKey:randomUUID(),kind:'DECLINE',body:'SYNTHETIC decline wish'});assert.equal(dec.statusUnchanged,'REVIEW_HELD');assert.equal(await groupClaims(),claims);
  const cr=await x.svc.requestChanges(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,message:'SYNTHETIC please adjust sizes'});assert.equal(cr.status,'CHANGES_REQUESTED');assert.equal(await groupClaims(),claims,'change request keeps the hold');
  assert.equal((await outbox(g.groupId,'GROUP_CHANGES_REQUESTED')).length,1);
  const members=Array.from({length:8},(_,i)=>({...skiMember('n'+i),memberId:i<5?g.memberIds[i]!:undefined}));
  // failing target (injected at part 1 of the new generation): the old reservation must be intact afterwards
  await q("CREATE FUNCTION group_test_fail2() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.generation>1 THEN RAISE EXCEPTION 'INJECTED_FAILURE' USING ERRCODE='23514';END IF;RETURN NEW;END$$");
  await q('CREATE TRIGGER group_test_fail2 BEFORE INSERT ON group_order_parts FOR EACH ROW EXECUTE FUNCTION group_test_fail2()');
  await assert.rejects(x.svc.applyChange(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:cr.revision,members}));
  await q('DROP TRIGGER group_test_fail2 ON group_order_parts');
  assert.equal(await groupClaims(),claims);assert.deepEqual((await q('SELECT hold_id FROM group_order_parts WHERE group_id=$1 AND active',[g.groupId])).rows.map(r=>r.hold_id),oldHold);
  assert.equal((await q('SELECT state FROM inventory_holds WHERE id=$1',[oldHold[0]])).rows[0].state,'ACTIVE');assert.equal((await x.svc.get(x.admin,g.groupId)).group.status,'CHANGES_REQUESTED');
  // impossible target (more than the public capacity left): old stays
  const base=await x.held(token,100,'SYNTHETIC filler');
  await rejects(x.svc.applyChange(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:cr.revision,members:Array.from({length:60},(_,i)=>skiMember('z'+i))}),'INSUFFICIENT_STOCK');
  assert.equal((await q('SELECT state FROM inventory_holds WHERE id=$1',[oldHold[0]])).rows[0].state,'ACTIVE');await release(base.groupId,base.revision);
  const ok=await x.svc.applyChange(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:cr.revision,members,changeRequestId:(await q("SELECT id FROM group_change_requests WHERE group_id=$1 AND kind='CHANGE'",[g.groupId])).rows[0].id});
  assert.equal(ok.members,8);assert.equal(ok.consentRequired,true);assert.equal(await groupClaims(),claims+3*3);
  assert.equal((await q('SELECT state FROM inventory_holds WHERE id=$1',[oldHold[0]])).rows[0].state,'RELEASED');
  assert.deepEqual((await q('SELECT id FROM group_members WHERE group_id=$1 AND ordinal<=5 ORDER BY ordinal',[g.groupId])).rows.map(r=>r.id),g.memberIds.slice(0,5),'member ids are stable across the amend');
  await rejects(x.svc.confirm(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:ok.revision}),'CONSENT_REQUIRED');
  const v=await x.svc.get(x.admin,g.groupId);const latest=v.quotes.filter(z=>z.kind==='ESTIMATE').at(-1)!;
  await x.svc.consent(g.owner,g.groupId,{quoteId:latest.id,digest:latest.digest,termsVersion:'T',termsSha256:'b'.repeat(64),explanationConfirmed:true});
  const fin=await x.svc.confirm(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:ok.revision});assert.equal(fin.status,'CONFIRMED');
  await x.svc.cancelConfirmed(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:fin.revision,reason:'SYNTHETIC cleanup'});
 });

 await check('confirm vs release race: exactly one legal terminal outcome, one notice',async()=>{
  const g=await x.held(token,6,'SYNTHETIC race');
  const r=await Promise.allSettled([x.svc.confirm(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision}),x.svc.release(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,reason:'SYNTHETIC race'})]);
  assert.equal(r.filter(v=>v.status==='fulfilled').length,1);const st=(await x.svc.get(x.admin,g.groupId)).group.status;assert.ok(['CONFIRMED','RELEASED'].includes(st));
  assert.equal((await outbox(g.groupId,st==='CONFIRMED'?'GROUP_CONFIRMED':'GROUP_RELEASED')).length,1);assert.equal((await outbox(g.groupId,st==='CONFIRMED'?'GROUP_RELEASED':'GROUP_CONFIRMED')).length,0);
  if(st==='CONFIRMED')await x.svc.cancelConfirmed(x.admin,g.groupId,{requestKey:randomUUID(),expectedRevision:(await x.svc.get(x.admin,g.groupId)).group.revision,reason:'SYNTHETIC cleanup'});
 });

 await check('authorization is re-read in the transaction: a permission revoked after login is refused (not merely a stale revision)',async()=>{
  const g=await x.held(token,2,'SYNTHETIC perm');
  const fresh=async()=>{const p=(await loadStaff(x.db.pool,x.admin.subject))!;return {kind:'STAFF' as const,subject:p.subject,revision:p.revision};};
  const deny=async(perm:string)=>{await q("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,$2,false)",[x.admin.subject,perm]);const a=await fresh();assert.ok(!(await loadStaff(x.db.pool,x.admin.subject))!.permissions.includes(perm as never));return a;};
  const allow=async(perm:string)=>q("DELETE FROM staff_permission_overrides WHERE staff_id=$1 AND permission=$2",[x.admin.subject,perm]);
  let a=await deny('GROUP_APPROVE');
  await rejects(x.svc.confirm(a,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision}),'FORBIDDEN');await rejects(x.svc.requestChanges(a,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,message:'m'}),'FORBIDDEN');
  await allow('GROUP_APPROVE');a=await deny('GROUP_RELEASE');
  await rejects(x.svc.release(a,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,reason:'x'}),'FORBIDDEN');await allow('GROUP_RELEASE');
  const ok=await fresh();await x.svc.release(ok,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,reason:'SYNTHETIC ok again'});
  // the database re-checks too: a store-scoped (ASSIGNED, no store) admin cannot confirm even if the application layer were bypassed
  const g2=await x.held(token,1,'SYNTHETIC db recheck');await q("INSERT INTO staff_permission_overrides(staff_id,permission,allowed) VALUES($1,'GROUP_APPROVE',false)",[x.admin.subject]);
  const c=await x.groupPool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.group_op','on',true),set_config('zao.actor',$1,true)",[x.admin.subject]);
   await assert.rejects(c.query("UPDATE group_orders SET status='CONFIRMED',revision=revision+1,confirmation_basis='GROUP_ADMIN_APPROVED',confirmed_at=now(),confirmed_by=$2,confirmed_total_jpy=1,held_at=held_at WHERE id=$1",[g2.groupId,x.admin.subject]),/GROUP_NOT_AUTHORIZED/);await c.query('ROLLBACK');}finally{c.release();}
  await allow('GROUP_APPROVE');await x.svc.release(await fresh(),g2.groupId,{requestKey:randomUUID(),expectedRevision:g2.revision,reason:'SYNTHETIC cleanup'});Object.assign(x.admin,await fresh());
 });

 await check('database guards: no direct writes, no illegal transitions, terminal is final, group holds are untouchable by other roles, no booking can bind a group hold',async()=>{
  const g=await x.held(token,2,'SYNTHETIC guards');const gp=x.groupPool;
  await assert.rejects(gp.query("UPDATE group_orders SET status='CONFIRMED' WHERE id=$1",[g.groupId]),/GROUP_DIRECT_WRITE/);
  await assert.rejects(x.db.pool.query("UPDATE group_orders SET status='RELEASED' WHERE id=$1",[g.groupId]),/GROUP_DIRECT_WRITE/);
  const c=await gp.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('zao.group_op','on',true),set_config('zao.actor',$1,true)",[x.admin.subject]);
   await assert.rejects(c.query("UPDATE group_orders SET status='QUOTED',revision=revision+1 WHERE id=$1",[g.groupId]),/GROUP_ILLEGAL_TRANSITION/);await c.query('ROLLBACK');
   await c.query('BEGIN');await c.query("SELECT set_config('zao.group_op','on',true),set_config('zao.actor',$1,true)",[x.manager.subject]);
   await assert.rejects(c.query("UPDATE group_orders SET status='RELEASED',released_at=now(),released_by=$2,release_reason='x',revision=revision+1 WHERE id=$1",[g.groupId,x.manager.subject]),/GROUP_NOT_AUTHORIZED/);await c.query('ROLLBACK');
   await c.query('BEGIN');await c.query("SELECT set_config('zao.group_op','on',true),set_config('zao.actor',$1,true)",[x.admin.subject]);
   await assert.rejects(c.query("UPDATE group_orders SET contact_name='x',revision=revision+2 WHERE id=$1",[g.groupId]),/GROUP_REVISION/);await c.query('ROLLBACK');
  }finally{c.release();}
  // holds: other application roles and the ordinary HoldService cannot alter a group hold or its claims
  const h=(await q('SELECT hold_id FROM group_order_parts WHERE group_id=$1',[g.groupId])).rows[0].hold_id;
  await assert.rejects(x.roles.holdPool.query("UPDATE inventory_holds SET state='RELEASED' WHERE id=$1",[h]),/GROUP_HOLD_PROTECTED/);
  await assert.rejects(x.roles.holdPool.query('UPDATE inventory_claims SET active=false WHERE hold_id=$1',[h]),/GROUP_HOLD_PROTECTED/);
  await assert.rejects(x.roles.transferPool.query("UPDATE inventory_holds SET state='EXPIRED' WHERE id=$1",[h]),/GROUP_HOLD_PROTECTED|permission/);
  await assert.rejects(x.roles.holdPool.query("INSERT INTO inventory_holds(id,reservation_id,owner_id,pickup_store,return_store,conditions,starts_at,due_at,occupancy_start,occupancy_end,expires_at,state,allocation_stage) SELECT $1,reservation_id,owner_id,pickup_store,return_store,conditions,starts_at,due_at,occupancy_start,occupancy_end,NULL,'ACTIVE','GROUP_RESERVED' FROM inventory_holds WHERE id=$2",[randomUUID(),h]),/GROUP_HOLD_PROTECTED|violates/);
  await assert.rejects(x.db.pool.query("INSERT INTO rental_bookings(id,owner_id,request_key,fingerprint,hold_id,quote_id,conditions,price_snapshot,price_sha256,contact,mode,state,notification_locale) SELECT reservation_id,owner_id,gen_random_uuid(),repeat('a',64),id,(SELECT id FROM price_quotes LIMIT 1),conditions,'{\"chargeReady\":\"false\"}',repeat('a',64),'{}','SIMULATED_DEV','DRAFT','ja' FROM inventory_holds WHERE id=$1",[h]));
  assert.equal((await x.svc.get(x.admin,g.groupId)).group.status,'REVIEW_HELD');
  // normal holds keep their mandatory expiry
  await assert.rejects(x.db.pool.query("UPDATE inventory_holds SET expires_at=NULL WHERE allocation_stage='PROVISIONAL' AND state='ACTIVE'").then(r=>{if(!r.rowCount)throw new Error('no active ordinary hold to test');}));
  await assert.rejects(x.db.pool.query('UPDATE group_events SET event_type=$1',['x']),/GROUP_APPEND_ONLY|GROUP_DIRECT/);await assert.rejects(x.db.pool.query('DELETE FROM group_quotes'),/GROUP_APPEND_ONLY|GROUP_DIRECT/);
  await release(g.groupId,g.revision);
 });

 await check('performance: 100 members (5 parts) under one allocator lock; query count and wall time recorded',async()=>{
  const g=await x.quoted(token,100,'SYNTHETIC perf');let queries=0;
  const pool=x.groupPool as Pool;const orig=pool.connect.bind(pool);
  (pool as unknown as {connect:()=>Promise<unknown>}).connect=async()=>{const c=await orig();const oq=c.query.bind(c) as (...a:unknown[])=>unknown;(c as unknown as {query:(...a:unknown[])=>unknown}).query=(...a:unknown[])=>{queries++;return oq(...a);};return c;};
  const t0=performance.now();const r=await x.svc.submit(g.owner,g.groupId,{requestKey:randomUUID(),expectedRevision:g.revision,quoteId:g.quote.quoteId});const ms=Math.round(performance.now()-t0);
  (pool as unknown as {connect:unknown}).connect=orig;
  console.log(`PERF submit(100 members, 5 parts, ${r.claims} claims): ${ms} ms wall (single transaction = allocator lock hold time), ${queries} statements`);
  assert.equal(r.parts,5);assert.ok(queries<2500,'statement count bounded (no per-claim round trips): '+queries);await release(g.groupId,r.revision);
 });

 console.log(`Group core: ${count} checks passed.`);
}catch(e){failed=true;console.error('GROUP_CORE_FAILED '+stage);console.error(e);}finally{await x.close();}
if(failed)process.exit(1);
